import db from '../db/connection';
import type { CompanyUser } from './companyAuth';
import { requireCompanyActor,requireCompanyMutation,companyEmployee,companyDepartment } from './companyAuthorization';
import { CompanyRequestError } from './companyErrors';
import { companyEntityId } from './companyAdministration';
import { companyAudit } from '../db/company-audit';
import { calculateStatus } from '../../shared/employee-status';
import { validDate } from '../../shared/dates';
import { brazilToday } from '../../shared/holidays';
import { isValidCPF,formatCPF } from '../utils/cpf';

function requiredText(value:unknown,label:string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) throw new CompanyRequestError(400,`${label} inválido.`);
  return value.trim();
}
function option(value:unknown,choices:string[],label:string) {
  if (typeof value !== 'string' || !choices.includes(value)) throw new CompanyRequestError(400,`${label} inválido.`);
  return value;
}
async function employeeData(user:CompanyUser,input:Record<string,unknown>,existing?:any) {
  const companyId = requireCompanyActor(user);
  let departmentId = existing?.department_id;
  if (input.department_id !== undefined) departmentId = companyEntityId(input.department_id);
  else if (input.department !== undefined) {
    const department = await db.prepare('SELECT id FROM departments WHERE company_id=? AND name=?').get(companyId,requiredText(input.department,'Setor').toLowerCase());
    if (!department) throw new CompanyRequestError(404,'Setor não encontrado.');
    departmentId = department.id;
  }
  if (!departmentId) throw new CompanyRequestError(400,'Selecione um setor válido.');
  const department = await companyDepartment(user,departmentId,!existing || departmentId !== existing.department_id);
  const cpf = input.cpf === undefined && existing ? existing.cpf : String(input.cpf ?? '').replace(/\D/g,'');
  if (!isValidCPF(cpf)) throw new CompanyRequestError(400,'CPF inválido.');
  const hireDate = input.hire_date ?? existing?.hire_date;
  if (!validDate(hireDate)) throw new CompanyRequestError(400,'Data de admissão inválida.');
  const regime = option(input.work_regime ?? existing?.work_regime ?? 'CLT',['CLT','Estágio','PJ','Freelancer'],'Regime');
  const model = option(input.work_schedule_type ?? existing?.work_schedule_type ?? '6x1',['6x1','5x2','3x4','12x36','flexivel'],'Escala');
  const status = option(input.status ?? existing?.status ?? 'ativo',['ativo','ferias','afastado','inativo'],'Status');
  const hours = Number(input.weekly_hours ?? existing?.weekly_hours ?? 44);
  if (!Number.isInteger(hours) || hours < 0 || hours > 168) throw new CompanyRequestError(400,'Carga horária inválida.');
  let days = input.weekly_work_days ?? (existing?.weekly_work_days ? JSON.parse(existing.weekly_work_days) : []);
  if (!Array.isArray(days) || days.some(d=>!Number.isInteger(d) || d<0 || d>6) || new Set(days).size !== days.length) throw new CompanyRequestError(400,'Dias habituais inválidos.');
  if (regime === 'Freelancer') days = [];
  else if ((model === '3x4' && days.length !== 3) || (days.length && ((model === '6x1' && days.length !== 6) || (model === '5x2' && days.length !== 5)))) throw new CompanyRequestError(400,'Quantidade de dias incompatível com a escala.');
  const avatar = input.avatar_url === undefined ? existing?.avatar_url ?? null : input.avatar_url || null;
  if (avatar !== null && (typeof avatar !== 'string' || avatar.length > 2048)) throw new CompanyRequestError(400,'Imagem inválida.');
  return {
    name:requiredText(input.name ?? existing?.name,'Nome'),cpf,position:requiredText(input.position ?? existing?.position,'Cargo'),
    department:department.name,department_id:department.id,hire_date:hireDate,work_regime:regime,weekly_hours:hours,
    work_schedule_type:model,avatar_url:avatar,status,weekly_work_days:JSON.stringify(days),
  };
}
export async function companyEmployeeStatus(user:CompanyUser,employee:any,today=brazilToday()) {
  const companyId = requireCompanyActor(user);
  if (employee.company_id !== companyId) throw new CompanyRequestError(404,'Colaborador não encontrado.');
  await companyDepartment(user,employee.department_id);
  const offs = await db.prepare('SELECT * FROM days_off WHERE company_id=? AND employee_id=?').all(companyId,employee.id);
  const schedules = await db.prepare('SELECT * FROM work_schedules WHERE company_id=? AND employee_id=?').all(companyId,employee.id);
  const setting = await db.prepare("SELECT value FROM settings WHERE company_id=? AND key='clt_alert_days'").get(companyId);
  return calculateStatus(employee,today,offs,schedules,Math.min(6,Math.max(1,Number(setting?.value)||6)));
}
export async function listCompanyEmployees(user:CompanyUser,filters:Record<string,unknown>) {
  const companyId = requireCompanyActor(user),params:any[]=[companyId];
  let sql = `SELECT e.*,d.name AS department_name FROM employees e JOIN departments d ON d.company_id=e.company_id AND d.id=e.department_id WHERE e.company_id=?`;
  if (user.role !== 'ADMIN') {
    sql += ` AND e.department_id IN (${user.departmentIds.map(()=>'?').join(',') || 'NULL'})`;
    params.push(...user.departmentIds);
  }
  if (filters.search) {const search = requiredText(filters.search,'Busca');sql += ' AND (e.name LIKE ? OR e.cpf LIKE ? OR e.position LIKE ?)';params.push(...Array(3).fill(`%${search}%`));}
  if (filters.department) {sql += ' AND d.name=?';params.push(requiredText(filters.department,'Setor').toLowerCase());}
  if (filters.status) {sql += ' AND e.status=?';params.push(filters.status);}
  if (filters.workSchedule) {sql += ' AND e.work_schedule_type=?';params.push(filters.workSchedule);}
  const employees = await db.prepare(sql+' ORDER BY e.name').all(...params);
  const results = [];
  for (const employee of employees) {
    const calc = await companyEmployeeStatus(user,employee);
    results.push({...employee,department:employee.department_name,cpfFormatted:formatCPF(employee.cpf),lastDayOff:calc.lastDayOff,nextDayOff:calc.nextDayOff,daysSinceLastDayOff:calc.daysSinceLastDayOff,daysUntilNextDayOff:calc.daysUntilNextDayOff,smartStatus:calc.smartStatus,statusLabel:calc.statusLabel,alertMessage:calc.alertMessage,isWorkingToday:calc.isWorkingToday,isOffToday:calc.isOffToday});
  }
  return results;
}
export async function companyEmployeeDetail(user:CompanyUser,id:number) {
  const companyId = requireCompanyActor(user),employee = await companyEmployee(user,id),today = brazilToday();
  const department = await companyDepartment(user,employee.department_id),calc = await companyEmployeeStatus(user,employee,today);
  const pastDaysOff = await db.prepare('SELECT * FROM days_off WHERE company_id=? AND employee_id=? AND date<=? ORDER BY date DESC LIMIT 20').all(companyId,id,today);
  const futureDaysOff = await db.prepare('SELECT * FROM days_off WHERE company_id=? AND employee_id=? AND date>? ORDER BY date LIMIT 20').all(companyId,id,today);
  const auditTrail = await db.prepare('SELECT * FROM audit_logs WHERE company_id=? AND employee_id=? ORDER BY created_at DESC,id DESC LIMIT 30').all(companyId,id);
  const month = today.slice(0,7)+'%';
  const offs = await db.prepare('SELECT COUNT(*) AS n FROM days_off WHERE company_id=? AND employee_id=? AND date LIKE ?').get(companyId,id,month);
  const work = await db.prepare("SELECT COUNT(*) AS n FROM work_schedules WHERE company_id=? AND employee_id=? AND date LIKE ? AND status='trabalho'").get(companyId,id,month);
  return {...employee,department:department.name,cpfFormatted:formatCPF(employee.cpf),calc,pastDaysOff,futureDaysOff,auditTrail,metrics:{daysOffThisMonth:offs.n,daysWorkedThisMonth:work.n,lastDayOff:calc.lastDayOff,nextDayOff:calc.nextDayOff,daysSinceLastDayOff:calc.daysSinceLastDayOff}};
}
export async function saveCompanyEmployee(user:CompanyUser,input:Record<string,unknown>,id?:number) {
  const companyId = requireCompanyMutation(user);
  const existing = id === undefined ? undefined : await companyEmployee(user,id,true);
  const data = await employeeData(user,input,existing);
  if (await db.prepare('SELECT id FROM employees WHERE company_id=? AND cpf=? AND id<>?').get(companyId,data.cpf,id ?? 0)) throw new CompanyRequestError(400,'Já existe um colaborador com este CPF.');
  const values = [data.name,data.cpf,data.position,data.department,data.department_id,data.hire_date,data.work_regime,data.weekly_hours,data.work_schedule_type,data.avatar_url,data.status,data.weekly_work_days];
  if (id === undefined) {
    const result = await db.prepare('INSERT INTO employees(company_id,name,cpf,position,department,department_id,hire_date,work_regime,weekly_hours,work_schedule_type,avatar_url,status,weekly_work_days) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(companyId,...values);
    id = Number(result.lastInsertRowid);
  } else {
    await db.prepare('UPDATE employees SET name=?,cpf=?,position=?,department=?,department_id=?,hire_date=?,work_regime=?,weekly_hours=?,work_schedule_type=?,avatar_url=?,status=?,weekly_work_days=?,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND id=?').run(...values,companyId,id);
  }
  await companyAudit(user,{action:existing?'ATUALIZOU_FUNCIONARIO':'CRIOU_FUNCIONARIO',entity:'employee',entityId:id,employeeId:id,departmentId:data.department_id,oldValue:existing?`${existing.name} (${existing.position})`:undefined,newValue:`${data.name} (${data.position})`,details:`Cadastro de ${data.name} no setor ${data.department}.`});
  return {id,message:existing?'Funcionário atualizado com sucesso':'Funcionário cadastrado com sucesso'};
}
export async function deleteCompanyEmployee(user:CompanyUser,id:number) {
  const companyId = requireCompanyMutation(user),employee = await companyEmployee(user,id,true);
  await companyAudit(user,{action:'EXCLUIU_FUNCIONARIO',entity:'employee',entityId:id,employeeId:id,departmentId:employee.department_id,oldValue:`${employee.name} (${employee.position})`,details:`Colaborador ${employee.name} excluído; histórico preservado.`});
  // Company and snapshots are immutable. Clear only optional references before the physical deletion.
  await db.prepare('UPDATE audit_logs SET employee_id=NULL WHERE company_id=? AND employee_id=?').run(companyId,id);
  await db.prepare('UPDATE notifications SET related_id=NULL WHERE company_id=? AND related_id=?').run(companyId,id);
  await db.prepare('DELETE FROM employees WHERE company_id=? AND id=?').run(companyId,id);
  return {message:'Funcionário excluído com sucesso'};
}
