import db from '../db/connection';
import type { CompanyUser } from './companyAuth';
import { companyEmployee,companyDepartment,requireCompanyActor,requireCompanyMutation } from './companyAuthorization';
import { CompanyRequestError } from './companyErrors';
import { companyEntityId } from './companyAdministration';
import { companyAudit } from '../db/company-audit';
import { validDate } from '../../shared/dates';
import { recurrenceDates,type OffRecurrence } from '../../shared/recurrence';

function inputObject(input:unknown): Record<string,unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CompanyRequestError(400,'Dados inválidos.');
  if (['company_id','companyId','companyCode'].some(key=>Object.hasOwn(input,key))) throw new CompanyRequestError(400,'A empresa é determinada pela sessão.');
  return input as Record<string,unknown>;
}
function offData(input:Record<string,unknown>,existing?:any) {
  const date=input.date ?? existing?.date,type=input.type ?? existing?.type ?? 'dsr',status=input.status ?? existing?.status ?? 'confirmada',notes=input.notes === undefined ? existing?.notes ?? '' : input.notes;
  if (!validDate(date)) throw new CompanyRequestError(400,'Data inválida.');
  if (!['dsr','folga_compensatoria','ferias','ausencia_justificada','afastamento','outro'].includes(type as string)) throw new CompanyRequestError(400,'Tipo de folga inválido.');
  if (!['planejada','confirmada','realizada'].includes(status as string)) throw new CompanyRequestError(400,'Status de folga inválido.');
  if (notes != null && (typeof notes !== 'string' || notes.length>10000)) throw new CompanyRequestError(400,'Observação inválida.');
  return {date,type:type as string,status:status as string,notes:notes || null};
}
async function schedulingAudit(user:CompanyUser,employee:any,id:number,entity:string,action:string,before?:unknown,after?:unknown) {
  await companyAudit(user,{employeeId:employee.id,departmentId:employee.department_id,entity,entityId:id,action,oldValue:before===undefined?undefined:JSON.stringify(before),newValue:after===undefined?undefined:JSON.stringify(after),details:`${action} para ${employee.name}.`});
}
async function insertOff(user:CompanyUser,employee:any,data:ReturnType<typeof offData>) {
  const companyId=requireCompanyMutation(user);
  if (await db.prepare('SELECT id FROM days_off WHERE company_id=? AND employee_id=? AND date=?').get(companyId,employee.id,data.date)) throw new CompanyRequestError(400,'Já existe uma folga cadastrada para este colaborador nesta mesma data.');
  const result=await db.prepare('INSERT INTO days_off(company_id,employee_id,date,type,status,notes) VALUES(?,?,?,?,?,?)').run(companyId,employee.id,data.date,data.type,data.status,data.notes);
  const id=Number(result.lastInsertRowid);
  await schedulingAudit(user,employee,id,'days_off','CRIOU_FOLGA',undefined,data);
  return id;
}
function recurrence(data:ReturnType<typeof offData>,input:Record<string,unknown>,employee:any) {
  if (employee.status !== 'ativo') throw new CompanyRequestError(400,'Repetição disponível somente para colaboradores ativos.');
  if (!['dsr','folga_compensatoria'].includes(data.type)) throw new CompanyRequestError(400,'Use repetição para descanso semanal ou folga compensatória.');
  try { return recurrenceDates(data.date,inputObject(input.recurrence) as unknown as OffRecurrence); }
  catch(error) { if (error instanceof CompanyRequestError) throw error; throw new CompanyRequestError(400,(error as Error).message); }
}
async function recurringOffs(user:CompanyUser,employee:any,data:ReturnType<typeof offData>,dates:string[]) {
  const companyId=requireCompanyMutation(user),insertedDates:string[]=[],skippedDates:string[]=[];
  for (const date of dates) {
    const off=await db.prepare('SELECT id FROM days_off WHERE company_id=? AND employee_id=? AND date=?').get(companyId,employee.id,date);
    const schedule=await db.prepare("SELECT id FROM work_schedules WHERE company_id=? AND employee_id=? AND date=? AND COALESCE(notes,'')<>'Folga agendada'").get(companyId,employee.id,date);
    if (off || schedule) {skippedDates.push(date);continue;}
    await insertOff(user,employee,{...data,date,status:date===data.date?data.status:'planejada'});
    insertedDates.push(date);
  }
  return {insertedCount:insertedDates.length,insertedDates,skippedDates};
}
export async function createCompanyOff(user:CompanyUser,input:unknown) {
  requireCompanyMutation(user);
  const values=inputObject(input),employee=await companyEmployee(user,companyEntityId(values.employee_id),true),data=offData(values);
  if (values.recurrence !== undefined) return {...await recurringOffs(user,employee,data,recurrence(data,values,employee)),message:'Folgas recorrentes planejadas'};
  return {id:await insertOff(user,employee,data),message:'Folga agendada com sucesso'};
}
async function lockedOff(user:CompanyUser,id:number) {
  const companyId=requireCompanyMutation(user);
  const candidate=await db.prepare('SELECT employee_id FROM days_off WHERE company_id=? AND id=?').get(companyId,id);
  if (!candidate) throw new CompanyRequestError(404,'Folga não encontrada.');
  const employee=await companyEmployee(user,candidate.employee_id,true);
  const off=await db.prepare('SELECT * FROM days_off WHERE company_id=? AND id=? AND employee_id=?').get(companyId,id,employee.id);
  if (!off) throw new CompanyRequestError(404,'Folga não encontrada.');
  return {companyId,employee,off};
}
export async function updateCompanyOff(user:CompanyUser,id:number,input:unknown) {
  const values=inputObject(input),{companyId,employee,off}=await lockedOff(user,id),data=offData(values,off);
  if (values.employee_id !== undefined && companyEntityId(values.employee_id)!==employee.id) throw new CompanyRequestError(400,'Não é permitido transferir a folga para outro colaborador.');
  const dates=values.recurrence === undefined ? undefined : recurrence(data,values,employee);
  if (await db.prepare('SELECT id FROM days_off WHERE company_id=? AND employee_id=? AND date=? AND id<>?').get(companyId,employee.id,data.date,id)) throw new CompanyRequestError(400,'Já existe folga nesta data.');
  await db.prepare('UPDATE days_off SET date=?,type=?,status=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND id=?').run(data.date,data.type,data.status,data.notes,companyId,id);
  await schedulingAudit(user,employee,id,'days_off','ALTEROU_FOLGA',off,data);
  return {...(dates?await recurringOffs(user,employee,data,dates):{}),message:'Folga atualizada'};
}
export async function deleteCompanyOff(user:CompanyUser,id:number) {
  const {companyId,employee,off}=await lockedOff(user,id);
  await schedulingAudit(user,employee,id,'days_off','EXCLUIU_FOLGA',off);
  await db.prepare('DELETE FROM days_off WHERE company_id=? AND id=?').run(companyId,id);
  return {message:'Folga excluída'};
}
export async function batchCompanyOffs(user:CompanyUser,input:unknown) {
  requireCompanyMutation(user);
  const items=inputObject(input).items;
  if (!Array.isArray(items) || !items.length || items.length>500) throw new CompanyRequestError(400,'Informe entre 1 e 500 folgas.');
  const values=items.map(inputObject),ids=[...new Set(values.map(v=>companyEntityId(v.employee_id)))].sort((a,b)=>a-b);
  const employees=new Map<number,any>();
  // One shared lock order prevents two batches from locking employee rows in opposite order.
  for (const id of ids) employees.set(id,await companyEmployee(user,id,true));
  const data=values.map(v=>{if (v.recurrence !== undefined) throw new CompanyRequestError(400,'Repetição não é suportada no lote.');return offData(v);});
  for (let i=0;i<values.length;i++) await insertOff(user,employees.get(companyEntityId(values[i].employee_id)),data[i]);
  return {success:true,insertedCount:items.length,errors:[]};
}

