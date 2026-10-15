import { createCompanyApplication } from './company-app';
import db, {dialect} from './db/connection';
const PORT = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error('Porta inválida.');
// Runtime never receives owner credentials, migrates or provisions accounts.
const app = await createCompanyApplication();
export const server = app.listen(PORT, '0.0.0.0', () => {
    const boundPort=(server.address() as {port:number}).port;
    console.log(`🚀 Folga Manager Server rodando na porta ${boundPort}`);
    console.log(`📡 Endpoints disponíveis em http://localhost:${boundPort}/api`);
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
