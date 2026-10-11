import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import db from '../server/db/connection';
import {runMigrations} from '../server/db/migrate';
import {bootstrapProduction} from '../server/db/bootstrap';
import {verifyPassword} from '../server/utils/auth';
import {postgresSql} from '../server/db/sql';

assert.equal(postgresSql("SELECT '?' AS literal, ? AS value, 'it''s ?' AS quoted"),"SELECT '?' AS literal, $1 AS value, 'it''s ?' AS quoted");
await runMigrations();
process.env.NODE_ENV='production';
delete process.env.INITIAL_ADMIN_EMAIL;
delete process.env.INITIAL_ADMIN_PASSWORD;
await assert.rejects(()=>bootstrapProduction(), /INITIAL_ADMIN_EMAIL/);
assert.equal((await db.prepare('SELECT count(*) AS total FROM users').get()).total,0);
process.env.INITIAL_ADMIN_EMAIL='deployment@example.test';
process.env.INITIAL_ADMIN_PASSWORD='Deployment-Test-Password-123!';
await bootstrapProduction();
const admin=await db.prepare('SELECT * FROM users').get();
assert.equal(admin.role,'ADMIN');
assert(verifyPassword(process.env.INITIAL_ADMIN_PASSWORD,admin.password_hash));
assert.equal((await db.prepare('SELECT count(*) AS total FROM employees').get()).total,0);
await db.prepare("UPDATE settings SET value='Empresa preservada' WHERE key='company_name'").run();
delete process.env.INITIAL_ADMIN_EMAIL;
delete process.env.INITIAL_ADMIN_PASSWORD;
await bootstrapProduction();
assert.equal((await db.prepare('SELECT count(*) AS total FROM users').get()).total,1);
assert.equal((await db.prepare("SELECT value FROM settings WHERE key='company_name'").get()).value,'Empresa preservada');

const {default:app}=await import('../server/app');
const server=app.listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
try {
  const health=await fetch(base+'/api/health');
  assert.equal(health.status,200);
  assert.equal(health.headers.get('x-powered-by'),null);
  assert(health.headers.get('x-content-type-options'));
  const html=await fetch(base+'/');
  assert.equal(html.status,200);assert.match(await html.text(),/\/assets\//);
  assert.equal((await fetch(base+'/api/missing')).status,404);
  assert.equal((await fetch(base+'/api/employees')).status,401);
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'deployment@example.test',password:'Deployment-Test-Password-123!'})});
  assert.equal(login.status,200);
  const {token}=await login.json() as {token:string};
  assert.equal((await fetch(base+'/api/dashboard',{headers:{Authorization:`Bearer ${token}`}})).status,200);
  let status=0;
  for(let i=0;i<20;i++) status=(await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'unknown@example.test',password:'wrong'})})).status;
  assert.equal(status,429);
  for(const name of readdirSync('dist/assets').filter(name=>name.endsWith('.js'))) {
    assert(!readFileSync('dist/assets/'+name,'utf8').includes('AdminPassword123!'));
  }
  const unavailable=spawnSync(process.execPath,['scripts/start.mjs'],{encoding:'utf8',timeout:15000,env:{...process.env,DATABASE_URL:'',TEST_DATABASE:'',DB_PATH:process.env.DB_PATH+'.not-created'}});
  assert.notEqual(unavailable.status,0);
  assert.match(unavailable.stderr,/DATABASE_URL/);
  assert(!existsSync(process.env.DB_PATH+'.not-created'));
  await db.close();
  assert.equal((await fetch(base+'/api/health')).status,503);
  console.log('Produção aprovada: administrador inicial, redeploy preserva dados, frontend estático, autenticação, proteção de login, health check e recusa de SQLite em produção.');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
}
