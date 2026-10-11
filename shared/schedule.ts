export type DayType = 'trabalho' | 'folga' | 'ferias' | 'afastamento' | 'indefinido';
export interface ScheduleEmployee {
  id: number; status: string; work_regime: string; work_schedule_type: string;
  weekly_work_days?: string | number[]; hire_date?: string;
}
export function workDays(employee: ScheduleEmployee): number[] {
  try {
    const days = typeof employee.weekly_work_days === 'string' ? JSON.parse(employee.weekly_work_days) : employee.weekly_work_days;
    return Array.isArray(days) ? days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  } catch { return []; }
}
export function dayType(employee: ScheduleEmployee, date: string, off?: {type: string}, schedule?: {status: string; notes?: string}): DayType {
  if (employee.status === 'inativo' || (employee.hire_date && date < employee.hire_date)) return 'indefinido';
  if (off) return off.type === 'ferias' ? 'ferias' : off.type === 'afastamento' ? 'afastamento' : 'folga';
  if (schedule?.notes === 'Folga agendada') schedule=undefined;
  if (schedule) return schedule.status === 'afastado' ? 'afastamento' : schedule.status as DayType;
  if (employee.status === 'ferias') return 'ferias';
  if (employee.status === 'afastado') return 'afastamento';
  if (employee.work_regime === 'Freelancer') return 'indefinido';
  const days = workDays(employee);
  if (days.length) return days.includes(new Date(date + 'T12:00:00').getDay()) ? 'trabalho' : 'folga';
  if (employee.work_schedule_type === '3x4' || employee.work_schedule_type === '12x36' || employee.work_schedule_type === 'flexivel') return 'indefinido';
  return 'trabalho';
}
