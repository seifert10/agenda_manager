import { Router } from 'express';
import db, { transaction } from '../db/connection';
import { requireAuth, requireMutation, AuthRequest } from '../middlewares/auth';
import { createOff, createRecurringOffs, saveOff, removeOff, employeeFor, DomainError } from '../services/daysOff';
const router = Router();
router.use(requireAuth);
const fail = (res: any, error: any) => res.status(error instanceof DomainError ? error.status : 500).json({ error: error instanceof DomainError ? error.message : 'Erro ao salvar folga.' });
// Listar folgas com filtragem por escopo
router.get('/', async (req: AuthRequest, res) => {
    try {
        const user = req.user!;
        const { startDate, endDate, employeeId, type, month } = req.query;
        let sql = `
      SELECT d.*, e.name as employee_name, e.department, e.position, e.department_id
      FROM days_off d
      JOIN employees e ON e.id = d.employee_id
      WHERE 1=1
    `;
        const params: any[] = [];
        // Isolamento por escopo de setores
        if (user.role !== 'ADMIN') {
            if (user.departmentIds.length === 0)
                return res.json([]);
            const placeholders = user.departmentIds.map(() => '?').join(',');
            sql += ` AND e.department_id IN (${placeholders})`;
            params.push(...user.departmentIds);
        }
        if (employeeId) {
            sql += ` AND d.employee_id = ?`;
            params.push(employeeId);
        }
        if (type) {
            sql += ` AND d.type = ?`;
            params.push(type);
        }
        if (month) {
            sql += ` AND d.date LIKE ?`;
            params.push(`${month}%`);
        }
        else {
            if (startDate) {
                sql += ` AND d.date >= ?`;
                params.push(startDate);
            }
            if (endDate) {
                sql += ` AND d.date <= ?`;
                params.push(endDate);
            }
        }
        sql += ` ORDER BY d.date ASC, e.name ASC`;
        const daysOff = await db.prepare(sql).all(...params);
        res.json(daysOff);
    }
    catch (error: any) {
        console.error('Erro ao listar folgas:', error);
        res.status(500).json({ error: 'Erro ao buscar folgas' });
    }
});
router.post('/', requireMutation, async (req: AuthRequest, res) => {
    if (req.body.recurrence) {
        try {
            return res.status(201).json({ ...await createRecurringOffs(req.user!, req.body), message: 'Folgas recorrentes planejadas' });
        }
        catch (error) {
            return fail(res, error);
        }
    }
    try {
        const id = await transaction(() => createOff(req.user!, req.body));
        res.status(201).json({ id, message: 'Folga agendada com sucesso' });
    }
    catch (error) {
        fail(res, error);
    }
});
router.put('/:id', requireMutation, async (req: AuthRequest, res) => {
    try {
        const result = await saveOff(req.user!, Number(req.params.id), req.body);
        res.json({ ...result, message: 'Folga atualizada' });
    }
    catch (error) {
        fail(res, error);
    }
});
router.delete('/:id', requireMutation, async (req: AuthRequest, res) => {
    try {
        await removeOff(req.user!, Number(req.params.id));
        res.json({ message: 'Folga excluída' });
    }
    catch (error) {
        fail(res, error);
    }
});
router.post('/batch', requireMutation, async (req: AuthRequest, res) => {
    try {
        const items = req.body.items;
        if (!Array.isArray(items) || !items.length || items.length > 500)
            throw new DomainError('Informe entre 1 e 500 folgas.');
        for (const item of items) await employeeFor(req.user!, Number(item.employee_id));
        await transaction(async () => {for (const item of items) await createOff(req.user!, item);});
        res.json({ success: true, insertedCount: items.length, errors: [] });
    }
    catch (error) {
        fail(res, error);
    }
});
export default router;
