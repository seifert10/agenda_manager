import 'dotenv/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import fs from 'node:fs';
import { Pool, types, type PoolClient } from 'pg';
import { postgresSql } from './sql';
import { requireCompanyContext } from '../services/companyContext';
const embedded = process.env.TEST_DATABASE === 'postgres';
export const dialect = process.env.DATABASE_URL || embedded ? 'postgres' : 'sqlite';
export const dbPath = process.env.DB_PATH === ':memory:' ? ':memory:' : path.resolve(process.env.DB_PATH || 'data/folga_manager.db');
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória em produção. Configure a conexão PostgreSQL do Neon.');
if (process.env.NODE_ENV === 'test' && process.env.DATABASE_URL) {
  const destination = new URL(process.env.DATABASE_URL);
  if (process.env.TEST_REAL_POSTGRES !== '1' || !['localhost','127.0.0.1'].includes(destination.hostname) || !/^\/company_test_[a-z0-9_]+$/.test(destination.pathname)) throw new Error('Testes externos recusados; use PostgreSQL local descartável com prefixo company_test_.');
}
if (embedded && process.env.NODE_ENV !== 'test') throw new Error('PostgreSQL embarcado é exclusivo dos testes.');
if (process.env.NODE_ENV === 'test' && (!process.env.DB_PATH || dbPath === path.resolve('data/folga_manager.db'))) throw new Error('Testes exigem DB_PATH isolado.');
export const sqlite = dialect === 'sqlite' ? new (await import('node:sqlite')).DatabaseSync(dbPath === ':memory:' ? ':memory:' : (fs.mkdirSync(path.dirname(dbPath), {recursive:true}), dbPath)) : null;
sqlite?.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
const pglite = embedded ? new (await import('@electric-sql/pglite')).PGlite() : null;
types.setTypeParser(20, value => Number(value));
const pool = dialect === 'postgres' && !embedded ? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Math.min(20,Math.max(1,Number(process.env.DB_POOL_MAX)||5)),
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  statement_timeout: 30000,
  application_name: 'folga-manager',
}) : null;
pool?.on('error', () => console.error('Falha em uma conexão ociosa do PostgreSQL.'));
type Context = {client?: PoolClient; local: boolean; companyId?: number; userId?: number};
const context = new AsyncLocalStorage<Context>();
let queue: Promise<unknown> = Promise.resolve();
async function serial<T>(operation: () => Promise<T>): Promise<T> {
  if (context.getStore()?.local) return operation();
  const pending = queue.then(() => context.run({local:true}, operation));
  queue = pending.catch(() => undefined);
  return pending;
}
async function query(sql: string, params: any[] = []): Promise<{rows:any[];rowCount:number}> {
  const text = postgresSql(sql);
  if (pglite) return serial(async () => { const r = await pglite.query(text, params); return {rows:r.rows, rowCount:r.affectedRows || 0}; });
  const reserved = context.getStore()?.client;
  const client = reserved ?? await pool!.connect();
  try {
    const r = await client.query(text, params);
    return {rows:r.rows, rowCount:r.rowCount || 0};
  } finally {
    // A denied statement outside a transaction does not poison the connection.
    // Pool.query releases with the query error and unnecessarily replaces it.
    if (!reserved) client.release();
  }
}
const identityTables = new Set(['companies','platform_operations','departments','users','user_departments','employees','days_off','work_schedules','audit_logs','settings','notifications']);
export const db = {
  prepare(sql: string) {
    return {
      async all(...params: any[]): Promise<any[]> {
        if (sqlite) return serial(async () => sqlite.prepare(sql).all(...params));
        return (await query(sql,params)).rows;
      },
      async get(...params: any[]): Promise<any> { return (await this.all(...params))[0]; },
      async run(...params: any[]): Promise<{changes:number;lastInsertRowid:number|bigint}> {
        if (sqlite) return serial(async () => {const r=sqlite.prepare(sql).run(...params);return {changes:Number(r.changes),lastInsertRowid:r.lastInsertRowid};});
        const table = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(sql)?.[1]?.toLowerCase();
        const returning = table && identityTables.has(table) && !/\bRETURNING\b/i.test(sql);
        const r = await query(returning ? sql.trim().replace(/;$/, '') + ' RETURNING id' : sql, params);
        return {changes:r.rowCount,lastInsertRowid:r.rows[0]?.id || 0};
      },
    };
  },
  async exec(sql: string): Promise<void> {
    if (sqlite) { await serial(async () => sqlite.exec(sql)); return; }
    if (pglite) { await serial(async () => { await pglite.exec(postgresSql(sql)); }); return; }
    await query(sql);
  },
  async close() { sqlite?.close(); await pglite?.close(); await pool?.end(); },
};
export async function transaction<T>(operation: () => T | Promise<T>): Promise<T> {
  const existing = context.getStore();
  if (existing?.companyId) {
    const tenant = requireCompanyContext();
    if (tenant.companyId !== existing.companyId || tenant.userId !== existing.userId) throw new Error('Contexto incompatível com a transação.');
    return operation();
  }
  if (existing) throw new Error('Transações aninhadas não são suportadas.');
  if (sqlite || pglite) return serial(async () => {
    await db.exec(sqlite ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try { const result = await operation(); await db.exec('COMMIT'); return result; }
    catch (error) { await db.exec('ROLLBACK'); throw error; }
  });
  const client = await pool!.connect();
  try {
    await client.query('BEGIN');
    const result = await context.run({client,local:false},operation);
    await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
/** One transaction and one connection for the entire company operation. */
export async function companyTransaction<T>(operation: () => Promise<T>): Promise<T> {
  const tenant = requireCompanyContext();
  const existing = context.getStore();
  if (existing?.companyId) {
    if (existing.companyId !== tenant.companyId || existing.userId !== tenant.userId) throw new Error('Troca de empresa na transação.');
    return operation();
  }
  return transaction(async () => {
    const connection = context.getStore();
    if (!connection) throw new Error('Conexão transacional ausente.');
    return context.run({...connection, companyId: tenant.companyId, userId: tenant.userId}, async () => {
      if (dialect === 'postgres') await db.prepare("SELECT set_config('app.company_id', ?, true)").get(String(tenant.companyId));
      return operation();
    });
  });
}
/** Business repositories may only run inside the authenticated unit of work. */
export function requireCompanyTransaction() {
  const tenant = requireCompanyContext();
  const current = context.getStore();
  if (!current || current.companyId !== tenant.companyId || current.userId !== tenant.userId) {
    throw new Error('Operação de empresa exige uma transação autenticada.');
  }
  return tenant;
}
export default db;
