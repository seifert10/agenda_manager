import db from '../db/connection';
import type { CompanyUser } from './companyAuth';
import { requireCompanyActor,companyDepartment,companyEmployee } from './companyAuthorization';
import { CompanyRequestError } from './companyErrors';
import { companyEntityId } from './companyAdministration';
import { companyEmployeeStatus } from './companyEmployees';
import { listCompanyCalendar } from './companyScheduling';
import { validDate } from '../../shared/dates';
import { brazilToday,holidaySummaryDates,holidaysBetween,type Holiday,type HolidaySummary,type HolidayCoverage } from '../../shared/holidays';
import { dayType } from '../../shared/schedule';
import { formatCPF } from '../utils/cpf';

function employeeScope(user:CompanyUser) {
  return {sql:user.role==='ADMIN'?'':` AND e.department_id IN (${user.departmentIds.map(()=>'?').join(',') || 'NULL'})`,params:user.role==='ADMIN'?[]:user.departmentIds};
}
function referenceDate(date:unknown) {
  if (!validDate(date) || Number(date.slice(0,4))<1900 || Number(date.slice(0,4))>9997) throw new CompanyRequestError(400,'Data inválida.');
  return date;
}
function period(filters:Record<string,unknown>) {
  for (const key of ['startDate','endDate']) if (filters[key] !== undefined && !validDate(filters[key])) throw new CompanyRequestError(400,'Data inválida.');
  if (filters.startDate && filters.endDate && String(filters.startDate)>String(filters.endDate)) throw new CompanyRequestError(400,'Período inválido.');
}
async function reportDepartment(user:CompanyUser,name:unknown) {
  if (name === undefined) return undefined;
  if (typeof name!=='string' || !name.trim()) throw new CompanyRequestError(400,'Setor inválido.');
  const companyId=requireCompanyActor(user),row=await db.prepare('SELECT id FROM departments WHERE company_id=? AND name=?').get(companyId,name.trim().toLowerCase());
  if (!row) throw new CompanyRequestError(404,'Setor não encontrado.');
  await companyDepartment(user,row.id);
  return row.id as number;
}
export async function reportEmployees(user:CompanyUser,departmentId?:number) {
  const companyId=requireCompanyActor(user),scope=employeeScope(user);
  return db.prepare(`SELECT e.*,d.name AS department_name FROM employees e JOIN departments d ON d.company_id=e.company_id AND d.id=e.department_id WHERE e.company_id=?${scope.sql}${departmentId===undefined?'':' AND e.department_id=?'} ORDER BY d.name,e.name,e.id`).all(companyId,...scope.params,...(departmentId===undefined?[]:[departmentId]));
}
export async function companyHolidaySummary(user:CompanyUser,date:unknown=brazilToday()):Promise<HolidaySummary> {
  const companyId=requireCompanyActor(user),reference=referenceDate(date),dates=holidaySummaryDates(reference),scope=employeeScope(user);
  const all=[...dates.month,...dates.week,...(dates.next?[dates.next]:[])],unique=[...new Set(all.map(h=>h.date))].sort();
  const employees=await db.prepare(`SELECT e.* FROM employees e WHERE e.company_id=? AND e.status<>'inativo'${scope.sql}`).all(companyId,...scope.params);
  const coverage=new Map<string,HolidayCoverage>();
  if(unique.length) {
    const load=(table:'days_off'|'work_schedules')=>db.prepare(`SELECT s.* FROM ${table} s JOIN employees e ON e.company_id=s.company_id AND e.id=s.employee_id WHERE s.company_id=? AND s.date BETWEEN ? AND ? AND e.status<>'inativo'${scope.sql}`).all(companyId,unique[0],unique[unique.length-1],...scope.params);
    const offs=await load('days_off'),schedules=await load('work_schedules');
    const offMap=new Map(offs.map(row=>[`${row.employee_id}:${row.date}`,row])),scheduleMap=new Map(schedules.map(row=>[`${row.employee_id}:${row.date}`,row]));
    for(const holiday of all) {
      if(coverage.has(holiday.date)) continue;
      const counts:HolidayCoverage={...holiday,working:0,off:0,unavailable:0,undefined:0};
      for(const employee of employees) {
        const key=`${employee.id}:${holiday.date}`,type=dayType(employee,holiday.date,offMap.get(key),scheduleMap.get(key));
        if(type==='trabalho') counts.working++;else if(type==='folga') counts.off++;else if(type==='indefinido') counts.undefined++;else counts.unavailable++;
      }
      coverage.set(holiday.date,counts);
    }
  }
  const enrich=(holiday:Holiday)=>coverage.get(holiday.date)!;
  return {referenceDate:reference,month:dates.month.map(enrich),week:dates.week.map(enrich),today:dates.today.map(enrich),next:dates.next?enrich(dates.next):null};
}
export function companyPublicHolidays(user:CompanyUser,start:unknown,end:unknown) {
  requireCompanyActor(user);
  if(!validDate(start) || !validDate(end)) throw new CompanyRequestError(400,'Informe datas válidas.');
  try {return holidaysBetween(start,end);}catch(error) {throw new CompanyRequestError(400,(error as Error).message);}
}
export async function companyAuditHistory(user:CompanyUser,filters:Record<string,unknown>,departmentId?:number) {
  const companyId=requireCompanyActor(user),params:any[]=[companyId];period(filters);
  let sql=`SELECT a.*,e.name AS employee_name,dept.name AS department,e.position FROM audit_logs a LEFT JOIN employees e ON e.company_id=a.company_id AND e.id=a.employee_id LEFT JOIN departments dept ON dept.company_id=a.company_id AND dept.id=COALESCE(a.department_id,e.department_id) WHERE a.company_id=?`;
  if(user.role!=='ADMIN') {sql+=` AND COALESCE(a.department_id,e.department_id) IN (${user.departmentIds.map(()=>'?').join(',') || 'NULL'})`;params.push(...user.departmentIds);}
  if(filters.employeeId!==undefined) {const id=companyEntityId(filters.employeeId);await companyEmployee(user,id);sql+=' AND a.employee_id=?';params.push(id);}
  if(departmentId!==undefined) {await companyDepartment(user,departmentId);sql+=' AND COALESCE(a.department_id,e.department_id)=?';params.push(departmentId);}
  if(filters.action!==undefined) {if(typeof filters.action!=='string') throw new CompanyRequestError(400,'Ação inválida.');sql+=' AND a.action=?';params.push(filters.action);}
  if(filters.startDate!==undefined) {sql+=' AND substr(a.created_at,1,10)>=?';params.push(filters.startDate);}
  if(filters.endDate!==undefined) {sql+=' AND substr(a.created_at,1,10)<=?';params.push(filters.endDate);}
  const limit=filters.limit===undefined?100:Number(filters.limit);
  if(!Number.isInteger(limit) || limit<1 || limit>500) throw new CompanyRequestError(400,'Limite inválido.');
  return db.prepare(sql+' ORDER BY a.created_at DESC,a.id DESC LIMIT ?').all(...params,limit);
}
export async function companyReportSummary(user:CompanyUser) {
  const employees=await reportEmployees(user),offs=await listCompanyCalendar(user,'offs',{}),statusCounts={ativo:0,ferias:0,afastado:0,inativo:0};
  const departmentSummary:Record<string,{total:number;daysOffCount:number;pendingCount:number}>=Object.create(null);
  for(const employee of employees) {
    if(Object.hasOwn(statusCounts,employee.status)) statusCounts[employee.status as keyof typeof statusCounts]++;
    const department=employee.department_name;
    departmentSummary[department] ??= {total:0,daysOffCount:0,pendingCount:0};departmentSummary[department].total++;
    if((await companyEmployeeStatus(user,employee)).smartStatus==='pendente') departmentSummary[department].pendingCount++;
  }
  for(const off of offs) if(departmentSummary[off.department]) departmentSummary[off.department].daysOffCount++;
  return {statusCounts,departmentSummary,totalEmployees:employees.length,totalDaysOff:offs.length};
}
function csvCell(value:unknown) {
  let text=value==null?'':String(value);
  if(/^[\s]*[=+\-@]/.test(text)) text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export async function companyCsvReport(user:CompanyUser,filters:Record<string,unknown>) {
  requireCompanyActor(user);period(filters);
  if(user.role!=='ADMIN' && !user.departmentIds.length) throw new CompanyRequestError(403,'Nenhum setor autorizado para exportação.');
  const type=filters.type ?? 'folgas';
  if(!['folgas','pendencias','auditoria'].includes(type as string)) throw new CompanyRequestError(400,'Tipo de relatório inválido.');
  const departmentId=await reportDepartment(user,filters.department),today=brazilToday();
  let header:string[],lines:unknown[][],filename:string;
  if(type==='folgas') {
    const employees=await reportEmployees(user,departmentId),byId=new Map(employees.map(e=>[e.id,e]));
    const offs=await listCompanyCalendar(user,'offs',{startDate:filters.startDate,endDate:filters.endDate,...(departmentId===undefined?{}:{departmentId})});
    header=['ID','Colaborador','CPF','Setor','Cargo','Data da Folga','Tipo','Status','Observações','Registrado Em'];
    lines=offs.map(off=>[off.id,off.employee_name,formatCPF(byId.get(off.employee_id)!.cpf),off.department,off.position,off.date,off.type,off.status,off.notes,off.created_at]);filename=`relatorio_folgas_${today}.csv`;
  } else if(type==='pendencias') {
    const employees=await reportEmployees(user,departmentId);lines=[];
    for(const employee of employees) {
      const calc=await companyEmployeeStatus(user,employee);
      if(calc.smartStatus==='pendente') lines.push([calc.employeeId,calc.name,employee.department_name,calc.position,calc.lastDayOff || 'Sem registro anterior',calc.daysSinceLastDayOff ?? '—',calc.statusLabel,calc.alertMessage]);
    }
    header=['ID Colaborador','Nome','Setor','Cargo','Última Folga','Dias Sem Folga','Status','Alerta / Ação Necessária'];filename=`pendencias_folgas_${today}.csv`;
  } else {
    const audit=await companyAuditHistory(user,{...filters,limit:500},departmentId);
    header=['ID','Data/Hora','Responsável','Colaborador','Ação','Valor Anterior','Novo Valor','Detalhes'];
    lines=audit.map(row=>[row.id,row.created_at,row.user_name || 'Sistema',row.employee_name || 'Geral',row.action,row.old_value,row.new_value,row.details]);filename=`historico_auditoria_${today}.csv`;
  }
  return {body:Buffer.from('\ufeff'+[header.join(';'),...lines.map(line=>line.map(csvCell).join(';'))].join('\r\n'),'utf8'),download:{filename,contentType:'text/csv; charset=utf-8'}};
}
