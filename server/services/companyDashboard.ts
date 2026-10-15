import type { CompanyUser } from './companyAuth';
import { requireCompanyActor } from './companyAuthorization';
import { CompanyRequestError } from './companyErrors';
import { reportEmployees } from './companyReporting';
import { companyEmployeeStatus } from './companyEmployees';
import { listCompanyCalendar } from './companyScheduling';
import { companyNotificationsFor } from './companyNotifications';
import { brazilToday } from '../../shared/holidays';
import { validDate,addDays } from '../../shared/dates';
import { dayType } from '../../shared/schedule';

export async function companyDashboard(user:CompanyUser,date:unknown=brazilToday()) {
  requireCompanyActor(user);
  if(!validDate(date)) throw new CompanyRequestError(400,'Data inválida.');
  const employees=await reportEmployees(user),calculated:(Awaited<ReturnType<typeof companyEmployeeStatus>> & {department_id:number})[]=[];
  for(const employee of employees) calculated.push({...await companyEmployeeStatus(user,employee,date),department:employee.department_name,department_id:employee.department_id});
  const pending=calculated.filter(row=>row.smartStatus==='pendente'),upcoming=calculated.filter(row=>row.smartStatus==='proxima');
  const noScope=user.role!=='ADMIN' && !user.departmentIds.length;
  let status:'ok'|'atencao'|'critico'='ok',title='Todos os funcionários possuem folga planejada.',subtitle='Nenhuma pendência ou atraso de DSR identificado para a escala atual.';
  if(noScope) {title='Nenhum setor autorizado';subtitle='Solicite ao administrador a atribuição de setores para seu usuário.';}
  else if(!employees.length) {title='Tudo em dia';subtitle='Nenhum funcionário cadastrado no escopo atual.';}
  else if(pending.length) {
    status='critico';title=`${pending.length} ${pending.length===1?'funcionário precisa':'funcionários precisam'} de atenção`;
    if(user.role==='ADMIN') {
      const departments=new Map<string,number>();for(const row of pending) departments.set(row.department,(departments.get(row.department)||0)+1);
      title+=` (${[...departments].map(([name,count])=>`${name}: ${count}`).join(' · ')})`;
    }
    subtitle='Existem colaboradores sem o descanso semanal remunerado programado ou em risco de ultrapassar o limite contínuo de trabalho.';
  } else if(upcoming.length) {status='atencao';title=`${upcoming.length} folgas programadas para os próximos dias`;subtitle='Escala em andamento. Certifique-se de que as substituições e turnos estão alinhados.';}
  const monday=addDays(date,-((new Date(date+'T12:00:00').getDay()+6)%7)),names=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  const weekDays=noScope?[]:names.map((dayName,index)=>{const dateStr=addDays(monday,index);return {dateStr,label:dateStr.slice(8,10)+'/'+dateStr.slice(5,7),dayName,isToday:dateStr===date};});
  const offs=await listCompanyCalendar(user,'offs',{startDate:monday,endDate:addDays(monday,6)}),schedules=await listCompanyCalendar(user,'schedules',{startDate:monday,endDate:addDays(monday,6)});
  const offMap=new Map(offs.map(row=>[`${row.employee_id}:${row.date}`,row])),scheduleMap=new Map(schedules.map(row=>[`${row.employee_id}:${row.date}`,row]));
  const weekGrid=employees.filter(employee=>employee.work_regime!=='Freelancer' || schedules.some(row=>row.employee_id===employee.id && row.status==='trabalho')).map(employee=>{
    const calc=calculated.find(row=>row.employeeId===employee.id)!;
    return {employeeId:employee.id,name:employee.name,position:employee.position,department:employee.department_name,status:employee.status,smartStatus:calc.smartStatus,statusLabel:calc.statusLabel,
      days:weekDays.map(day=>{const key=`${employee.id}:${day.dateStr}`,off=offMap.get(key),type=dayType(employee,day.dateStr,off,scheduleMap.get(key));return {dateStr:day.dateStr,type,detail:type==='indefinido'?'Sem convocação / escala':type==='trabalho'?(employee.work_regime==='Freelancer'?'Convocado':'Trabalho'):type==='folga'?'Descanso':type,dayOffId:off?.id ?? null};})};
  });
  const upcomingDaysOff=(await listCompanyCalendar(user,'offs',{startDate:date,endDate:addDays(date,14)})).slice(0,8);
  // Notifications use the real current date, as on the existing dashboard, even when inspecting an older calendar.
  const recentAlerts=(await companyNotificationsFor(user)).filter(row=>!row.is_read).slice(0,5),offToday=calculated.filter(row=>row.isOffToday).length;
  return {todayStr:date,stats:{totalEmployees:employees.length,activeEmployees:employees.filter(row=>row.status==='ativo').length,workingToday:calculated.filter(row=>row.isWorkingToday).length,offToday,daysOffToday:offToday,pendingDaysOff:pending.length,pending:pending.length},attentionCard:{status,title,subtitle,pendingEmployees:pending.map(row=>({id:row.employeeId,name:row.name,department:row.department,position:row.position,lastDayOff:row.lastDayOff,daysSinceLastDayOff:row.daysSinceLastDayOff,alertMessage:row.alertMessage || 'Folga não definida nesta semana.'}))},weekDays,weekGrid,upcomingDaysOff,recentAlerts};
}
