import db, { requireCompanyTransaction, dialect } from '../db/connection';
import type { CompanyUser } from './companyAuth';
import { CompanyRequestError } from './companyErrors';

export function requireCompanyActor(user: CompanyUser) {
  const context = requireCompanyTransaction();
  if (user.companyId !== context.companyId || user.id !== context.userId) throw new Error('Usuário incompatível com contexto autenticado.');
  return context.companyId;
}
export function requireCompanyAdmin(user: CompanyUser) {
  const companyId = requireCompanyActor(user);
  if (user.role !== 'ADMIN') throw new CompanyRequestError(403, 'Acesso permitido somente ao administrador.');
  return companyId;
}
export function requireCompanyMutation(user: CompanyUser) {
  const companyId = requireCompanyActor(user);
  if (user.role === 'VIEWER') throw new CompanyRequestError(403, 'Usuário somente leitura não pode realizar alterações.');
  return companyId;
}
export async function companyDepartment(user: CompanyUser, id: number, activeOnly = false) {
  const companyId = requireCompanyActor(user);
  const row = await db.prepare(`SELECT id,name,active FROM departments WHERE company_id=? AND id=?`).get(companyId,id);
  if (!row || (activeOnly && !row.active)) throw new CompanyRequestError(404, 'Setor não encontrado.');
  if (user.role !== 'ADMIN' && !user.departmentIds.includes(row.id)) throw new CompanyRequestError(403, 'Sem acesso ao setor.');
  return row;
}
export async function companyEmployee(user: CompanyUser, id: number, lock = false) {
  const companyId = requireCompanyActor(user);
  const row = await db.prepare(`SELECT * FROM employees WHERE company_id=? AND id=?${lock && dialect === 'postgres' ? ' FOR UPDATE' : ''}`).get(companyId,id);
  if (!row) throw new CompanyRequestError(404, 'Colaborador não encontrado.');
  await companyDepartment(user, row.department_id);
  return row;
}
