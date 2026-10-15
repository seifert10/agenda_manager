import db from '../db/connection';
import type { CompanyUser } from './companyAuth';
import { requireCompanyActor } from './companyAuthorization';
import { CompanyRequestError } from './companyErrors';
import { reportEmployees } from './companyReporting';
import { companyEmployeeStatus } from './companyEmployees';
import { brazilToday,holidayNoticeCandidates } from '../../shared/holidays';
import { validDate } from '../../shared/dates';

export async function companyNotificationsFor(user:CompanyUser,today=brazilToday()) {
  const companyId=requireCompanyActor(user);
  if(!validDate(today)) throw new CompanyRequestError(400,'Data inválida.');
  const employees=await reportEmployees(user),keys:string[]=[];
  for(const employee of employees) {
    const status=await companyEmployeeStatus(user,employee,today);
    if(status.smartStatus!=='pendente') continue;
    const key=`pending:${employee.id}:${today}`;keys.push(key);
    await db.prepare(`INSERT INTO notifications(company_id,type,title,message,related_id,department_id,source_key) VALUES(?,'aviso',?,?,?,?,?) ON CONFLICT(company_id,source_key) DO UPDATE SET title=excluded.title,message=excluded.message,department_id=excluded.department_id`).run(companyId,status.statusLabel,status.alertMessage || 'Planejamento pendente',employee.id,employee.department_id,key);
  }
  if(user.role==='ADMIN' || user.departmentIds.length) {
    for(const holiday of holidayNoticeCandidates(today)) {
      keys.push(holiday.sourceKey);
      await db.prepare(`INSERT INTO notifications(company_id,type,title,message,department_id,source_key) VALUES(?,'info',?,?,NULL,?) ON CONFLICT(company_id,source_key) DO UPDATE SET title=excluded.title,message=excluded.message`).run(companyId,holiday.title,holiday.message,holiday.sourceKey);
    }
  }
  const scope=user.role==='ADMIN'?'':user.departmentIds.length?` AND (n.department_id IS NULL OR n.department_id IN (${user.departmentIds.map(()=>'?').join(',')}))`:' AND 1=0';
  return db.prepare(`SELECT n.id,n.type,n.title,n.message,n.related_id,n.department_id,n.source_key,n.created_at,CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END AS is_read FROM notifications n LEFT JOIN notification_reads r ON r.company_id=n.company_id AND r.notification_id=n.id AND r.user_id=? WHERE n.company_id=?${scope} AND (n.source_key IS NULL OR n.source_key IN (${keys.map(()=>'?').join(',') || 'NULL'})) ORDER BY is_read,n.created_at DESC,n.id DESC`).all(user.id,companyId,...(user.role==='ADMIN'?[]:user.departmentIds),...keys);
}
export async function readCompanyNotification(user:CompanyUser,id:number) {
  const companyId=requireCompanyActor(user),row=await db.prepare('SELECT id,department_id FROM notifications WHERE company_id=? AND id=?').get(companyId,id);
  if(!row) throw new CompanyRequestError(404,'Notificação não encontrada.');
  if(user.role!=='ADMIN' && !(user.departmentIds.includes(row.department_id) || (row.department_id===null && user.departmentIds.length))) throw new CompanyRequestError(403,'Acesso negado a esta notificação.');
  await db.prepare('INSERT INTO notification_reads(company_id,notification_id,user_id) VALUES(?,?,?) ON CONFLICT(company_id,notification_id,user_id) DO NOTHING').run(companyId,id,user.id);
  return {message:'Notificação marcada como lida para você.'};
}
export async function readAllCompanyNotifications(user:CompanyUser) {
  const companyId=requireCompanyActor(user),rows=await companyNotificationsFor(user);
  for(const row of rows) await db.prepare('INSERT INTO notification_reads(company_id,notification_id,user_id) VALUES(?,?,?) ON CONFLICT(company_id,notification_id,user_id) DO NOTHING').run(companyId,row.id,user.id);
  return {message:'Notificações marcadas como lidas para você.'};
}
