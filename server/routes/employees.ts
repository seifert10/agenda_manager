import { Router } from 'express';
import {asyncHandler} from '../utils/asyncHandler';
import db, { transaction } from '../db/connection';
import { validDate } from '../../shared/dates';
import { isValidCPF, formatCPF } from '../utils/cpf';
import { calculateEmployeeStatus, formatYMD } from '../services/dsrRules';
import { requireAuth, requireMutation, AuthRequest, recordAuditLog, hasDepartmentAccess, hasEmployeeAccess } from '../middlewares/auth';
const router = Router();
router.use(requireAuth);
router.use(asyncHandler(async (req: AuthRequest, res, next) => {
    if (!['POST', 'PUT'].includes(req.method))
        return next();
    const body = req.body;
    const old: any = req.method === 'PUT' ? await db.prepare('SELECT * FROM employees WHERE id=?').get(Number(req.params.id || req.path.split('/')[1])) : null;
    if (body.hire_date !== undefined && !validDate(body.hire_date))
        return res.status(400).json({ error: 'Data de admissão inválida.' });
    if (body.work_regime !== undefined && !['CLT', 'Estágio', 'PJ', 'Freelancer'].includes(body.work_regime))
        return res.status(400).json({ error: 'Regime inválido.' });
    if (body.work_schedule_type !== undefined && !['6x1', '5x2', '3x4', '12x36', 'flexivel'].includes(body.work_schedule_type))
        return res.status(400).json({ error: 'Escala inválida.' });
    if (body.status !== undefined && !['ativo', 'ferias', 'afastado', 'inativo'].includes(body.status))
        return res.status(400).json({ error: 'Status inválido.' });
    if (body.weekly_hours !== undefined && (!Number.isFinite(Number(body.weekly_hours)) || Number(body.weekly_hours) < 0 || Number(body.weekly_hours) > 168))
        return res.status(400).json({ error: 'Carga horária inválida.' });
    let days: any = body.weekly_work_days ?? (old?.weekly_work_days ? JSON.parse(old.weekly_work_days) : []);
    if (!Array.isArray(days) || days.some((d: any) => !Number.isInteger(d) || d < 0 || d > 6) || new Set(days).size !== days.length)
        return res.status(400).json({ error: 'Dias habituais inválidos.' });
    const regime = body.work_regime ?? old?.work_regime;
    const model = body.work_schedule_type ?? old?.work_schedule_type;
    if (regime === 'Freelancer')
        days = [];
    else if (model === '3x4' && days.length !== 3)
        return res.status(400).json({ error: 'Selecione exatamente três dias de trabalho.' });
    else if (days.length && ((model === '6x1' && days.length !== 6) || (model === '5x2' && days.length !== 5)))
        return res.status(400).json({ error: 'Quantidade de dias incompatível com a escala.' });
    body.weekly_work_days = days;
    next();
}));
// Listar funcionários com filtragem estrita por escopo de setores
router.get('/', async (req: AuthRequest, res) => {
    try {
        const user = req.user!;
        const { search, department, status, workSchedule } = req.query;
        let sql = `
      SELECT e.*, d.name as department_name
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE 1=1
    `;
        const params: any[] = [];
        // Isolamento por escopo de setor (ADMIN tem acesso global; MANAGER e VIEWER restritos aos seus setores)
        if (user.role !== 'ADMIN') {
            if (user.departmentIds.length === 0) {
                return res.json([]);
            }
            const placeholders = user.departmentIds.map(() => '?').join(',');
            sql += ` AND e.department_id IN (${placeholders})`;
            params.push(...user.departmentIds);
        }
        if (search) {
            sql += ` AND (e.name LIKE ? OR e.cpf LIKE ? OR e.position LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (department) {
            sql += ` AND (e.department = ? OR d.name = ?)`;
            params.push(department, department);
        }
        if (status) {
            sql += ` AND e.status = ?`;
            params.push(status);
        }
        if (workSchedule) {
            sql += ` AND e.work_schedule_type = ?`;
            params.push(workSchedule);
        }
        sql += ` ORDER BY e.name ASC`;
        const employees = await db.prepare(sql).all(...params) as any[];
        const todayStr = formatYMD(new Date());
        const enriched = await Promise.all(employees.map(async (emp) => {
            const calc = await calculateEmployeeStatus(emp, todayStr);
            return {
                ...emp,
                department: emp.department_name || emp.department,
                cpfFormatted: formatCPF(emp.cpf),
                lastDayOff: calc.lastDayOff,
                nextDayOff: calc.nextDayOff,
                daysSinceLastDayOff: calc.daysSinceLastDayOff,
                daysUntilNextDayOff: calc.daysUntilNextDayOff,
                smartStatus: calc.smartStatus,
                statusLabel: calc.statusLabel,
                alertMessage: calc.alertMessage,
                isWorkingToday: calc.isWorkingToday,
                isOffToday: calc.isOffToday
            };
        }));
        res.json(enriched);
    }
    catch (error: any) {
        console.error('Erro ao listar funcionários:', error);
        res.status(500).json({ error: 'Erro ao buscar funcionários' });
    }
});
// Detalhes completos do funcionário com bloqueio estrito 403 Forbidden fora do escopo
router.get('/:id', async (req: AuthRequest, res) => {
    try {
        const user = req.user!;
        const id = parseInt(req.params.id, 10);
        const employee: any = await db.prepare(`
      SELECT e.*, d.name as department_name
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.id = ?
    `).get(id);
        if (!employee) {
            return res.status(404).json({ error: 'Funcionário não encontrado' });
        }
        // REGRA CRÍTICA DE SEGURANÇA: Se o funcionário estiver fora do escopo do usuário, retornar 403 Forbidden
        if (user.role !== 'ADMIN' && !user.departmentIds.includes(employee.department_id)) {
            return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para visualizar colaboradores deste setor.' });
        }
        const todayStr = formatYMD(new Date());
        const calc = await calculateEmployeeStatus(employee, todayStr);
        const pastDaysOff = await db.prepare(`
      SELECT * FROM days_off
      WHERE employee_id = ? AND date <= ?
      ORDER BY date DESC
      LIMIT 20
    `).all(id, todayStr) as any[];
        const futureDaysOff = await db.prepare(`
      SELECT * FROM days_off
      WHERE employee_id = ? AND date > ?
      ORDER BY date ASC
      LIMIT 20
    `).all(id, todayStr) as any[];
        const auditTrail = await db.prepare(`
      SELECT * FROM audit_logs
      WHERE employee_id = ?
      ORDER BY created_at DESC
      LIMIT 30
    `).all(id) as any[];
        const currentMonthPrefix = todayStr.substring(0, 7);
        const daysOffThisMonth: any = await db.prepare(`
      SELECT count(*) as total FROM days_off
      WHERE employee_id = ? AND date LIKE ?
    `).get(id, `${currentMonthPrefix}%`);
        const daysWorkedThisMonth: any = await db.prepare(`
      SELECT count(*) as total FROM work_schedules
      WHERE employee_id = ? AND date LIKE ? AND status = 'trabalho'
    `).get(id, `${currentMonthPrefix}%`);
        res.json({
            ...employee,
            department: employee.department_name || employee.department,
            cpfFormatted: formatCPF(employee.cpf),
            calc,
            pastDaysOff,
            futureDaysOff,
            auditTrail,
            metrics: {
                daysOffThisMonth: daysOffThisMonth.total || 0,
                daysWorkedThisMonth: daysWorkedThisMonth.total || 0,
                lastDayOff: calc.lastDayOff,
                nextDayOff: calc.nextDayOff,
                daysSinceLastDayOff: calc.daysSinceLastDayOff
            }
        });
    }
    catch (error: any) {
        console.error('Erro ao buscar detalhes do funcionário:', error);
        res.status(500).json({ error: 'Erro ao carregar perfil do funcionário' });
    }
});
// Cadastrar novo funcionário com verificação de escopo e bloqueio de VIEWER
router.post('/', requireMutation, async (req: AuthRequest, res) => {
    try {
        const user = req.user!;
        const { name, cpf, position, department, department_id, hire_date, work_regime = 'CLT', weekly_hours = 44, work_schedule_type = '6x1', avatar_url, status = 'ativo' } = req.body;
        if (!name || !cpf || !position || (!department && !department_id) || !hire_date) {
            return res.status(400).json({ error: 'Campos obrigatórios: Nome, CPF, Cargo, Setor e Data de Admissão.' });
        }
        let resolvedDeptId: number | null = department_id ? Number(department_id) : null;
        let resolvedDeptName = department ? String(department).trim() : '';
        if (resolvedDeptId) {
            const deptRow: any = await db.prepare(`SELECT name FROM departments WHERE id = ?`).get(resolvedDeptId);
            if (deptRow)
                resolvedDeptName = deptRow.name;
        }
        else if (resolvedDeptName) {
            const deptRow: any = await db.prepare(`SELECT id FROM departments WHERE lower(name) = ?`).get(resolvedDeptName.toLowerCase());
            if (deptRow)
                resolvedDeptId = deptRow.id;
        }
        if (!resolvedDeptId || !await db.prepare('SELECT id FROM departments WHERE id=? AND active=1').get(resolvedDeptId))
            return res.status(400).json({ error: 'Selecione um setor ativo válido.' });
        const finalDeptId: number = resolvedDeptId!;
        // REGRA DE SEGURANÇA: Gestor só pode criar colaborador em setores autorizados
        if (user.role !== 'ADMIN' && !user.departmentIds.includes(finalDeptId)) {
            return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para cadastrar colaboradores neste setor.' });
        }
        const cleanCPF = String(cpf).replace(/\D/g, '');
        if (!isValidCPF(cleanCPF)) {
            return res.status(400).json({ error: 'CPF inválido. Verifique os dígitos verificadores informados.' });
        }
        const existing = await db.prepare(`SELECT id FROM employees WHERE cpf = ?`).get(cleanCPF);
        if (existing) {
            return res.status(400).json({ error: 'Já existe um funcionário cadastrado com este CPF.' });
        }
        const insert = db.prepare(`
      INSERT INTO employees (name, cpf, position, department, department_id, hire_date, work_regime, weekly_hours, work_schedule_type, avatar_url, status, weekly_work_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const newId = await transaction(async () => {
            const result = await insert.run(name.trim(), cleanCPF, position.trim(), resolvedDeptName, resolvedDeptId, hire_date, work_regime, Number(weekly_hours), work_schedule_type, avatar_url || null, status, JSON.stringify(req.body.weekly_work_days));
            const newId = Number(result.lastInsertRowid);
            // Registra na auditoria com vínculo do gestor e do setor
            await recordAuditLog({
                employeeId: newId,
                userId: user.id,
                userName: user.name,
                action: 'CRIOU_FUNCIONARIO',
                entity: 'employee',
                entityId: newId,
                departmentId: resolvedDeptId,
                newValue: name,
                details: `${user.name} cadastrou colaborador ${name} no cargo ${position} (${resolvedDeptName}).`
            });
            return newId;
        });
        res.status(201).json({
            id: newId,
            message: 'Funcionário cadastrado com sucesso'
        });
    }
    catch (error: any) {
        console.error('Erro ao cadastrar funcionário:', error);
        res.status(500).json({ error: 'Erro ao cadastrar funcionário' });
    }
});
// Atualizar funcionário com validação de escopo
router.put('/:id', requireMutation, async (req: AuthRequest, res) => {
    try {
        const user = req.user!;
        const id = parseInt(req.params.id, 10);
        const existing: any = await db.prepare(`SELECT * FROM employees WHERE id = ?`).get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Funcionário não encontrado' });
        }
        // REGRA DE SEGURANÇA: Bloqueia tentativa de editar funcionário fora do escopo
        if (user.role !== 'ADMIN' && !user.departmentIds.includes(existing.department_id)) {
            return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para alterar colaboradores deste setor.' });
        }
        const { name, cpf, position, department, department_id, hire_date, work_regime, weekly_hours, work_schedule_type, avatar_url, status } = req.body;
        let targetDeptId = existing.department_id;
        let targetDeptName = existing.department;
        if (department_id !== undefined) {
            targetDeptId = Number(department_id);
            const dRow: any = await db.prepare(`SELECT name FROM departments WHERE id = ?`).get(targetDeptId);
            if (dRow)
                targetDeptName = dRow.name;
        }
        else if (department !== undefined) {
            targetDeptName = String(department).trim();
            const dRow: any = await db.prepare(`SELECT id FROM departments WHERE lower(name) = ?`).get(targetDeptName.toLowerCase());
            if (!dRow)
                return res.status(400).json({ error: 'Setor inválido.' });
            targetDeptId = dRow.id;
        }
        if (!await db.prepare('SELECT id FROM departments WHERE id=?').get(targetDeptId))
            return res.status(400).json({ error: 'Setor inválido.' });
        // Não permite mover o funcionário para um setor não autorizado
        if (user.role !== 'ADMIN' && !user.departmentIds.includes(targetDeptId)) {
            return res.status(403).json({ error: 'Acesso negado. Você não pode transferir um colaborador para um setor não autorizado.' });
        }
        let cleanCPF = existing.cpf;
        if (cpf) {
            cleanCPF = String(cpf).replace(/\D/g, '');
            if (!isValidCPF(cleanCPF)) {
                return res.status(400).json({ error: 'CPF inválido.' });
            }
            const duplicate = await db.prepare(`SELECT id FROM employees WHERE cpf = ? AND id != ?`).get(cleanCPF, id);
            if (duplicate) {
                return res.status(400).json({ error: 'Outro funcionário já utiliza este CPF.' });
            }
        }
        await transaction(async () => {
            await db.prepare(`
      UPDATE employees SET
        name = ?,
        cpf = ?,
        position = ?,
        department = ?,
        department_id = ?,
        hire_date = ?,
        work_regime = ?,
        weekly_hours = ?,
        work_schedule_type = ?,
        avatar_url = ?,
        status = ?,
        weekly_work_days = ?,
        updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(name !== undefined ? name.trim() : existing.name, cleanCPF, position !== undefined ? position.trim() : existing.position, targetDeptName, targetDeptId, hire_date || existing.hire_date, work_regime || existing.work_regime, weekly_hours !== undefined ? Number(weekly_hours) : existing.weekly_hours, work_schedule_type || existing.work_schedule_type, avatar_url !== undefined ? avatar_url : existing.avatar_url, status || existing.status, JSON.stringify(req.body.weekly_work_days), id);
            await recordAuditLog({
                employeeId: id,
                userId: user.id,
                userName: user.name,
                action: 'ATUALIZOU_FUNCIONARIO',
                entity: 'employee',
                entityId: id,
                departmentId: targetDeptId,
                oldValue: `${existing.name} (${existing.position})`,
                newValue: `${name || existing.name} (${position || existing.position})`,
                details: `${user.name} atualizou os dados cadastrais do colaborador.`
            });
        });
        res.json({ message: 'Funcionário atualizado com sucesso' });
    }
    catch (error: any) {
        console.error('Erro ao atualizar funcionário:', error);
        res.status(500).json({ error: 'Erro ao atualizar funcionário' });
    }
});
// Excluir funcionário com validação de escopo
router.delete('/:id', requireMutation, async (req: AuthRequest, res) => {
    try {
        const user = req.user!;
        const id = parseInt(req.params.id, 10);
        const existing: any = await db.prepare(`SELECT * FROM employees WHERE id = ?`).get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Funcionário não encontrado' });
        }
        // REGRA DE SEGURANÇA: Bloqueia exclusão de funcionário fora do escopo
        if (user.role !== 'ADMIN' && !user.departmentIds.includes(existing.department_id)) {
            return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para excluir colaboradores deste setor.' });
        }
        await transaction(async () => {
            await recordAuditLog({
                employeeId: id,
                userId: user.id,
                userName: user.name,
                action: 'EXCLUIU_FUNCIONARIO',
                entity: 'employee',
                entityId: id,
                departmentId: existing.department_id,
                oldValue: existing.name,
                details: `${user.name} excluiu o colaborador ${existing.name} (${existing.position}).`
            });
            await db.prepare(`DELETE FROM employees WHERE id = ?`).run(id);
        });
        res.json({ message: 'Funcionário excluído com sucesso' });
    }
    catch (error: any) {
        console.error('Erro ao excluir funcionário:', error);
        res.status(500).json({ error: 'Erro ao excluir funcionário' });
    }
});
export default router;
