import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import db from './db/connection';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import departmentsRouter from './routes/departments';
import employeesRouter from './routes/employees';
import daysOffRouter from './routes/daysOff';
import schedulesRouter from './routes/schedules';
import dashboardRouter from './routes/dashboard';
import auditRouter from './routes/audit';
import reportsRouter from './routes/reports';
import notificationsRouter from './routes/notifications';
import settingsRouter from './routes/settings';
export const app = express();
app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(helmet({contentSecurityPolicy:process.env.NODE_ENV==='production'?undefined:false}));
// Middlewares globais
if (process.env.NODE_ENV !== 'production') app.use(cors());
app.use(express.json({limit:'1mb'}));
// 1. Rota pública de Health check
app.get('/api/health', async (_req, res) => {
  try { await db.prepare('SELECT 1 AS ok').get(); }
  catch { return res.status(503).json({status:'unavailable'}); }
    res.json({
        status: 'online',
        app: 'Folga Manager API',
        timestamp: new Date().toISOString()
    });
});
// 2. Rotas públicas de Autenticação (/api/auth/login, etc.)
app.use('/api/auth', authRouter);
// 3. Rotas protegidas (gerenciamento e operação com isolamento de perfil e escopo)
app.use('/api/users', usersRouter);
app.use('/api/departments', departmentsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/days-off', daysOffRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/audit', auditRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve('dist')));
    app.get('*', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
}
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    res.status(error.status === 400 ? 400 : 500).json({ error: error.status === 400 ? 'Requisição inválida.' : 'Erro interno. Tente novamente.' });
});
export default app;
