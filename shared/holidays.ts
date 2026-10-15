import { addDays, validDate } from './dates';

export type HolidayKind = 'nacional' | 'religioso_local' | 'ponto_facultativo';
export interface Holiday { date: string; name: string; kind: HolidayKind }
export interface HolidayCoverage extends Holiday {
  working: number; off: number; unavailable: number; undefined: number;
}
export interface HolidaySummary {
  referenceDate: string;
  month: HolidayCoverage[];
  week: HolidayCoverage[];
  today: HolidayCoverage[];
  next: HolidayCoverage | null;
}
export const holidayLabels: Record<HolidayKind, string> = {
  nacional: 'Feriado nacional',
  religioso_local: 'Feriado religioso · confirmar lei municipal',
  ponto_facultativo: 'Ponto facultativo · referência federal',
};
export function brazilToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
// Gregorian computus. Civil dates are kept as YYYY-MM-DD, never parsed as UTC midnight.
export function easterDate(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export function holidaysForYear(year: number): Holiday[] {
  if (!Number.isInteger(year) || year < 1900 || year > 9998) throw new Error('Ano fora do intervalo suportado.');
  const fixed: [string, string][] = [
    ['01-01', 'Confraternização Universal'], ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência do Brasil'], ['10-12', 'Nossa Senhora Aparecida'],
    ['11-02', 'Finados'], ['11-15', 'Proclamação da República'], ['12-25', 'Natal'],
  ];
  if (year >= 2024) fixed.push(['11-20', 'Dia Nacional de Zumbi e da Consciência Negra']);
  const easter = easterDate(year);
  return [
    ...fixed.map(([date, name]): Holiday => ({ date: `${year}-${date}`, name, kind: 'nacional' })),
    { date: addDays(easter, -48), name: 'Carnaval (segunda-feira)', kind: 'ponto_facultativo' as const },
    { date: addDays(easter, -47), name: 'Carnaval (terça-feira)', kind: 'ponto_facultativo' as const },
    { date: addDays(easter, -2), name: 'Sexta-feira da Paixão', kind: 'religioso_local' as const },
    { date: addDays(easter, 60), name: 'Corpus Christi', kind: 'ponto_facultativo' as const },
  ].sort((a, b) => a.date.localeCompare(b.date));
}
export function holidaysBetween(start: string, end: string): Holiday[] {
  if (!validDate(start) || !validDate(end) || start > end) throw new Error('Período inválido.');
  const first = Number(start.slice(0, 4)), last = Number(end.slice(0, 4));
  if (first < 1900 || last > 9998 || last - first > 2) throw new Error('Consulte no máximo três anos entre 1900 e 9998.');
  return Array.from({ length: last - first + 1 }, (_, index) => holidaysForYear(first + index)).flat().filter(h => h.date >= start && h.date <= end);
}
export function holidaySummaryDates(referenceDate: string) {
  if (!validDate(referenceDate)) throw new Error('Data inválida.');
  const date = new Date(referenceDate + 'T12:00:00');
  const weekStart = addDays(referenceDate, -((date.getDay() + 6) % 7));
  const week = holidaysBetween(weekStart, addDays(weekStart, 6));
  const month = holidaysForYear(date.getFullYear()).filter(h => h.date.startsWith(referenceDate.slice(0, 7)));
  const next = holidaysBetween(referenceDate, `${date.getFullYear() + 1}-12-31`).find(h => h.kind === 'nacional') || null;
  return { month, week, today: month.filter(h => h.date === referenceDate), next };
}
export function holidayNoticeCandidates(today: string) {
  return holidaysBetween(today, addDays(today, 7)).filter(h => h.kind === 'nacional').map(h => ({
    ...h, sourceKey: `holiday:${h.date}:${h.date === today ? 'today' : 'upcoming'}`,
    title: h.date === today ? `Hoje é feriado: ${h.name}` : `Feriado nos próximos 7 dias: ${h.name}`,
    message: `${h.date.split('-').reverse().join('/')} · Confira a cobertura da equipe na escala.`,
  }));
}
