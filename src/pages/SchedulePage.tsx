import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { Employee, DayOff, WorkSchedule, DayOffType, DayOffStatus } from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { dateKey, addDays } from '../../shared/dates';
import { dayType } from '../../shared/schedule';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import RecurrenceFields from '../components/calendar/RecurrenceFields';
import { OffRecurrence, recurrenceDates } from '../../shared/recurrence';
const labels = { trabalho:'Trabalho', folga:'Folga', ferias:'Férias', afastamento:'Afastamento', indefinido:'Sem escala' };
export default function SchedulePage() {
  const { isViewer }=useAuth(); const toast=useToast();
  const [date,setDate]=useState(dateKey(new Date())); const [view,setView]=useState<'mes'|'semana'|'dia'>('semana');
  const [employees,setEmployees]=useState<Employee[]>([]); const [offs,setOffs]=useState<DayOff[]>([]); const [schedules,setSchedules]=useState<WorkSchedule[]>([]);
  const [department,setDepartment]=useState(''); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
  const [editor,setEditor]=useState(false); const [saving,setSaving]=useState(false); const [confirm,setConfirm]=useState(false);
  const [employeeId,setEmployeeId]=useState(''); const [eventDate,setEventDate]=useState(date); const [kind,setKind]=useState('folga');
  const [offId,setOffId]=useState<number|undefined>(); const [scheduleId,setScheduleId]=useState<number|undefined>();
  const [offType,setOffType]=useState<DayOffType>('dsr'); const [offStatus,setOffStatus]=useState<DayOffStatus>('confirmada');
  const [status,setStatus]=useState('trabalho'); const [shift,setShift]=useState('integral'); const [notes,setNotes]=useState('');
  const [recurrence,setRecurrence]=useState<OffRecurrence|null>(null);
  const dates=useMemo(()=>{
    const d=new Date(date+'T12:00:00'); if(view==='dia') return [date];
    const first=view==='mes'?dateKey(new Date(d.getFullYear(),d.getMonth(),1)):date;
    const start=addDays(first,-((new Date(first+'T12:00:00').getDay()+6)%7));
    const end=view==='mes'?dateKey(new Date(d.getFullYear(),d.getMonth()+1,0)):addDays(start,6);
    const last=view==='mes'?addDays(end,6-((new Date(end+'T12:00:00').getDay()+6)%7)):end;
    const result:string[]=[]; for(let day=start;day<=last;day=addDays(day,1)) result.push(day); return result;
  },[date,view]);
  const start=dates[0], end=dates[dates.length-1];
  const load=useCallback(async()=>{
    setLoading(true); setError('');
    try { const [e,o,s]=await Promise.all([api.getEmployees(),api.getDaysOff({startDate:start,endDate:end}),api.getSchedules({startDate:start,endDate:end})]); setEmployees(e);setOffs(o);setSchedules(s); }
    catch(e:any){setError(e.message);} finally{setLoading(false);}
  },[start,end]);
  useEffect(()=>{load();window.addEventListener('folga-updated',load);window.addEventListener('employee-updated',load);return()=>{window.removeEventListener('folga-updated',load);window.removeEventListener('employee-updated',load);};},[load]);
  const offFor=(id:number,d:string)=>offs.find(o=>o.employee_id===id&&o.date===d);
  const scheduleFor=(id:number,d:string)=>schedules.find(s=>s.employee_id===id&&s.date===d);
  const state=(emp:Employee,d:string)=>dayType(emp,d,offFor(emp.id,d),scheduleFor(emp.id,d));
  const visible=employees.filter(emp=>emp.status!=='inativo'&&(!department||emp.department===department)&&(emp.work_regime!=='Freelancer'||dates.some(d=>scheduleFor(emp.id,d)?.status==='trabalho')));
  function open(emp?:Employee,d=date,newKind='folga') {
    setRecurrence(null);
    const off=emp?offFor(emp.id,d):undefined; const sched=emp?scheduleFor(emp.id,d):undefined;
    setEmployeeId(String(emp?.id || employees.find(e=>e.status==='ativo'&&(newKind!=='convocacao'||e.work_regime==='Freelancer'))?.id || ''));
    setEventDate(d);setOffId(off?.id);setScheduleId(sched?.id);setKind(off?'folga':newKind==='convocacao'?'escala':sched?'escala':newKind);
    setOffType(off?.type||'dsr');setOffStatus(off?.status||'confirmada');setStatus(sched?.status||'trabalho');setShift(sched?.shift||'integral');setNotes(off?.notes||sched?.notes||'');setError('');setEditor(true);
  }
  async function save(e:React.FormEvent){
    e.preventDefault();setSaving(true);setError('');
    try {
      if(kind==='folga') {
        const activeRecurrence=['dsr','folga_compensatoria'].includes(offType)?recurrence:null;
        if(activeRecurrence) recurrenceDates(eventDate,activeRecurrence);
        const data={date:eventDate,type:offType,status:offStatus,notes,recurrence:activeRecurrence};
        const result=offId ? await api.updateDayOff(offId,data) : await api.createDayOff({employee_id:Number(employeeId),...data});
        if(result.insertedCount !== undefined) toast.info(`${result.insertedCount} folga(s) gerada(s)`,result.skippedDates?.length ? `${result.skippedDates.length} data(s) existente(s) preservada(s).` : 'Folgas futuras planejadas até a data final.');
      } else await api.saveSchedule({employee_id:Number(employeeId),date:eventDate,status,shift,notes});
      setEditor(false);toast.success('Planejamento salvo');window.dispatchEvent(new CustomEvent('folga-updated'));
    }catch(e:any){setError(e.message);}finally{setSaving(false);}
  }
  async function remove(){
    setSaving(true);try{if(offId)await api.deleteDayOff(offId);else if(scheduleId)await api.deleteSchedule(scheduleId);setConfirm(false);setEditor(false);toast.success('Registro removido');window.dispatchEvent(new CustomEvent('folga-updated'));}catch(e:any){setError(e.message);setConfirm(false);}finally{setSaving(false);}
  }
  function move(direction:number){ const d=new Date(date+'T12:00:00');if(view==='mes'){d.setDate(1);d.setMonth(d.getMonth()+direction);setDate(dateKey(d));}else setDate(addDays(date,direction*(view==='semana'?7:1))); }
  return <div className="space-y-5">
    <div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-xl font-bold">Escala & Calendário</h1><p className="text-sm text-zinc-500">Dias habituais, folgas e convocações da equipe</p></div>{!isViewer&&<div className="flex flex-wrap gap-2"><Button onClick={()=>open(undefined,date,'convocacao')}>Convocar / ajustar dia</Button><Button onClick={()=>open()}>Nova folga</Button></div>}</div>
    <Card className="p-4 flex flex-wrap items-center gap-3"><Button aria-label="Período anterior" onClick={()=>move(-1)}>←</Button><Button onClick={()=>setDate(dateKey(new Date()))}>Hoje</Button><Button aria-label="Próximo período" onClick={()=>move(1)}>→</Button><Input aria-label="Data de referência" type="date" value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/><Select aria-label="Visualização" value={view} onChange={e=>setView(e.target.value as typeof view)} options={[{value:'mes',label:'Mês'},{value:'semana',label:'Semana'},{value:'dia',label:'Dia'}]}/><Select aria-label="Setor" value={department} onChange={e=>setDepartment(e.target.value)} options={[{value:'',label:'Todos os setores'},...Array.from(new Set(employees.map(e=>e.department))).map(d=>({value:d,label:d}))]}/></Card>
    {!editor&&error&&<p role="alert" className="text-red-600">{error}</p>}
      {view!=='dia'&&<p className="text-xs text-zinc-500 lg:hidden">Deslize o calendário para ver os outros dias →</p>}
    {loading?<p>Carregando escala…</p>:view==='mes'?<div className="overflow-x-auto overscroll-x-contain"><div className="grid grid-cols-7 gap-2 min-w-[784px]">{dates.map(d=><Card key={d} className="p-2 min-w-[110px]"><button className="font-semibold text-sm" onClick={()=>{setDate(d);setView('dia');}}>{new Date(d+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',weekday:'short'})}</button><div className="space-y-1 mt-2">{visible.filter(e=>state(e,d)!=='indefinido'&&(e.work_regime!=='Freelancer'||state(e,d)==='trabalho')).map(e=><button key={e.id} disabled={isViewer} onClick={()=>open(e,d,'escala')} className={`block w-full rounded p-1 text-left text-xs ${state(e,d)==='trabalho'?'bg-blue-50 text-blue-800':'bg-emerald-50 text-emerald-800'}`}>{e.name.split(' ')[0]} · {e.work_regime==='Freelancer'?'Convocado':labels[state(e,d)]}</button>)}</div></Card>)}</div></div>:<Card className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-3 text-left">Colaborador</th>{dates.map(d=><th className="p-3" key={d}>{new Date(d+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'})}</th>)}</tr></thead><tbody>{visible.map(emp=><tr key={emp.id} className="border-t border-zinc-200 dark:border-zinc-700"><td className="p-3"><strong>{emp.name}</strong><p className="text-xs text-zinc-500">{emp.department} · {emp.work_regime==='Freelancer'?'Freelancer':emp.work_schedule_type}</p></td>{dates.map(d=><td key={d} className="p-2 text-center"><button disabled={isViewer} onClick={()=>open(emp,d,'escala')} className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700">{emp.work_regime==='Freelancer'?(state(emp,d)==='trabalho'?'Convocado':'—'):labels[state(emp,d)]}</button></td>)}</tr>)}</tbody></table>{visible.length===0&&<p className="p-6 text-zinc-500">Nenhum colaborador neste período. Freelancers aparecem após a convocação.</p>}</Card>}
    <Modal isOpen={editor} onClose={()=>{if(!saving)setEditor(false);}} title={offId?'Editar folga':'Planejar dia'}><form onSubmit={save} className="space-y-4">
      {error&&<p role="alert" className="text-red-600">{error}</p>}
      <Select label="Colaborador" required disabled={!!offId||!!scheduleId} value={employeeId} onChange={e=>setEmployeeId(e.target.value)} options={[{value:'',label:'Selecione'},...employees.filter(e=>e.status!=='inativo').map(e=>({value:e.id,label:e.name+(e.work_regime==='Freelancer'?' · Freelancer':'')}))]}/>
      <Input label="Data" type="date" required disabled={!!scheduleId&&!offId} value={eventDate} onChange={e=>setEventDate(e.target.value)}/>
      <Select label="Registro" disabled={!!offId} value={kind} onChange={e=>setKind(e.target.value)} options={[{value:'folga',label:'Folga / descanso'},{value:'escala',label:'Convocação / ajuste de escala'}]}/>
      {kind==='folga'?<><Select label="Tipo de folga" value={offType} onChange={e=>setOffType(e.target.value as DayOffType)} options={[{value:'dsr',label:'Descanso semanal'},{value:'folga_compensatoria',label:'Compensatória'},{value:'ferias',label:'Férias'},{value:'ausencia_justificada',label:'Ausência justificada'},{value:'afastamento',label:'Afastamento'},{value:'outro',label:'Outro'}]}/><Select label="Situação informada" value={offStatus} onChange={e=>setOffStatus(e.target.value as DayOffStatus)} options={[{value:'planejada',label:'Planejada'},{value:'confirmada',label:'Confirmada'},{value:'realizada',label:'Realizada'}]}/></>:<><Select label="Atividade" value={status} onChange={e=>setStatus(e.target.value)} options={[{value:'trabalho',label:'Trabalho / convocação'},{value:'folga',label:'Descanso'},{value:'ferias',label:'Férias'},{value:'afastado',label:'Afastamento'}]}/><Select label="Turno" value={shift} onChange={e=>setShift(e.target.value)} options={[{value:'integral',label:'Integral'},{value:'manha',label:'Manhã'},{value:'tarde',label:'Tarde'},{value:'noite',label:'Noite'}]}/></>}
      {kind==='folga'&&['dsr','folga_compensatoria'].includes(offType)&&<RecurrenceFields date={eventDate} value={recurrence} onChange={setRecurrence}/>}
      <Input label="Observações" value={notes} onChange={e=>setNotes(e.target.value)}/><div className="flex justify-end gap-2">{(offId||scheduleId)&&<Button type="button" disabled={saving} onClick={()=>setConfirm(true)}>Remover registro</Button>}<Button type="submit" loading={saving}>Salvar</Button></div>
    </form></Modal>
    <ConfirmDialog isOpen={confirm} onClose={()=>setConfirm(false)} onConfirm={remove} title="Remover registro?" message="O planejamento voltará a considerar os dias habituais ou a ausência de convocação." confirmLabel="Remover" isDestructive/>
  </div>;
}
