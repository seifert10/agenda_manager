import React from 'react';
import Input from '../ui/Input';
import { addDays, validDate } from '../../../shared/dates';
import { OffRecurrence, recurrenceDates } from '../../../shared/recurrence';

export default function RecurrenceFields({ date, value, onChange }: {date: string; value: OffRecurrence | null; onChange: (value: OffRecurrence | null) => void}) {
  let dates: string[] = [];
  let error = '';
  if (value) {
    try { dates = recurrenceDates(date, value); } catch (e) { error = (e as Error).message; }
  }
  const weekday = validDate(date) ? new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', {weekday: 'long'}) : 'dia escolhido';
  return <fieldset className="space-y-3 rounded-xl border border-zinc-200 dark:border-zinc-700 p-3">
    <legend className="text-sm font-medium px-1">Repetição automática</legend>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked ? {weekly:true,sundays:[],until:validDate(date)?addDays(date,90):''} : null)} />Repetir esta folga</label>
    {value && <>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.weekly} onChange={e=>onChange({...value,weekly:e.target.checked})} />Toda semana: {weekday}</label>
      <div className="space-y-2"><p className="text-xs font-medium">Também marcar estes domingos de cada mês:</p><div className="flex flex-wrap gap-3">{[1,2,3,4,5].map(n=><label key={n} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={value.sundays.includes(n)} onChange={()=>onChange({...value,sundays:value.sundays.includes(n)?value.sundays.filter(day=>day!==n):[...value.sundays,n]})}/>{n}º domingo</label>)}</div><p className="text-xs text-zinc-500">O 5º domingo é incluído somente nos meses em que existir.</p></div>
      <Input label="Repetir até" type="date" required min={date} max={validDate(date)?addDays(date,366):undefined} value={value.until} onChange={e=>onChange({...value,until:e.target.value})}/>
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : <details className="text-xs"><summary className="cursor-pointer font-medium">Ver as {dates.length} datas previstas</summary><p className="mt-2 leading-relaxed">{dates.map(d=>new Date(d+'T12:00:00').toLocaleDateString('pt-BR')).join(' · ')}</p></details>}
      <p className="text-xs text-zinc-500">Ao salvar, as próximas folgas ficam planejadas até a data final. Folgas existentes e ajustes de escala serão preservados. Cada folga poderá ser editada individualmente.</p>
    </>}
  </fieldset>;
}
