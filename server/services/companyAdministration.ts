import db, { dialect, requireCompanyTransaction } from '../db/connection';
import type { CompanyUser } from './companyAuth';
import { requireCompanyActor, requireCompanyAdmin, companyDepartment } from './companyAuthorization';
import { CompanyRequestError } from './companyErrors';
import { companyAudit } from '../db/company-audit';
import { hashPassword } from '../utils/auth';

export function companyEntityId(value: unknown): number {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new CompanyRequestError(400, 'Identificador inválido.');
  return id;
}
function text(value: unknown, label: string, limit = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) throw new CompanyRequestError(400, `${label} inválido.`);
  return value.trim();
}
function flag(value: unknown): number {
  if (![0,1,false,true].includes(value as any)) throw new CompanyRequestError(400, 'Estado inválido.');
  return value ? 1 : 0;
}
function role(value: unknown) {
  if (!['ADMIN','MANAGER','VIEWER'].includes(value as string)) throw new CompanyRequestError(400, 'Perfil inválido.');
  return value as CompanyUser['role'];
}
function email(value: unknown) {
  const result = text(value, 'E-mail', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new CompanyRequestError(400, 'E-mail inválido.');
  return result;
}
function password(value: unknown) {
  if (typeof value !== 'string' || value.length < 6 || value.length > 1024) throw new CompanyRequestError(400, 'A senha deve ter entre 6 e 1024 caracteres.');
  return hashPassword(value);
}
/** Locks one own-company row to serialize administrative writes, including last-admin checks. */
async function lockAdministration(companyId: number) {
  const suffix = dialect === 'postgres' ? ' FOR UPDATE' : '';
  const company = await db.prepare(`SELECT id FROM companies WHERE id=?${suffix}`).get(companyId);
  if (!company) throw new CompanyRequestError(404, 'Empresa não encontrada.');
  const actor = await db.prepare('SELECT role,active FROM users WHERE company_id=? AND id=?').get(companyId,requireCompanyTransaction().userId);
  if (!actor?.active || actor.role !== 'ADMIN') throw new CompanyRequestError(403,'Acesso administrativo revogado.');
}
async function departmentIds(user: CompanyUser, value: unknown): Promise<number[]> {
  if (!Array.isArray(value) || value.length > 200) throw new CompanyRequestError(400, 'Lista de setores inválida.');
  const ids = [...new Set(value.map(companyEntityId))];
  for (const id of ids) await companyDepartment(user, id, true);
  return ids;
}
async function bindDepartments(companyId: number, userId: number, ids: number[]) {
  await db.prepare('DELETE FROM user_departments WHERE company_id=? AND user_id=?').run(companyId,userId);
  for (const id of ids) await db.prepare('INSERT INTO user_departments(company_id,user_id,department_id) VALUES(?,?,?)').run(companyId,userId,id);
}

export async function listCompanyUsers(user: CompanyUser) {
  const companyId = requireCompanyAdmin(user);
  const users = await db.prepare('SELECT id,name,email,role,active,created_at,updated_at FROM users WHERE company_id=? ORDER BY name').all(companyId);
  const links = await db.prepare(`SELECT ud.user_id,d.id,d.name FROM user_departments ud JOIN departments d ON d.company_id=ud.company_id AND d.id=ud.department_id WHERE ud.company_id=? ORDER BY d.name`).all(companyId);
  return users.map(row => { const departments = links.filter(d=>d.user_id === row.id).map(({id,name})=>({id,name})); return {...row,departments,departmentIds:departments.map(d=>d.id)}; });
}
export async function createCompanyUser(user: CompanyUser, input: Record<string,unknown>) {
  const companyId = requireCompanyAdmin(user);
  const name = text(input.name,'Nome'), cleanEmail = email(input.email), newRole = role(input.role ?? 'MANAGER'), active = flag(input.active ?? 1);
  const passwordHash = password(input.password);
  await lockAdministration(companyId);
  const ids = await departmentIds(user,input.departmentIds ?? []);
  if (await db.prepare('SELECT id FROM users WHERE company_id=? AND email=?').get(companyId,cleanEmail)) throw new CompanyRequestError(400,'Já existe um usuário com este e-mail.');
  const result = await db.prepare('INSERT INTO users(company_id,name,email,password_hash,role,active) VALUES(?,?,?,?,?,?)').run(companyId,name,cleanEmail,passwordHash,newRole,active);
  const id = Number(result.lastInsertRowid);
  await bindDepartments(companyId,id,ids);
  await companyAudit(user,{action:'CRIOU_USUARIO',entity:'user',entityId:id,details:`Usuário ${name} (${newRole}) criado.`});
  return {id,message:'Usuário criado com sucesso'};
}
export async function updateCompanyUser(user: CompanyUser, id: number, input: Record<string,unknown>) {
  const companyId = requireCompanyAdmin(user);
  await lockAdministration(companyId);
  const existing = await db.prepare('SELECT * FROM users WHERE company_id=? AND id=?').get(companyId,id);
  if (!existing) throw new CompanyRequestError(404,'Usuário não encontrado.');
  const newName = input.name === undefined ? existing.name : text(input.name,'Nome');
  const cleanEmail = input.email === undefined ? existing.email : email(input.email);
  const newRole = role(input.role ?? existing.role), active = flag(input.active ?? existing.active);
  const changedPassword = input.password !== undefined && input.password !== '';
  const passwordHash = changedPassword ? password(input.password) : existing.password_hash;
  const ids = input.departmentIds === undefined ? undefined : await departmentIds(user,input.departmentIds);
  if (user.id === id && (!active || newRole !== 'ADMIN')) throw new CompanyRequestError(400,'Não é permitido remover seu próprio acesso administrativo.');
  if (existing.active && existing.role === 'ADMIN' && (!active || newRole !== 'ADMIN')) {
    const remaining = await db.prepare("SELECT COUNT(*) AS total FROM users WHERE company_id=? AND active=1 AND role='ADMIN' AND id<>?").get(companyId,id);
    if (!remaining.total) throw new CompanyRequestError(400,'A empresa precisa manter um administrador ativo.');
  }
  if (await db.prepare('SELECT id FROM users WHERE company_id=? AND email=? AND id<>?').get(companyId,cleanEmail,id)) throw new CompanyRequestError(400,'Já existe um usuário com este e-mail.');
  await db.prepare('UPDATE users SET name=?,email=?,password_hash=?,role=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND id=?').run(newName,cleanEmail,passwordHash,newRole,active,companyId,id);
  if (ids) await bindDepartments(companyId,id,ids);
  if (changedPassword || !active || newRole !== existing.role || ids) await db.prepare('DELETE FROM user_sessions WHERE company_id=? AND user_id=?').run(companyId,id);
  await companyAudit(user,{action:'ATUALIZOU_USUARIO',entity:'user',entityId:id,oldValue:`${existing.name} (${existing.role})`,newValue:`${newName} (${newRole})`,details:'Dados e permissões do usuário atualizados.'});
  return {message:'Usuário atualizado com sucesso'};
}

export async function listCompanyDepartments(user: CompanyUser) {
  const companyId = requireCompanyActor(user);
  const scope = user.role === 'ADMIN' ? '' : ` AND d.active=1 AND d.id IN (${user.departmentIds.map(()=>'?').join(',') || 'NULL'})`;
  return db.prepare(`SELECT d.id,d.name,d.active,d.created_at,d.updated_at,COUNT(e.id) AS employee_count FROM departments d LEFT JOIN employees e ON e.company_id=d.company_id AND e.department_id=d.id WHERE d.company_id=?${scope} GROUP BY d.id,d.name,d.active,d.created_at,d.updated_at ORDER BY d.name`).all(companyId,...(user.role === 'ADMIN' ? [] : user.departmentIds));
}
export async function saveCompanyDepartment(user: CompanyUser, input: Record<string,unknown>, id?: number) {
  const companyId = requireCompanyAdmin(user);
  await lockAdministration(companyId);
  const existing = id === undefined ? undefined : await companyDepartment(user,id);
  // Stable normalization is also used by the legacy importer and the uniqueness constraint.
  const name = input.name === undefined && existing ? existing.name : text(input.name,'Nome do setor').toLowerCase();
  const active = flag(input.active ?? existing?.active ?? 1);
  if (await db.prepare('SELECT id FROM departments WHERE company_id=? AND name=? AND id<>?').get(companyId,name,id ?? 0)) throw new CompanyRequestError(400,'Já existe um setor com este nome.');
  if (id === undefined) {
    const result = await db.prepare('INSERT INTO departments(company_id,name,active) VALUES(?,?,?)').run(companyId,name,active);
    id = Number(result.lastInsertRowid);
  } else {
    await db.prepare('UPDATE departments SET name=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND id=?').run(name,active,companyId,id);
    await db.prepare('UPDATE employees SET department=? WHERE company_id=? AND department_id=?').run(name,companyId,id);
  }
  await companyAudit(user,{action:existing?'ATUALIZOU_SETOR':'CRIOU_SETOR',entity:'department',entityId:id,departmentId:id,oldValue:existing?.name,newValue:name,details:`Setor ${name}; ativo: ${active}.`});
  return {id,name,active,message:existing?'Setor atualizado com sucesso':'Setor cadastrado com sucesso'};
}
export async function getCompanySettings(user: CompanyUser) {
  const companyId = requireCompanyActor(user);
  const company = await db.prepare('SELECT name FROM companies WHERE id=?').get(companyId);
  const rows = await db.prepare('SELECT key,value FROM settings WHERE company_id=?').all(companyId);
  return {...Object.fromEntries(rows.map(r=>[r.key,r.value])),company_name:company.name} as Record<string,string>;
}
export async function saveCompanySettings(user: CompanyUser, input: Record<string,unknown>) {
  const companyId = requireCompanyAdmin(user);
  const allowed = ['company_name','manager_name','clt_alert_days','onboarding_completed'];
  if (Object.keys(input).some(key=>!allowed.includes(key))) throw new CompanyRequestError(400,'Configuração inválida.');
  if (input.clt_alert_days !== undefined && !/^[1-6]$/.test(String(input.clt_alert_days))) throw new CompanyRequestError(400,'O alerta deve ficar entre 1 e 6 dias.');
  if (input.onboarding_completed !== undefined && !['true','false'].includes(String(input.onboarding_completed))) throw new CompanyRequestError(400,'Estado de onboarding inválido.');
  await lockAdministration(companyId);
  for (const [key,value] of Object.entries(input)) {
    if (key === 'company_name') await db.prepare('UPDATE companies SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(text(value,'Nome da empresa'),companyId);
    else await db.prepare('INSERT INTO settings(company_id,key,value) VALUES(?,?,?) ON CONFLICT(company_id,key) DO UPDATE SET value=excluded.value').run(companyId,key,text(String(value),'Configuração'));
  }
  await companyAudit(user,{action:'ATUALIZOU_CONFIGURACOES',entity:'settings',details:`Parâmetros atualizados: ${Object.keys(input).join(', ')}.`});
  return {message:'Configurações atualizadas com sucesso'};
}
