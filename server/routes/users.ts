import { Router } from 'express';
import db, { transaction } from '../db/connection';
import { requireAuth, requireRole, AuthRequest, recordAuditLog } from '../middlewares/auth';
import { hashPassword } from '../utils/auth';
const router = Router();
// Todas as rotas de usuários são exclusivas para ADMIN
router.use(requireAuth);
router.use(requireRole('ADMIN'));
// Listar todos os usuários
router.get('/', async (_req, res) => {
    try {
        const users = await db.prepare(`
      SELECT id, name, email, role, active, created_at, updated_at
      FROM users
      ORDER BY name ASC
    `).all() as any[];
        const enriched = await Promise.all(users.map(async (u) => {
            const depts = await db.prepare(`
        SELECT d.id, d.name
        FROM user_departments ud
        JOIN departments d ON d.id = ud.department_id
        WHERE ud.user_id = ?
        ORDER BY d.name ASC
      `).all(u.id) as any[];
            return {
                ...u,
                departments: depts,
                departmentIds: depts.map(d => d.id)
            };
        }));
        res.json(enriched);
    }
    catch (error: any) {
        console.error('Erro ao listar usuários:', error);
        res.status(500).json({ error: 'Erro ao carregar usuários' });
    }
});
// Criar novo usuário
router.post('/', async (req: AuthRequest, res) => {
    try {
        const { name, email, password, role = 'MANAGER', departmentIds = [], active = 1 } = req.body;
        if (!name || !email || !password || !role) {
            return res.status(400).json({ error: 'Nome, e-mail, senha e perfil são obrigatórios.' });
        }
        if (!['ADMIN', 'MANAGER', 'VIEWER'].includes(role)) {
            return res.status(400).json({ error: 'Perfil inválido. Opções válidas: ADMIN, MANAGER ou VIEWER.' });
        }
        const cleanEmail = String(email).trim().toLowerCase();
        const existing = await db.prepare(`SELECT id FROM users WHERE lower(email) = ?`).get(cleanEmail);
        if (existing) {
            return res.status(400).json({ error: 'Já existe um usuário cadastrado com este e-mail.' });
        }
        if (String(password).length < 6) {
            return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });
        }
        const passwordHash = hashPassword(String(password));
        const insert = db.prepare(`
      INSERT INTO users (name, email, password_hash, role, active)
      VALUES (?, ?, ?, ?, ?)
    `);
        const newUserId = await transaction(async () => {
            const result = await insert.run(String(name).trim(), cleanEmail, passwordHash, role, active ? 1 : 0);
            const newUserId = Number(result.lastInsertRowid);
            // Vincula setores para MANAGER ou VIEWER
            if (Array.isArray(departmentIds) && departmentIds.length > 0) {
                const insertUserDept = db.prepare(`
        INSERT INTO user_departments (user_id, department_id)
        VALUES (?, ?) ON CONFLICT DO NOTHING
      `);
                for (const deptId of departmentIds) {
                    await insertUserDept.run(newUserId, Number(deptId));
                }
            }
            // Auditoria administrativa
            await recordAuditLog({
                userId: req.user?.id,
                userName: req.user?.name,
                action: 'CRIOU_USUARIO',
                entity: 'user',
                entityId: newUserId,
                details: `Administrador criou usuário ${name} (${role}) com e-mail ${cleanEmail}.`
            });
            return newUserId;
        });
        res.status(201).json({
            id: newUserId,
            message: 'Usuário criado com sucesso'
        });
    }
    catch (error: any) {
        console.error('Erro ao criar usuário:', error);
        res.status(500).json({ error: 'Erro ao cadastrar novo usuário' });
    }
});
// Atualizar usuário existente
router.put('/:id', async (req: AuthRequest, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const existing: any = await db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        const { name, email, password, role, departmentIds, active } = req.body;
        let cleanEmail = existing.email;
        if (email && email.toLowerCase() !== existing.email.toLowerCase()) {
            cleanEmail = String(email).trim().toLowerCase();
            const duplicate = await db.prepare(`SELECT id FROM users WHERE lower(email) = ? AND id != ?`).get(cleanEmail, id);
            if (duplicate) {
                return res.status(400).json({ error: 'Outro usuário já está utilizando este e-mail.' });
            }
        }
        let passwordHash = existing.password_hash;
        if (password && String(password).trim().length > 0) {
            if (String(password).length < 6) {
                return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres.' });
            }
            passwordHash = hashPassword(String(password));
        }
        const newRole = role || existing.role;
        const newActive = active !== undefined ? (active ? 1 : 0) : existing.active;
        const newName = name !== undefined ? String(name).trim() : existing.name;
        if (!['ADMIN', 'MANAGER', 'VIEWER'].includes(newRole) || !newName)
            return res.status(400).json({ error: 'Nome ou perfil inválido.' });
        if (req.user?.id === id && (newRole !== 'ADMIN' || !newActive))
            return res.status(400).json({ error: 'Não é permitido remover seu próprio acesso administrativo.' });
        await transaction(async () => {
            await db.prepare(`
      UPDATE users SET
        name = ?,
        email = ?,
        password_hash = ?,
        role = ?,
        active = ?,
        updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(newName, cleanEmail, passwordHash, newRole, newActive, id);
            // Atualiza setores vinculados se enviados
            if (Array.isArray(departmentIds)) {
                await db.prepare(`DELETE FROM user_departments WHERE user_id = ?`).run(id);
                const insertUserDept = db.prepare(`
        INSERT INTO user_departments (user_id, department_id)
        VALUES (?, ?) ON CONFLICT DO NOTHING
      `);
                for (const deptId of departmentIds) {
                    await insertUserDept.run(id, Number(deptId));
                }
            }
            // Auditoria administrativa
            await recordAuditLog({
                userId: req.user?.id,
                userName: req.user?.name,
                action: 'ATUALIZOU_USUARIO',
                entity: 'user',
                entityId: id,
                oldValue: `${existing.name} (${existing.role})`,
                newValue: `${newName} (${newRole})`,
                details: `Administrador atualizou os dados do usuário ${existing.name}.`
            });
            if (password || !newActive)
                await db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(id);
        });
        res.json({ message: 'Usuário atualizado com sucesso' });
    }
    catch (error: any) {
        console.error('Erro ao atualizar usuário:', error);
        res.status(500).json({ error: 'Erro ao atualizar dados do usuário' });
    }
});
// Ativar/Desativar usuário
router.put('/:id/status', async (req: AuthRequest, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const existing: any = await db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        if (req.user?.id === id) {
            return res.status(400).json({ error: 'Não é permitido desativar sua própria conta de administrador.' });
        }
        const { active } = req.body;
        const newActive = active ? 1 : 0;
        await transaction(async () => {
            await db.prepare(`
      UPDATE users SET active = ?, updated_at = datetime('now', 'localtime') WHERE id = ?
    `).run(newActive, id);
            // Se desativou, encerra sessões ativas do usuário
            if (newActive === 0) {
                await db.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).run(id);
            }
            await recordAuditLog({
                userId: req.user?.id,
                userName: req.user?.name,
                action: newActive ? 'ATIVOU_USUARIO' : 'DESATIVOU_USUARIO',
                entity: 'user',
                entityId: id,
                details: `Administrador alterou status do usuário ${existing.name} para ${newActive ? 'Ativo' : 'Inativo'}.`
            });
        });
        res.json({ message: `Usuário ${newActive ? 'ativado' : 'desativado'} com sucesso` });
    }
    catch (error: any) {
        console.error('Erro ao alternar status do usuário:', error);
        res.status(500).json({ error: 'Erro ao alterar status do usuário' });
    }
});
export default router;
