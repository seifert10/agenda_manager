import db from '../db/connection';
import { AuthenticatedUser } from '../middlewares/auth';
import { holidaySummaryDates, Holiday, HolidayCoverage, HolidaySummary } from '../../shared/holidays';
import { dayType } from '../../shared/schedule';

export async function holidaySummaryFor(user: AuthenticatedUser, referenceDate: string): Promise<HolidaySummary> {
  const dates = holidaySummaryDates(referenceDate);
  const all = [...dates.month, ...dates.week, ...(dates.next ? [dates.next] : [])];
  const unique = [...new Set(all.map(h => h.date))].sort();
  const employees = (await db.prepare('SELECT * FROM employees').all() as any[])
    .filter(e => e.status !== 'inativo' && (user.role === 'ADMIN' || user.departmentIds.includes(e.department_id)));
  const coverage = new Map<string, HolidayCoverage>();
  if (unique.length) {
    const [offs, schedules] = await Promise.all([
      db.prepare('SELECT * FROM days_off WHERE date BETWEEN ? AND ?').all(unique[0], unique[unique.length - 1]),
      db.prepare('SELECT * FROM work_schedules WHERE date BETWEEN ? AND ?').all(unique[0], unique[unique.length - 1]),
    ]) as [any[], any[]];
    const offMap = new Map(offs.map(o => [`${o.employee_id}:${o.date}`, o]));
    const scheduleMap = new Map(schedules.map(s => [`${s.employee_id}:${s.date}`, s]));
    for (const holiday of all) {
      if (coverage.has(holiday.date)) continue;
      const counts: HolidayCoverage = { ...holiday, working: 0, off: 0, unavailable: 0, undefined: 0 };
      for (const employee of employees) {
        const key = `${employee.id}:${holiday.date}`;
        const type = dayType(employee, holiday.date, offMap.get(key), scheduleMap.get(key));
        if (type === 'trabalho') counts.working++;
        else if (type === 'folga') counts.off++;
        else if (type === 'indefinido') counts.undefined++;
        else counts.unavailable++;
      }
      coverage.set(holiday.date, counts);
    }
  }
  const enrich = (h: Holiday) => coverage.get(h.date)!;
  return { referenceDate, month: dates.month.map(enrich), week: dates.week.map(enrich), today: dates.today.map(enrich), next: dates.next ? enrich(dates.next) : null };
}
