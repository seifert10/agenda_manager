import assert from 'node:assert/strict';
import db,{dialect,companyTransaction} from '../server/db/connection';
import { runMigrations } from '../server/db/migrate';
import { runSeed } from '../server/db/seed';
import { upgradeCompanySchema } from '../server/db/upgrade-company';
import { companyAuthentication } from '../server/services/companyAuth';
import { companyAuthStore } from '../server/db/company-auth-store';
import { companyAuthSchema,companyAuthGrants } from '../server/db/company-auth-schema';
import { companyPolicies } from '../server/db/company-schema';
import { hashPassword } from '../server/utils/auth';
import { withCompanyContext,requireCompanyContext,sessionTokenHash } from '../server/services/companyContext';
import express from 'express';
import http from 'node:http';
import { companyAuthRouter } from '../server/routes/company-auth';

await runMigrations();
await runSeed();
const before = await db.prepare('SELECT COUNT(*) AS count FROM employees').get();
await assert.rejects(upgradeCompanySchema({code:'demo',name:'Demo'},{backupVerified:false}));
await upgradeCompanySchema({code:'demo',name:'Demo'},{backupVerified:true});
await upgradeCompanySchema({code:'demo',name:'Demo'},{backupVerified:true});
assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM employees').get()).count,before.count);
assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM user_sessions').get()).count,0);
await db.prepare('INSERT INTO companies(id,code,name) VALUES(2,?,?)').run('second','Second');
await db.prepare("INSERT INTO users(id,company_id,name,email,password_hash,role) VALUES(100,2,'Other','admin@folgamanager.local',?,'ADMIN')").run(hashPassword('OtherPassword123!'));
await db.prepare("INSERT INTO departments(id,company_id,name) VALUES(100,2,'cozinha')").run();
if(dialect === 'postgres') {
  await db.exec(companyPolicies());
  await db.exec(companyAuthSchema);
  await db.exec('CREATE ROLE company_auth_resolver; CREATE ROLE company_runtime;');
  await db.exec(companyAuthGrants('company_runtime','company_auth_resolver'));
  await db.exec('GRANT SELECT ON companies,users,departments,user_departments TO company_runtime; GRANT SELECT,INSERT,DELETE ON user_sessions TO company_runtime; SET ROLE company_runtime;');
}
const auth = companyAuthentication(companyAuthStore);
await assert.rejects(auth.login('unknown','admin@folgamanager.local','AdminPassword123!'));
await assert.rejects(auth.login('second','admin@folgamanager.local','AdminPassword123!'));
const a = await auth.login('demo','ADMIN@folgamanager.local','AdminPassword123!');
const b = await auth.login('second','admin@folgamanager.local','OtherPassword123!');
assert.equal(a.user.companyId,1);assert.equal(b.user.companyId,2);
assert.deepEqual(b.user.departmentIds,[100]);
assert.ok(!a.user.departmentIds.includes(100));
await auth.authenticate(a.token, async user=>{assert.equal(user.companyId,1);const stored=await db.prepare('SELECT token_hash FROM user_sessions WHERE company_id=?').all(1);assert.ok(stored.some(s=>s.token_hash===sessionTokenHash(a.token)));assert.ok(!JSON.stringify(stored).includes(a.token));});
await auth.logout(a.token);
await assert.rejects(auth.authenticate(a.token,async()=>{}));
await auth.authenticate(b.token,async()=>{});
// Revocation after the unscoped resolver, but before the company unit of work, must still fail.
const racing = await auth.login('second','admin@folgamanager.local','OtherPassword123!');
const revokingAuth = companyAuthentication({...companyAuthStore,async sessionCandidate(hash) {
  const candidate = await companyAuthStore.sessionCandidate(hash);
  if (candidate) await withCompanyContext({companyId:candidate.company_id,userId:candidate.id},()=>companyTransaction(()=>companyAuthStore.deleteSession(hash)));
  return candidate;
}});
await assert.rejects(revokingAuth.authenticate(racing.token,async()=>{}));
const passwordRacingAuth = companyAuthentication({...companyAuthStore,async loginCandidate(code,email) {
  const candidate = await companyAuthStore.loginCandidate(code,email);
  if (candidate) await withCompanyContext({companyId:candidate.company_id,userId:candidate.id},()=>companyTransaction(async()=>{
    await db.prepare('UPDATE users SET password_hash=? WHERE company_id=? AND id=?').run(hashPassword('ChangedPassword123!'),candidate.company_id,candidate.id);
  }));
  return candidate;
}});
if (dialect === 'postgres') await db.exec('RESET ROLE; GRANT UPDATE(password_hash) ON users TO company_runtime; SET ROLE company_runtime;');
await assert.rejects(passwordRacingAuth.login('second','admin@folgamanager.local','OtherPassword123!'));
await withCompanyContext({companyId:2,userId:100},()=>companyTransaction(async()=>{
  await db.prepare('UPDATE users SET password_hash=? WHERE company_id=2 AND id=100').run(hashPassword('OtherPassword123!'));
}));
const app = express(); app.use(express.json()); app.use('/auth',companyAuthRouter(companyAuthStore));
const server = http.createServer(app);
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${(server.address() as {port:number}).port}/auth`;
try {
  const request = (path:string,body?:unknown,token?:string)=>fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});
  assert.equal((await request('/login',{email:'admin@folgamanager.local',password:'AdminPassword123!'})).status,401);
  const result = await request('/login',{companyCode:'second',email:'admin@folgamanager.local',password:'OtherPassword123!'});
  assert.equal(result.status,200);
  const login = await result.json() as any;
  assert.equal(login.user.companyId,2);
  assert.ok(!JSON.stringify(login).includes('password_hash'));
  const me = await request('/me',undefined,login.token);
  assert.equal((await me.json() as any).user.company.code,'second');
  assert.equal((await request('/logout',{},login.token)).status,200);
  assert.equal((await request('/me',undefined,login.token)).status,401);
} finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
await assert.rejects(withCompanyContext({companyId:2,userId:100},()=>companyTransaction(async()=>{await companyAuthStore.createSession('rollback-test',100,new Date(Date.now()+60000).toISOString());throw new Error('rollback');})));
await withCompanyContext({companyId:2,userId:100},()=>companyTransaction(async()=>{assert.equal(await db.prepare('SELECT token_hash FROM user_sessions WHERE company_id=2 AND token_hash=?').get('rollback-test'),undefined);}));
assert.throws(requireCompanyContext);
if(dialect === 'postgres') await db.exec('RESET ROLE');
await db.prepare('UPDATE companies SET active=0 WHERE id=2').run();
await assert.rejects(auth.authenticate(b.token,async()=>{}));
await assert.rejects(auth.login('second','admin@folgamanager.local','OtherPassword123!'));
await db.close();
console.log(`${dialect}: migração, API de login por empresa, sessão com hash, logout, suspensão, revogação entre resolução/transação e rollback aprovados${dialect==='postgres'?', incluindo RLS com papel restrito':''}.`);
