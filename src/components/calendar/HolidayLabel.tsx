import { Holiday, holidayLabels } from '../../../shared/holidays';

export const holidayHeaderClass = 'bg-violet-50 dark:bg-violet-950/40 text-violet-900 dark:text-violet-200 rounded-lg';
export default function HolidayLabel({ holiday }: { holiday?: Holiday }) {
  if (!holiday) return null;
  return <span className="block mt-1 text-[10px] font-medium leading-snug text-violet-800 dark:text-violet-200">
    <span className="block font-semibold">{holidayLabels[holiday.kind]}</span>
    <span className="block">{holiday.name}</span>
  </span>;
}
