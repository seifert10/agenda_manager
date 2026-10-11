import { Router } from 'express';
import {asyncHandler} from '../utils/asyncHandler';
import db, { transaction } from '../db/connection';
import { requireAuth, AuthRequest } from '../middlewares/auth';
import { notificationsFor } from '../services/notifications';
const router = Router();
router.use(requireAuth);
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
    try {
        const rows = await notificationsFor(req.user!);
        res.json({ notifications: rows.slice(0, 20), unreadCount: rows.filter(n => !n.is_read).length });
    }
    catch {
        res.status(500).json({ error: 'Erro ao buscar notificações' });
    }
}));
router.put('/:id/read', asyncHandler(async (req: AuthRequest, res) => {
    const user = req.user!;
    const notification: any = await db.prepare('SELECT * FROM notifications WHERE id=?').get(Number(req.params.id));
    if (!notification)
        return res.status(404).json({ error: 'Notificação não encontrada.' });
    if (user.role !== 'ADMIN' && !(user.departmentIds.includes(notification.department_id) || (notification.department_id === null && user.departmentIds.length > 0)))
        return res.status(403).json({ error: 'Acesso negado a esta notificação.' });
    await db.prepare('INSERT INTO notification_reads(notification_id,user_id) VALUES (?,?) ON CONFLICT DO NOTHING').run(notification.id, user.id);
    res.json({ message: 'Notificação marcada como lida para você.' });
}));
router.put('/read-all', asyncHandler(async (req: AuthRequest, res) => {
    await transaction(async () => { for (const n of await notificationsFor(req.user!))
        await db.prepare('INSERT INTO notification_reads(notification_id,user_id) VALUES (?,?) ON CONFLICT DO NOTHING').run(n.id, req.user!.id); });
    res.json({ message: 'Notificações marcadas como lidas para você.' });
}));
export default router;
