import { Router } from 'express';
import db, { transaction } from '../db/connection';
import { requireAuth, requireRole, AuthRequest, recordAuditLog } from '../middlewares/auth';
const router = Router();
router.use(requireAuth);
// Buscar todas as configurações
router.get('/', async (_req, res) => {
    try {
        const rows = await db.prepare(`SELECT key, value FROM settings`).all() as any[];
        const settingsObj: Record<string, string> = {};
        rows.forEach(r => {
            settingsObj[r.key] = r.value;
        });
        res.json(settingsObj);
    }
    catch (error: any) {
        console.error('Erro ao buscar configurações:', error);
        res.status(500).json({ error: 'Erro ao buscar configurações' });
    }
});
// Atualizar ou inserir configurações (Apenas ADMIN)
router.put('/', requireRole('ADMIN'), async (req: AuthRequest, res) => {
    try {
        const updates = req.body as Record<string, string>;
        if (updates.clt_alert_days !== undefined && (!Number.isInteger(Number(updates.clt_alert_days)) || Number(updates.clt_alert_days) < 1 || Number(updates.clt_alert_days) > 6))
            return res.status(400).json({ error: 'O alerta deve ficar entre 1 e 6 dias.' });
        await transaction(async () => {
            const upsert = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
            for (const [k, v] of Object.entries(updates)) {
                await upsert.run(k, String(v));
            }
            await recordAuditLog({
                userId: req.user?.id,
                userName: req.user?.name,
                action: 'ATUALIZOU_CONFIGURACOES',
                entity: 'settings',
                details: `Administrador atualizou parâmetros do sistema: ${Object.keys(updates).join(', ')}.`
            });
        });
        res.json({ message: 'Configurações atualizadas com sucesso' });
    }
    catch (error: any) {
        console.error('Erro ao salvar configurações:', error);
        res.status(500).json({ error: 'Erro ao salvar configurações' });
    }
});
export default router;
