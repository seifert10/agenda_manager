import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import db,{dialect} from '../server/db/connection';
import { runMigrations } from '../server/db/migrate';
import { runSeed } from '../server/db/seed';
import { upgradeCompanySchema } from '../server/db/upgrade-company';
import { companyPolicies } from '../server/db/company-schema';
import { companyAuthSchema,companyAuthGrants } from '../server/db/company-auth-schema';
import { companyRuntimeGrants } from '../server/db/company-runtime-grants';
import { assertCompanyRuntimeRole } from '../server/db/company-runtime-check';
import { companyAuthentication } from '../server/services/companyAuth';
import { companyAuthStore } from '../server/db/company-auth-store';
import { companyAdministrationRouter } from '../server/routes/company-administration';
import { companyEmployeesRouter } from '../server/routes/company-employees';
import { companyEmployee } from '../server/services/companyAuthorization';
import { listCompanyUsers } from '../server/services/companyAdministration';
import { withCompanyContext } from '../server/services/companyContext';
import { hashPassword } from '../server/utils/auth';
import { generateFakeValidCPF } from '../server/utils/cpf';

await runMigrations(); await runSeed();
await upgradeCompanySchema({code:'demo',name:'Demo'},{backupVerified:true});
await db.prepare("INSERT INTO companies(code,name) VALUES('second','Second')").run();
for (const [name,email,role] of [['Admin B','admin@folgamanager.local','ADMIN'],['Manager B','manager@example.test','MANAGER'],['Viewer B','viewer@example.test','VIEWER']]) {
  await db.prepare('INSERT INTO users(company_id,name,email,password_hash,role) VALUES(2,?,?,?,?)').run(name,email,hashPassword('CompanyPassword123!'),role);
}
const otherAdmin = await db.prepare("SELECT id FROM users WHERE company_id=2 AND role='ADMIN'").get();
const otherDeptResult = await db.prepare("INSERT INTO departments(company_id,name) VALUES(2,'cozinha')").run();
const otherDept = Number(otherDeptResult.lastInsertRowid);
const emp = await db.prepare('SELECT * FROM employees WHERE company_id=1 LIMIT 1').get();
const otherEmpResult = await db.prepare('INSERT INTO employees(company_id,name,cpf,position,department,department_id,hire_date) VALUES(2,?,?,?,?,?,?)').run('Exclusive B',emp.cpf,'Cook','cozinha',otherDept,'2020-01-01');
const otherEmp = Number(otherEmpResult.lastInsertRowid);
if (dialect === 'postgres') {
  await db.exec(companyPolicies()); await db.exec(companyAuthSchema);
  await db.exec('CREATE ROLE company_auth_resolver; CREATE ROLE company_runtime;');
  await db.exec(companyAuthGrants('company_runtime','company_auth_resolver'));
  await assert.rejects(assertCompanyRuntimeRole('company_auth_resolver'));
  await db.exec(companyRuntimeGrants('company_runtime')); await db.exec('SET ROLE company_runtime');
  await assertCompanyRuntimeRole('company_auth_resolver');
  // SET ROLE is checked against session_user (the embedded test owner), not current_user.
  // Resolver membership is checked by the runtime guard; a real runtime login is tested separately at cutover.
  assert.equal((await db.prepare('SELECT * FROM companies').all()).length,0);
  await assert.rejects(db.prepare('SELECT * FROM platform_operations').all());
  await assert.rejects(db.exec('CREATE TABLE runtime_forbidden(id integer)'));
  await assert.rejects(db.exec('TRUNCATE users'));
}
const auth = companyAuthentication(companyAuthStore);
const a = await auth.login('demo','admin@folgamanager.local','AdminPassword123!');
const b = await auth.login('second','admin@folgamanager.local','CompanyPassword123!');
const manager = await auth.login('second','manager@example.test','CompanyPassword123!');
const viewer = await auth.login('second','viewer@example.test','CompanyPassword123!');
const kitchenManager = await auth.login('demo','cozinha@folgamanager.local','CozinhaPassword123!');
await assert.rejects(listCompanyUsers(a.user));
await assert.rejects(withCompanyContext({companyId:1,userId:a.user.id},()=>listCompanyUsers(a.user)));
await auth.authenticate(a.token, async user=>{
  await assert.rejects(companyEmployee(user,otherEmp),{status:404});
});
const app = express(); app.use(express.json()); app.use('/api',companyAdministrationRouter()); app.use('/api/employees',companyEmployeesRouter());
app.use((_error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(500).json({error:'Erro interno.'}));
const server = http.createServer(app);
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
try {
  const request = async (token:string,path:string,method='GET',body?:unknown)=>{
    const response = await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
    return {status:response.status,body:await response.json() as any};
  };
  assert.equal((await request('invalid','/users')).status,401);
  const own = await request(a.token,'/users');
  assert.equal(own.status,200); assert.ok(!JSON.stringify(own.body).includes('Admin B')); assert.ok(!JSON.stringify(own.body).includes('password_hash'));
  const before = await auth.authenticate(a.token,async()=>db.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE company_id=1').get());
  const external = await request(a.token,`/users/${otherAdmin.id}`,'PUT',{name:'Intrusion'});
  const missing = await request(a.token,'/users/999999','PUT',{name:'Intrusion'});
  assert.deepEqual(external,missing); assert.equal(external.status,404);
  assert.equal((await request(a.token,`/departments/${otherDept}`,'DELETE')).status,404);
  assert.equal((await request(a.token,'/users','POST',{name:'Bad',email:'bad@example.test',password:'Secret123!',departmentIds:[a.user.departmentIds[0],otherDept]})).status,404);
  const after = await auth.authenticate(a.token,async()=>db.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE company_id=1').get());
  assert.equal(before.n,after.n);
  assert.equal((await request(a.token,'/users?company_id=2')).status,400);
  assert.equal((await request(a.token,'/settings','PUT',{companyId:2,clt_alert_days:'3'})).status,400);
  assert.equal((await request(manager.token,'/users')).status,403);
  assert.deepEqual((await request(manager.token,'/departments')).body,[]);
  assert.equal((await request(viewer.token,'/departments','POST',{name:'Denied'})).status,403);
  assert.equal((await request(viewer.token,'/settings','PUT',{clt_alert_days:'3'})).status,403);
  assert.equal((await request(b.token,'/settings','PUT',{company_name:'Company B renamed',clt_alert_days:'3'})).status,200);
  assert.equal((await request(a.token,'/settings')).body.company_name,'Demo');
  assert.equal((await request(b.token,'/settings')).body.clt_alert_days,'3');
  assert.equal((await request(a.token,'/settings')).body.clt_alert_days,'6');
  assert.equal((await request(b.token,'/settings','PUT',{unknown_parameter:'x'})).status,400);
  assert.equal((await request(a.token,'/users','POST',{name:'Own manager',email:'manager@example.test',password:'Secret123!',departmentIds:[a.user.departmentIds[0]]})).status,201);
  assert.equal((await request(a.token,'/users','POST',{name:'Duplicate',email:'MANAGER@example.test',password:'Secret123!'})).status,400);
  assert.equal((await request(a.token,'/departments','POST',{name:'Cozinha'})).status,400);
  assert.equal((await request(a.token,`/users/${a.user.id}/status`,'PUT',{active:0})).status,400);
  assert.equal((await request(a.token,`/users/${a.user.id}/status`,'PUT',{})).status,400);
  const ownEmployees = await request(a.token,'/employees');
  assert.equal(ownEmployees.status,200); assert.ok(!JSON.stringify(ownEmployees.body).includes('Exclusive B'));
  const ownKitchen = ownEmployees.body.find((row:any)=>row.department_id===1);
  const ownOtherSector = ownEmployees.body.find((row:any)=>row.department_id===2);
  assert.equal((await request(kitchenManager.token,`/employees/${ownKitchen.id}`)).status,200);
  assert.equal((await request(kitchenManager.token,`/employees/${ownOtherSector.id}`)).status,403);
  assert.equal((await request(kitchenManager.token,`/employees/${ownKitchen.id}`,'PUT',{department_id:2})).status,403);
  assert.equal((await request(kitchenManager.token,`/employees/${ownKitchen.id}`)).body.department_id,1);
  for (const method of ['GET','PUT','DELETE']) {
    const outside = await request(a.token,`/employees/${otherEmp}`,method,method==='PUT'?{name:'Intrusion'}:undefined);
    const unknown = await request(a.token,'/employees/999999',method,method==='PUT'?{name:'Intrusion'}:undefined);
    assert.deepEqual(outside,unknown); assert.equal(outside.status,404);
  }
  assert.equal((await request(manager.token,`/employees/${otherEmp}`)).status,403);
  assert.equal((await request(viewer.token,`/employees/${otherEmp}`,'PUT',{name:'Denied'})).status,403);
  const data = {name:'Employee temporary',cpf:generateFakeValidCPF(99),position:'Cook',department_id:otherDept,hire_date:'2020-01-01',work_schedule_type:'3x4',weekly_work_days:[1,3,5]};
  assert.equal((await request(a.token,'/employees','POST',data)).status,404);
  assert.equal((await request(b.token,'/employees','POST',{...data,weekly_work_days:[]})).status,400);
  const createdEmployee = await request(b.token,'/employees','POST',data);
  assert.equal(createdEmployee.status,201);
  const employeeId = createdEmployee.body.id;
  assert.equal((await request(a.token,'/employees','POST',{...data,department_id:a.user.departmentIds[0]})).status,201);
  assert.equal((await request(b.token,'/employees','POST',data)).status,400);
  assert.equal((await request(b.token,`/employees/${employeeId}`,'PUT',{department_id:a.user.departmentIds[0]})).status,404);
  assert.equal((await request(b.token,`/employees/${employeeId}`,'PUT',{hire_date:'2026-02-30'})).status,400);
  assert.equal((await request(b.token,`/employees/${employeeId}`,'PUT',{name:'Employee revised'})).status,200);
  assert.equal((await request(b.token,`/employees/${employeeId}`)).body.name,'Employee revised');
  assert.equal((await request(b.token,`/users/${manager.user.id}`,'PUT',{departmentIds:[otherDept]})).status,200);
  assert.equal((await request(manager.token,'/employees')).status,401);
  const scopedManager = await auth.login('second','manager@example.test','CompanyPassword123!');
  assert.equal((await request(scopedManager.token,'/employees')).body.length,2);
  await auth.authenticate(b.token,async()=>{
    await db.prepare("INSERT INTO days_off(company_id,employee_id,date) VALUES(2,?,'2030-01-02')").run(employeeId);
    await db.prepare("INSERT INTO work_schedules(company_id,employee_id,date) VALUES(2,?,'2030-01-03')").run(employeeId);
  });
  // Rejected audit INSERT must roll back both a business write and its response.
  if (dialect === 'postgres') {
    await db.exec('RESET ROLE; REVOKE INSERT ON audit_logs FROM company_runtime; SET ROLE company_runtime;');
  } else {
    await db.exec("CREATE TRIGGER reject_company_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'test audit failure'); END;");
  }
  assert.equal((await request(a.token,'/departments','POST',{name:'rolled back'})).status,500);
  assert.equal((await request(b.token,`/employees/${employeeId}`,'DELETE')).status,500);
  assert.equal((await request(b.token,`/employees/${employeeId}`)).status,200);
  await auth.authenticate(a.token,async()=>assert.equal(await db.prepare("SELECT id FROM departments WHERE company_id=1 AND name='rolled back'").get(),undefined));
  if (dialect === 'postgres') await db.exec('RESET ROLE; GRANT INSERT ON audit_logs TO company_runtime; SET ROLE company_runtime;');
  else await db.exec('DROP TRIGGER reject_company_audit');
  assert.equal((await request(scopedManager.token,`/employees/${employeeId}`,'DELETE')).status,200);
  await auth.authenticate(b.token,async()=>{
    assert.equal(await db.prepare('SELECT id FROM employees WHERE company_id=2 AND id=?').get(employeeId),undefined);
    assert.equal((await db.prepare('SELECT * FROM days_off WHERE company_id=2 AND employee_id=?').all(employeeId)).length,0);
    assert.equal((await db.prepare('SELECT * FROM work_schedules WHERE company_id=2 AND employee_id=?').all(employeeId)).length,0);
    const history = await db.prepare("SELECT * FROM audit_logs WHERE company_id=2 AND entity='employee' AND entity_id=?").all(employeeId);
    assert.ok(history.length>=3);assert.ok(history.every(row=>row.company_id===2 && row.employee_id===null && row.department_id===otherDept));
    assert.ok(history.some(row=>row.action==='EXCLUIU_FUNCIONARIO' && row.old_value.includes('Employee revised')));
  });
  // Two administrators try to disable each other; no request may leave zero active admins.
  const secondAdmin = await request(b.token,'/users','POST',{name:'Second Admin B',email:'secondadmin@example.test',password:'Secret123!',role:'ADMIN'});
  assert.equal(secondAdmin.status,201);
  const secondLogin = await auth.login('second','secondadmin@example.test','Secret123!');
  const concurrent = await Promise.all([
    request(b.token,`/users/${secondAdmin.body.id}/status`,'PUT',{active:0}),
    request(secondLogin.token,`/users/${b.user.id}/status`,'PUT',{active:0}),
  ]);
  assert.equal(concurrent.filter(r=>r.status===200).length,1);
  assert.ok(concurrent.every(r=>[200,400,401,403].includes(r.status)));
  const survivor = concurrent[0].status===200 ? b : secondLogin;
  await auth.authenticate(survivor.token,async()=>{
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE company_id=2 AND role='ADMIN' AND active=1").get()).n,1);
  });
} finally { await new Promise<void>(resolve=>server.close(()=>resolve())); await db.close(); }
console.log(`${dialect}: APIs de administração e colaboradores isoladas, escopo por setor/perfil, CPF local, configurações, exclusão com histórico, auditoria atômica e concorrência de administradores aprovados.`);
