import db from '../db/connection';
import { calculateStatus,formatYMD,type EmployeeStatusCalculation } from '../../shared/employee-status';
export { calculateStatus,formatYMD,diffInDays,type EmployeeStatusCalculation } from '../../shared/employee-status';
export async function calculateEmployeeStatus(employee: any, today = formatYMD(new Date())): Promise<EmployeeStatusCalculation> {
    const offs = await db.prepare('SELECT * FROM days_off WHERE employee_id = ?').all(employee.id);
    const schedules = await db.prepare('SELECT * FROM work_schedules WHERE employee_id = ?').all(employee.id);
    const setting: any = await db.prepare("SELECT value FROM settings WHERE key = 'clt_alert_days'").get();
    return calculateStatus(employee, today, offs, schedules, Math.min(6, Math.max(1, Number(setting?.value) || 6)));
}
export async function checkDayOffConflict(employeeId: number, date: string) {
    const duplicate = await db.prepare('SELECT id FROM days_off WHERE employee_id = ? AND date = ?').get(employeeId, date);
    if (duplicate)
        return { hasConflict: true, code: 'DUPLICATE_DAY_OFF', message: 'Já existe uma folga cadastrada para este colaborador nesta mesma data.', warning: undefined };
    return { hasConflict: false, warning: undefined };
}
