import db from '../db/connection';
import { dateKey, addDays } from '../../shared/dates';
import { dayType, workDays } from '../../shared/schedule';
export const formatYMD = dateKey;
export function diffInDays(a: string, b: string) { return Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000); }
export interface EmployeeStatusCalculation {
    employeeId: number;
    name: string;
    department: string;
    position: string;
    status: string;
    workScheduleType: string;
    lastDayOff: string | null;
    nextDayOff: string | null;
    daysSinceLastDayOff: number | null;
    daysUntilNextDayOff: number | null;
    smartStatus: 'definida' | 'proxima' | 'pendente' | 'sem_escala';
    statusLabel: string;
    alertMessage?: string;
    isWorkingToday: boolean;
    isOffToday: boolean;
}
export function calculateStatus(employee: any, today: string, offs: any[], schedules: any[], alertDays = 6): EmployeeStatusCalculation {
    const offMap = new Map(offs.map(o => [o.date, o]));
    const scheduleMap = new Map(schedules.filter(s => s.notes !== 'Folga agendada').map(s => [s.date, s]));
    const state = (date: string) => dayType(employee, date, offMap.get(date), scheduleMap.get(date));
    const todayType = state(today);
    const result: EmployeeStatusCalculation = {
        employeeId: employee.id, name: employee.name, department: employee.department, position: employee.position,
        status: employee.status, workScheduleType: employee.work_schedule_type, lastDayOff: null, nextDayOff: null,
        daysSinceLastDayOff: null, daysUntilNextDayOff: null, smartStatus: 'sem_escala', statusLabel: 'Sem escala',
        isWorkingToday: todayType === 'trabalho', isOffToday: ['folga', 'ferias', 'afastamento'].includes(todayType)
    };
    if (employee.status !== 'ativo') {
        result.statusLabel = employee.status === 'ferias' ? 'Em férias' : employee.status === 'afastado' ? 'Em afastamento' : 'Inativo';
        return result;
    }
    if (employee.work_regime === 'Freelancer') {
        result.statusLabel = result.isWorkingToday ? 'Convocado hoje' : 'Sem convocação hoje';
        return result;
    }
    if (employee.work_schedule_type === '3x4' && workDays(employee).length !== 3) {
        result.smartStatus = 'pendente';
        result.statusLabel = 'Defina os três dias habituais';
        result.alertMessage = 'Configure os dias de trabalho da escala 3x4.';
        return result;
    }
    for (let i = 0; i <= 366; i++) {
        const d = addDays(today, -i);
        if (employee.hire_date && d < employee.hire_date)
            break;
        if (['folga', 'ferias', 'afastamento'].includes(state(d))) {
            result.lastDayOff = d;
            break;
        }
    }
    for (let i = 0; i <= 60; i++) {
        const d = addDays(today, i);
        if (['folga', 'ferias', 'afastamento'].includes(state(d))) {
            result.nextDayOff = d;
            break;
        }
    }
    result.daysSinceLastDayOff = result.lastDayOff ? diffInDays(today, result.lastDayOff) : null;
    result.daysUntilNextDayOff = result.nextDayOff ? diffInDays(result.nextDayOff, today) : null;
    let consecutive = 0;
    for (let i = 0; i <= 366 && state(addDays(today, -i)) === 'trabalho'; i++)
        consecutive++;
    const max = employee.work_schedule_type === '5x2' ? 5 : 6;
    const projected = consecutive + (result.daysUntilNextDayOff === null ? 0 : Math.max(0, result.daysUntilNextDayOff - 1));
    if (consecutive > max || projected > max) {
        result.smartStatus = 'pendente';
        result.statusLabel = 'Intervalo longo sem descanso';
        result.alertMessage = `${employee.name}: reveja a sequência de trabalho e antecipe o descanso.`;
    }
    else if (result.isOffToday) {
        result.smartStatus = 'definida';
        result.statusLabel = 'De folga hoje';
    }
    else if (!result.nextDayOff) {
        result.smartStatus = 'pendente';
        result.statusLabel = consecutive >= alertDays ? 'Programe o descanso' : 'Folga não definida';
        result.alertMessage = `${employee.name} ainda não possui descanso planejado.`;
    }
    else if (result.daysUntilNextDayOff! <= 2) {
        result.smartStatus = 'proxima';
        result.statusLabel = `Folga em ${result.daysUntilNextDayOff} dia(s)`;
    }
    else {
        result.smartStatus = 'definida';
        result.statusLabel = 'Folga planejada';
    }
    return result;
}
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