export async function listCompanyCalendar(user:CompanyUser,kind:'offs'|'schedules',filters:Record<string,unknown>) {
  const companyId=requireCompanyActor(user),params:any[]=[companyId],table=kind==='offs'?'days_off':'work_schedules';
  let sql=`SELECT s.*,e.name AS employee_name,dept.name AS department,e.position,e.department_id FROM ${table} s JOIN employees e ON e.company_id=s.company_id AND e.id=s.employee_id JOIN departments dept ON dept.company_id=e.company_id AND dept.id=e.department_id WHERE s.company_id=?`;
  if (user.role !== 'ADMIN') {sql+=` AND e.department_id IN (${user.departmentIds.map(()=>'?').join(',') || 'NULL'})`;params.push(...user.departmentIds);}
  if (filters.employeeId !== undefined) {const id=companyEntityId(filters.employeeId);await companyEmployee(user,id);sql+=' AND s.employee_id=?';params.push(id);}
  if (filters.departmentId !== undefined) {const id=companyEntityId(filters.departmentId);await companyDepartment(user,id);sql+=' AND e.department_id=?';params.push(id);}
  if (kind==='offs' && filters.type !== undefined) {if (typeof filters.type!=='string') throw new CompanyRequestError(400,'Tipo inválido.');sql+=' AND s.type=?';params.push(filters.type);}
  if (kind==='offs' && filters.month !== undefined) {
    if (typeof filters.month !== 'string' || !validDate(filters.month+'-01')) throw new CompanyRequestError(400,'Mês inválido.');
    sql+=' AND s.date LIKE ?';params.push(filters.month+'%');
  } else {
    for (const [field,operator] of [['startDate','>='],['endDate','<=']]) {
      if (filters[field] !== undefined) {if (!validDate(filters[field])) throw new CompanyRequestError(400,'Data inválida.');sql+=` AND s.date ${operator} ?`;params.push(filters[field]);}
    }
    if (filters.startDate && filters.endDate && String(filters.startDate)>String(filters.endDate)) throw new CompanyRequestError(400,'Período inválido.');
  }
  if (kind==='schedules') sql+=" AND COALESCE(s.notes,'')<>'Folga agendada'";
  return db.prepare(sql+' ORDER BY s.date,e.name,s.id').all(...params);
}
export async function saveCompanySchedule(user:CompanyUser,input:unknown) {
  const companyId=requireCompanyMutation(user),values=inputObject(input),employee=await companyEmployee(user,companyEntityId(values.employee_id),true);
  const date=values.date,shift=values.shift ?? 'integral',status=values.status ?? 'trabalho',notes=values.notes ?? '';
  if (!validDate(date) || !['manha','tarde','noite','integral'].includes(shift as string) || !['trabalho','folga','ferias','afastado'].includes(status as string)) throw new CompanyRequestError(400,'Data, turno ou status inválido.');
  if (typeof notes !== 'string' || notes.length>10000) throw new CompanyRequestError(400,'Observação inválida.');
  if (await db.prepare('SELECT id FROM days_off WHERE company_id=? AND employee_id=? AND date=?').get(companyId,employee.id,date)) throw new CompanyRequestError(409,'Existe folga nesta data. Altere a folga antes de ajustar a escala.');
  const existing=await db.prepare('SELECT * FROM work_schedules WHERE company_id=? AND employee_id=? AND date=?').get(companyId,employee.id,date);
  let id=existing?.id;
  if (existing) await db.prepare('UPDATE work_schedules SET shift=?,status=?,notes=? WHERE company_id=? AND id=?').run(shift,status,notes,companyId,id);
  else id=Number((await db.prepare('INSERT INTO work_schedules(company_id,employee_id,date,shift,status,notes) VALUES(?,?,?,?,?,?)').run(companyId,employee.id,date,shift,status,notes)).lastInsertRowid);
  await schedulingAudit(user,employee,id,'work_schedules',existing?'ALTEROU_ESCALA':'CRIOU_ESCALA',existing,{date,shift,status,notes});
  return {message:'Escala salva com sucesso'};
}
export async function deleteCompanySchedule(user:CompanyUser,id:number) {
  const companyId=requireCompanyMutation(user),candidate=await db.prepare('SELECT employee_id FROM work_schedules WHERE company_id=? AND id=?').get(companyId,id);
  if (!candidate) throw new CompanyRequestError(404,'Escala não encontrada.');
  const employee=await companyEmployee(user,candidate.employee_id,true),schedule=await db.prepare('SELECT * FROM work_schedules WHERE company_id=? AND id=? AND employee_id=?').get(companyId,id,employee.id);
  if (!schedule) throw new CompanyRequestError(404,'Escala não encontrada.');
  await schedulingAudit(user,employee,id,'work_schedules','EXCLUIU_ESCALA',schedule);
  await db.prepare('DELETE FROM work_schedules WHERE company_id=? AND id=?').run(companyId,id);
  return {message:'Ajuste de escala removido.'};
}
