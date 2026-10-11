import 'dotenv/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import fs from 'node:fs';
import { Pool, types, type PoolClient } from 'pg';
import { postgresSql } from './sql';
const embedded = process.env.TEST_DATABASE === 'postgres';
export const dialect = process.env.DATABASE_URL || embedded ? 'postgres' : 'sqlite';
export const dbPath = process.env.DB_PATH === ':memory:' ? ':memory:' : path.resolve(process.env.DB_PATH || 'data/folga_manager.db');
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória em produção. Configure a conexão PostgreSQL do Neon.');
if (process.env.NODE_ENV === 'test' && process.env.DATABASE_URL) throw new Error('Testes não podem usar DATABASE_URL externa. Use o banco isolado de testes.');
if (embedded && process.env.NODE_ENV !== 'test') throw new Error('PostgreSQL embarcado é exclusivo dos testes.');
if (process.env.NODE_ENV === 'test' && (!process.env.DB_PATH || dbPath === path.resolve('data/folga_manager.db'))) throw new Error('Testes exigem DB_PATH isolado.');
export const sqlite = dialect === 'sqlite' ? new (await import('node:sqlite')).DatabaseSync(dbPath === ':memory:' ? ':memory:' : (fs.mkdirSync(path.dirname(dbPath), {recursive:true}), dbPath)) : null;
sqlite?.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
const pglite = embedded ? new (await import('@electric-sql/pglite')).PGlite() : null;
types.setTypeParser(20, value => Number(value));
const pool = dialect === 'postgres' && !embedded ? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  statement_timeout: 30000,
  application_name: 'folga-manager',
}) : null;
pool?.on('error', () => console.error('Falha em uma conexão ociosa do PostgreSQL.'));
type Context = {client?: PoolClient; local: boolean};
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
  const r = await (context.getStore()?.client || pool!).query(text, params);
  return {rows:r.rows, rowCount:r.rowCount || 0};
}
const identityTables = new Set(['departments','users','user_departments','employees','days_off','work_schedules','audit_logs','settings','notifications']);
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
  if (context.getStore()) throw new Error('Transações aninhadas não são suportadas.');
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
export default db;
