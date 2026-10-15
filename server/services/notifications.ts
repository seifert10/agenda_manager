import db from '../db/connection';
import { AuthenticatedUser } from '../middlewares/auth';
import { calculateEmployeeStatus } from './dsrRules';
import { brazilToday, holidayNoticeCandidates } from '../../shared/holidays';
export async function notificationsFor(user: AuthenticatedUser, today = brazilToday()): Promise<any[]> {
    const employees = await db.prepare('SELECT * FROM employees').all() as any[];
    const keys: string[] = [];
    for (const emp of employees) {
        if (user.role !== 'ADMIN' && !user.departmentIds.includes(emp.department_id))
            continue;
        const status = await calculateEmployeeStatus(emp);
        if (status.smartStatus !== 'pendente')
            continue;
        const key = `pending:${emp.id}:${today}`;
        keys.push(key);
        await db.prepare(`INSERT INTO notifications(type,title,message,related_id,department_id,source_key)
      VALUES ('aviso',?,?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET title=excluded.title,message=excluded.message,department_id=excluded.department_id`)
            .run(status.statusLabel, status.alertMessage || 'Planejamento pendente', emp.id, emp.department_id, key);
    }
    if (user.role === 'ADMIN' || user.departmentIds.length > 0) {
        for (const holiday of holidayNoticeCandidates(today)) {
            keys.push(holiday.sourceKey);
            await db.prepare(`INSERT INTO notifications(type,title,message,department_id,source_key)
              VALUES ('info',?,?,NULL,?) ON CONFLICT(source_key) DO UPDATE SET title=excluded.title,message=excluded.message`)
                .run(holiday.title, holiday.message, holiday.sourceKey);
        }
    }
    const rows = await db.prepare(`SELECT n.id,n.type,n.title,n.message,n.related_id,n.department_id,n.source_key,n.created_at, CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END AS is_read
    FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=?
    ORDER BY is_read ASC, n.created_at DESC, n.id DESC`).all(user.id) as any[];
    return rows.filter(n => (user.role === 'ADMIN' || user.departmentIds.includes(n.department_id) || (n.department_id === null && user.departmentIds.length > 0)) && (!n.source_key || keys.includes(n.source_key)));
}
