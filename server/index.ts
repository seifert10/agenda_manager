import app from './app';
import { runMigrations } from './db/migrate';
import db, {dialect} from './db/connection';
import {bootstrapProduction} from './db/bootstrap';
const PORT = Number(process.env.PORT) || 3001;
// Garante migrações ao iniciar
await runMigrations();
await bootstrapProduction();
export const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Folga Manager Server rodando na porta ${PORT}`);
    console.log(`📡 Endpoints disponíveis em http://localhost:${PORT}/api`);
    console.log(`Banco selecionado: ${dialect}`);
});
let stopping=false;
async function shutdown() {
  if (stopping) return;
  stopping=true;
  const deadline=setTimeout(()=>process.exit(1),10000);
  deadline.unref();
  server.close(async () => { await db.close(); clearTimeout(deadline); process.exit(0); });
}
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);
export default app;
