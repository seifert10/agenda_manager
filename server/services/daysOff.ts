import db, { transaction } from '../db/connection';
import { AuthenticatedUser, recordAuditLog } from '../middlewares/auth';
import { validDate } from '../../shared/dates';
import { recurrenceDates } from '../../shared/recurrence';
export class DomainError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
export async function employeeFor(user: AuthenticatedUser, id: number): Promise<any> {
    if (!Number.isInteger(id) || id < 1)
        throw new DomainError('Colaborador inválido.');
    const employee: any = await db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    if (!employee)
        throw new DomainError('Colaborador não encontrado.', 404);
    if (user.role !== 'ADMIN' && !user.departmentIds.includes(employee.department_id))
        throw new DomainError('Acesso negado a este setor.', 403);
    return employee;
}
export function validateOff(data: any) {
    if (!validDate(data.date))
        throw new DomainError('Data inválida.');
    if (!['dsr', 'folga_compensatoria', 'ferias', 'ausencia_justificada', 'afastamento', 'outro'].includes(data.type))
        throw new DomainError('Tipo de folga inválido.');
    if (!['planejada', 'confirmada', 'realizada'].includes(data.status))
        throw new DomainError('Status de folga inválido.');
    if (data.notes != null && typeof data.notes !== 'string')
        throw new DomainError('Observação inválida.');
}
async function audit(user: AuthenticatedUser, emp: any, id: number, action: string, before: any, after: any) {
    await recordAuditLog({ employeeId: emp.id, userId: user.id, userName: user.name, departmentId: emp.department_id, entity: 'days_off', entityId: id, action, oldValue: before ? JSON.stringify(before) : null, newValue: after ? JSON.stringify(after) : null, details: `${user.name}: ${action} para ${emp.name}.` });
}
export async function createOff(user: AuthenticatedUser, input: any) {
    const emp = await employeeFor(user, Number(input.employee_id));
    const data = { type: 'dsr', status: 'confirmada', notes: '', ...input };
    validateOff(data);
    if (await db.prepare('SELECT id FROM days_off WHERE employee_id = ? AND date = ?').get(emp.id, data.date))
        throw new DomainError('Já existe uma folga cadastrada para este colaborador nesta mesma data.');
    const result = await db.prepare('INSERT INTO days_off(employee_id,date,type,status,notes) VALUES (?,?,?,?,?)').run(emp.id, data.date, data.type, data.status, data.notes || null);
    const id = Number(result.lastInsertRowid);
    await audit(user, emp, id, 'CRIOU_FOLGA', null, data);
    return id;
}
export async function saveOff(user: AuthenticatedUser, id: number, input: any) {
    return await transaction(async () => {
        const old: any = await db.prepare('SELECT * FROM days_off WHERE id = ?').get(id);
        if (!old)
            throw new DomainError('Folga não encontrada.', 404);
        const emp = await employeeFor(user, old.employee_id);
        const data = { ...old, ...input };
        validateOff(data);
        if (await db.prepare('SELECT id FROM days_off WHERE employee_id = ? AND date = ? AND id <> ?').get(emp.id, data.date, id))
            throw new DomainError('Já existe folga nesta data.');
        await db.prepare("UPDATE days_off SET date=?,type=?,status=?,notes=?,updated_at=datetime('now','localtime') WHERE id=?").run(data.date, data.type, data.status, data.notes || null, id);
        await audit(user, emp, id, 'ALTEROU_FOLGA', old, data);
        if (input.recurrence)
            return await generateRecurringOffs(user, { ...data, employee_id: emp.id });
    });
}
async function generateRecurringOffs(user: AuthenticatedUser, input: any) {
    const emp = await employeeFor(user, Number(input.employee_id));
    if (emp.status !== 'ativo')
        throw new DomainError('Repetição disponível somente para colaboradores ativos.');
    if (!['dsr', 'folga_compensatoria'].includes(input.type ?? 'dsr'))
        throw new DomainError('Use repetição para descanso semanal ou folga compensatória.');
    const data = { type: 'dsr', status: 'confirmada', notes: '', ...input };
    validateOff(data);
    let dates: string[];
    try {
        dates = recurrenceDates(data.date, input.recurrence);
    }
    catch (e) {
        throw new DomainError((e as Error).message);
    }
    const insertedDates: string[] = [], skippedDates: string[] = [];
    for (const date of dates) {
        const off = await db.prepare('SELECT id FROM days_off WHERE employee_id=? AND date=?').get(emp.id, date);
        const schedule = await db.prepare("SELECT id FROM work_schedules WHERE employee_id=? AND date=? AND COALESCE(notes,'') <> 'Folga agendada'").get(emp.id, date);
        if (off || schedule) {
            skippedDates.push(date);
            continue;
        }
        await createOff(user, { ...data, employee_id: emp.id, date, status: date === data.date ? data.status : 'planejada' });
        insertedDates.push(date);
    }
    return { insertedCount: insertedDates.length, insertedDates, skippedDates };
}
export async function createRecurringOffs(user: AuthenticatedUser, input: any) {
    return await transaction(() => generateRecurringOffs(user, input));
}
export async function removeOff(user: AuthenticatedUser, id: number) {
    return await transaction(async () => {
        const old: any = await db.prepare('SELECT * FROM days_off WHERE id = ?').get(id);
        if (!old)
            throw new DomainError('Folga não encontrada.', 404);
        const emp = await employeeFor(user, old.employee_id);
        await audit(user, emp, id, 'EXCLUIU_FOLGA', old, null);
        await db.prepare('DELETE FROM days_off WHERE id=?').run(id);
    });
}
