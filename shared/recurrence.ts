import { addDays, validDate } from './dates';

export interface OffRecurrence {
  weekly: boolean;
  sundays: number[];
  until: string;
}

// Inclui a data inicial e combina as regras, sem duplicar um domingo semanal.
export function recurrenceDates(start: string, rule: OffRecurrence): string[] {
  if (!validDate(start) || !rule || !validDate(rule.until) || rule.until < start || rule.until > addDays(start, 366)) {
    throw new Error('Escolha um período válido de até um ano para a repetição.');
  }
  if (typeof rule.weekly !== 'boolean' || !Array.isArray(rule.sundays) || rule.sundays.some(n => !Number.isInteger(n) || n < 1 || n > 5) || new Set(rule.sundays).size !== rule.sundays.length || (!rule.weekly && !rule.sundays.length)) {
    throw new Error('Selecione a repetição semanal ou os domingos do mês.');
  }
  const dates = [start];
  let offset = 1;
  for (let date = addDays(start, 1); date <= rule.until; date = addDays(date, 1), offset++) {
    const parsed = new Date(date + 'T12:00:00');
    if ((rule.weekly && offset % 7 === 0) || (parsed.getDay() === 0 && rule.sundays.includes(Math.ceil(parsed.getDate() / 7)))) dates.push(date);
  }
  return dates;
}
