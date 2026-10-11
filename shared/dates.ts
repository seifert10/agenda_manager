export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T12:00:00');
  return Number.isFinite(parsed.getTime()) && dateKey(parsed) === value;
}
export function addDays(date: string, count: number): string {
  const result = new Date(date + 'T12:00:00');
  result.setDate(result.getDate() + count);
  return dateKey(result);
}
