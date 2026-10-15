import Card from '../ui/Card';
import { HolidayCoverage, HolidaySummary } from '../../../shared/holidays';
import HolidayLabel from '../calendar/HolidayLabel';

export default function HolidaysCard({ summary, onViewDate }: { summary: HolidaySummary; onViewDate: (date: string) => void }) {
  const rows = [...new Map([...summary.month, ...summary.week, ...(summary.next ? [summary.next] : [])].map(h => [h.date, h])).values()].sort((a, b) => a.date.localeCompare(b.date));
  const timing = (h: HolidayCoverage) => h.date === summary.referenceDate ? 'Hoje' : summary.week.some(w => w.date === h.date) ? 'Nesta semana' : h.date === summary.next?.date ? 'Próximo feriado' : '';
  return <Card className="p-5">
    <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Feriados do mês</h2>
    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Planeje a cobertura dos seus setores. As datas não alteram as folgas automaticamente.</p>
    {!summary.month.length && <p className="text-xs mt-3 text-zinc-500">Nenhum feriado ou ponto facultativo de referência neste mês.</p>}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
      {rows.map(h => <div key={h.date} className="p-3 rounded-xl bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800">
        <div className="flex justify-between gap-2 text-xs text-violet-900 dark:text-violet-200">
          <time dateTime={h.date}>{new Date(h.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</time>
          <strong>{timing(h)}</strong>
        </div>
        <HolidayLabel holiday={h} />
        <p className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">{h.working} trabalhando · {h.off} de folga</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{h.unavailable} em férias/afastamento · {h.undefined} sem escala</p>
        <button type="button" onClick={() => onViewDate(h.date)} className="mt-2 min-h-11 text-xs font-semibold text-violet-800 dark:text-violet-200 underline underline-offset-2">Ver escala de {h.date.split('-').reverse().join('/')}</button>
      </div>)}
    </div>
  </Card>;
}
