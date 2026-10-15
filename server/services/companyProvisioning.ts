import { createHash } from 'node:crypto';
import db, { dialect, transaction } from '../db/connection';
import { normalizeCompanyCode } from './companyContext';
import { hashPassword, verifyPassword } from '../utils/auth';

/** Operational credential only. This module is deliberately absent from HTTP routes. */
async function operationalTransaction<T>(operation: () => Promise<T>) {
  return transaction(async () => {
    if (dialect === 'postgres') {
      const role = await db.prepare('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').get();
      if (!role?.rolsuper && !role?.rolbypassrls) throw new Error('Credencial operacional separada obrigatória.');
      if (process.env.TEST_DATABASE !== 'postgres') await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74192302);
    }
    return operation();
  });
}
function metadata(key: string, operator: string) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) throw new Error('Identificador explícito de operação inválido.');
  if (!operator?.trim() || operator.length > 160) throw new Error('Operador obrigatório.');
}
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function provisionCompany(input: { operationKey: string; operator: string; code: string; name: string; adminName: string; email: string; password: string }) {
  metadata(input.operationKey, input.operator);
  const code = normalizeCompanyCode(input.code), name = input.name?.trim(), adminName = input.adminName?.trim(), email = input.email?.trim().toLowerCase();
  if (!name || name.length > 200 || !adminName || adminName.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? '') || typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) throw new Error('Dados de provisionamento inválidos; senha exige 12–128 caracteres.');
  const signature = fingerprint({ code, name, adminName, email });
  return operationalTransaction(async () => {
    const prior = await db.prepare('SELECT company_id,action,fingerprint FROM platform_operations WHERE operation_key=?').get(input.operationKey);
    if (prior) {
      if (prior.action !== 'CREATE_COMPANY' || prior.fingerprint !== signature) throw new Error('Identificador já utilizado com dados diferentes.');
      const admin = await db.prepare("SELECT id,password_hash FROM users WHERE company_id=? AND email=?").get(prior.company_id, email);
      if (!admin || !verifyPassword(input.password, admin.password_hash)) throw new Error('Credenciais diferentes; repetição recusada.');
      return { companyId: Number(prior.company_id), adminId: Number(admin.id), repeated: true };
    }
    if (await db.prepare('SELECT id FROM companies WHERE code=?').get(code)) throw new Error('Código já provisionado; associação automática recusada.');
    const company = await db.prepare('INSERT INTO companies(code,name) VALUES(?,?)').run(code, name);
    const companyId = Number(company.lastInsertRowid);
    const admin = await db.prepare("INSERT INTO users(company_id,name,email,password_hash,role) VALUES(?,?,?,?,'ADMIN')").run(companyId, adminName, email, hashPassword(input.password));
    for (const [key, value] of Object.entries({ manager_name: adminName, clt_alert_days: '6', onboarding_completed: 'false' })) await db.prepare('INSERT INTO settings(company_id,key,value) VALUES(?,?,?)').run(companyId, key, value);
    await db.prepare('INSERT INTO platform_operations(company_id,operator,action,operation_key,fingerprint) VALUES(?,?,?,?,?)').run(companyId, input.operator.trim(), 'CREATE_COMPANY', input.operationKey, signature);
    return { companyId, adminId: Number(admin.lastInsertRowid), repeated: false };
  });
}
export async function setCompanyActive(input: { operationKey: string; operator: string; code: string; active: boolean }) {
  metadata(input.operationKey, input.operator);
  if (typeof input.active !== 'boolean') throw new Error('Estado inválido.');
  const code = normalizeCompanyCode(input.code), signature = fingerprint({ code, active: input.active });
  return operationalTransaction(async () => {
    const prior = await db.prepare('SELECT action,fingerprint FROM platform_operations WHERE operation_key=?').get(input.operationKey);
    const action = input.active ? 'REACTIVATE_COMPANY' : 'SUSPEND_COMPANY';
    if (prior) {
      if (prior.action !== action || prior.fingerprint !== signature) throw new Error('Identificador já utilizado com dados diferentes.');
      return { repeated: true };
    }
    const company = await db.prepare(`SELECT id FROM companies WHERE code=?${dialect === 'postgres' ? ' FOR UPDATE' : ''}`).get(code);
    if (!company) throw new Error('Empresa não encontrada.');
    await db.prepare('UPDATE companies SET active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(input.active ? 1 : 0, company.id);
    // Revoke even on repeated state transitions: reactivation never revives old tokens.
    await db.prepare('DELETE FROM user_sessions WHERE company_id=?').run(company.id);
    await db.prepare('INSERT INTO platform_operations(company_id,operator,action,operation_key,fingerprint) VALUES(?,?,?,?,?)').run(company.id, input.operator.trim(), action, input.operationKey, signature);
    return { repeated: false };
  });
}
