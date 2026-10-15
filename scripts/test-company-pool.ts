import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import db,{companyTransaction} from '../server/db/connection';
import { withCompanyContext } from '../server/services/companyContext';
import { createCompanyApplication } from '../server/company-app';
import { companySchema,companyPolicies,companyTables } from '../server/db/company-schema';
import { companyAuthSchema,companyAuthGrants } from '../server/db/company-auth-schema';
import { companyRuntimeGrants } from '../server/db/company-runtime-grants';
import { provisionCompany } from '../server/services/companyProvisioning';

if(process.env.COMPANY_POOL_WORKER==='1') {
  const app=await createCompanyApplication({resolverRole:'pool_resolver'});
  await assert.rejects(db.exec('SET ROLE company_test_owner'));
  await assert.rejects(db.exec('SET ROLE pool_resolver'));
  assert.equal((await db.prepare('SELECT * FROM employees').all()).length,0);
  await assert.rejects(db.exec('CREATE TABLE forbidden_pool(id integer)'));
  await assert.rejects(db.exec('TRUNCATE employees'));
  await assert.rejects(db.prepare('SELECT * FROM platform_operations').all());
  const run=(id:number,operation:()=>Promise<any>)=>withCompanyContext({companyId:id,userId:id},()=>companyTransaction(operation));
  for(let round=0;round<3;round++) {
    await Promise.all(Array.from({length:20},(_,i)=>run(i%2+1,async()=>{
      const rows=await db.prepare('SELECT company_id,name FROM employees').all();
      assert.equal(rows.length,1);assert.equal(rows[0].company_id,i%2+1);
      assert.equal((await db.prepare("SELECT current_setting('app.company_id',true) AS company").get()).company,String(i%2+1));
      await db.prepare('SELECT pg_sleep(?)').get(0.001);
    })));
    await assert.rejects(run(1,async()=>{await db.prepare('UPDATE employees SET name=?').run('rollback');throw new Error('rollback');}));
    await assert.rejects(run(2,async()=>{await db.exec("SET LOCAL statement_timeout='10ms'");await db.prepare('SELECT pg_sleep(?)').get(0.1);}));
    assert.equal((await db.prepare('SELECT * FROM employees').all()).length,0);
    for(const id of [1,2]) await run(id,async()=>{
      assert.equal((await db.prepare('SELECT name FROM employees').get()).name,`EMPRESA ${id}`);
      assert.equal((await db.prepare('UPDATE employees SET name=? WHERE company_id=?').run('forged',id===1?2:1)).changes,0);
      await assert.rejects(withCompanyContext({companyId:id===1?2:1,userId:1},async()=>true));
    });
  }
  if(process.env.DB_POOL_MAX==='3') {
    const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
    const port=(server.address() as any).port;
    const request=async(token:string,path:string,method='GET',body?:unknown)=>{
      const response=await fetch(`http://127.0.0.1:${port}/api${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:response.status,body:await response.json()};
    };
    try {
      const login=await request('','/auth/login','POST',{companyCode:'alpha',email:'same@example.com',password:'CompanyPassword123!'});assert.equal(login.status,200);
      const token=login.body.token;
      const offs=await Promise.all([1,2].map(()=>request(token,'/days-off','POST',{employee_id:1,date:'2026-12-20',type:'dsr'})));
      assert.deepEqual(offs.map(r=>r.status).sort(),[201,400]);
      await run(1,async()=>assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM days_off WHERE date='2026-12-20'").get()).n,1));
      const extra=await request(token,'/users','POST',{name:'Concurrent Admin',email:'concurrent@example.com',password:'CompanyPassword123!',role:'ADMIN'});assert.equal(extra.status,201);
      const second=await request('','/auth/login','POST',{companyCode:'alpha',email:'concurrent@example.com',password:'CompanyPassword123!'});assert.equal(second.status,200);
      const disable=await Promise.all([request(token,`/users/${extra.body.id}/status`,'PUT',{active:0}),request(second.body.token,'/users/1/status','PUT',{active:0})]);
      assert.equal(disable.filter(r=>r.status===200).length,1);assert.ok(disable.every(r=>[200,400,401,403].includes(r.status)));
      await run(1,async()=>assert.equal((await db.prepare("SELECT count(*) AS n FROM users WHERE role='ADMIN' AND active=1").get()).n,1));
      console.log('HTTP concorrente com pool 3: folga única, auditoria atômica e último ADMIN preservado: OK');
    } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
  }
  console.log(`Login real de runtime, RLS, concorrência, rollback/timeout, pool=${process.env.DB_POOL_MAX}: OK`);
  await db.close();
} else {
  await db.exec(companySchema('postgres'));
  await db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(3)');
  for(const [code,name] of [['alpha','Alpha'],['beta','Beta']]) await provisionCompany({operationKey:`pool-create-${code}`,operator:'test',code,name,adminName:'Admin',email:'same@example.com',password:'CompanyPassword123!'});
  for(const id of [1,2]) {
    await db.prepare('INSERT INTO departments(id,company_id,name) VALUES(?,?,?)').run(id,id,'cozinha');
    await db.prepare('INSERT INTO employees(company_id,name,cpf,position,department,department_id,hire_date) VALUES(?,?,?,?,?,?,?)').run(id,`EMPRESA ${id}`,'52998224725','Cargo','cozinha',id,'2020-01-01');
  }
  const secret=randomBytes(32).toString('hex');
  await db.exec(`CREATE ROLE pool_runtime LOGIN PASSWORD '${secret}'; CREATE ROLE pool_resolver;`);
  await db.exec(companyPolicies());await db.exec(companyAuthSchema);await db.exec(companyAuthGrants('pool_runtime','pool_resolver'));await db.exec(companyRuntimeGrants('pool_runtime'));
  const url=new URL(process.env.DATABASE_URL!);url.username='pool_runtime';url.password=secret;
  for(const size of ['1','3']) {
    const status=await new Promise(resolve=>{
      const worker=spawn(process.execPath,['--import','tsx','scripts/test-company-pool.ts'],{stdio:'inherit',env:{...process.env,COMPANY_POOL_WORKER:'1',DATABASE_URL:url.toString(),DB_POOL_MAX:size}});
      worker.on('exit',resolve);worker.on('error',()=>resolve(1));
    });
    assert.equal(status,0);
  }
  // Actual compiled production startup, frontend and HTTP runtime login.
  const production=spawn(process.execPath,['dist-server/index.mjs'],{stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:'production',DATABASE_URL:url.toString(),COMPANY_AUTH_RESOLVER_ROLE:'pool_resolver',PORT:'0',DB_POOL_MAX:'3'}});
  try {
    const port=await new Promise<number>((resolve,reject)=>{
      let output='';const deadline=setTimeout(()=>{production.kill();reject(new Error('Startup compilado não ficou disponível.'));},20000);
      production.stdout.on('data',chunk=>{output+=chunk;const match=/rodando na porta (\d+)/.exec(output);if(match){clearTimeout(deadline);resolve(Number(match[1]));}});
      production.once('exit',()=>{clearTimeout(deadline);reject(new Error('Startup compilado recusado.'));});production.once('error',()=>{clearTimeout(deadline);reject(new Error('Falha de execução compilada.'));});
    });
    const address=`http://127.0.0.1:${port}`;
    assert.equal((await fetch(address+'/api/health')).status,200);
    assert.ok((await (await fetch(address)).text()).includes('Folga Manager'));
    for(const id of [1,2]) {
      const admin=await db.prepare("SELECT email FROM users WHERE company_id=? AND active=1 AND role='ADMIN' LIMIT 1").get(id);
      const response=await fetch(address+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyCode:id===1?'alpha':'beta',email:admin.email,password:'CompanyPassword123!'})});
      assert.equal(response.status,200);const login=await response.json();assert.equal(login.user.companyId,id);
      const employees=await fetch(address+'/api/employees',{headers:{Authorization:`Bearer ${login.token}`}});
      const rows=await employees.json();assert.equal(rows.length,1);assert.equal(rows[0].company_id,id);
      assert.equal((await fetch(address+`/api/employees/${id===1?2:1}`,{headers:{Authorization:`Bearer ${login.token}`}})).status,404);
    }
    console.log('Artefato compilado: startup production, frontend, health e smoke HTTP em duas empresas: OK');
  } finally {production.kill();await new Promise<void>(resolve=>production.once('exit',()=>resolve()));}
  // PostgreSQL physical dump/restore in a second isolated database; operational login sees every company.
  const ownerURL=new URL(process.env.DATABASE_URL!),adminURL=new URL(ownerURL);adminURL.pathname='/postgres';
  const administrator=new Pool({connectionString:adminURL.toString(),max:1});
  const restoredName=`company_test_restore_${randomBytes(6).toString('hex')}`;
  const directory=(await import('node:path')).dirname(process.env.DB_PATH!);
  const dump=(await import('node:path')).join(directory,'global.dump');
  const bin=process.env.COMPANY_TEST_PG_BIN??'C:/Program Files/PostgreSQL/11/bin';
  const command=async(name:string,args:string[],database:string)=>{
    const result=await new Promise(resolve=>{const child=spawn(`${bin}/${name}.exe`,args,{stdio:'inherit',env:{...process.env,PGHOST:ownerURL.hostname,PGPORT:ownerURL.port,PGUSER:decodeURIComponent(ownerURL.username),PGPASSWORD:decodeURIComponent(ownerURL.password),PGDATABASE:database}});child.on('exit',resolve);child.on('error',()=>resolve(1));});assert.equal(result,0);
  };
  await command('pg_dump',['-Fc','--file',dump],ownerURL.pathname.slice(1));
  await administrator.query(`CREATE DATABASE ${restoredName}`);
  const restoredURL=new URL(ownerURL);restoredURL.pathname=`/${restoredName}`;
  const restored=new Pool({connectionString:restoredURL.toString(),max:1});
  try {
    await command('pg_restore',['--no-owner','--no-privileges','--exit-on-error','--dbname',restoredName,dump],restoredName);
    for(const table of ['companies',...companyTables,'platform_operations']) {
      const source=await db.prepare(`SELECT * FROM ${table}`).all(),copy=(await restored.query(`SELECT * FROM ${table}`)).rows;
      assert.deepEqual(copy,source);
      if(table!=='companies') {
        const onlyA=(await restored.query(`SELECT * FROM ${table} WHERE company_id=1`)).rows;
        assert.ok(onlyA.every(row=>row.company_id===1));
        assert.deepEqual(onlyA,source.filter(row=>row.company_id===1));
      }
    }
    const plans=await db.prepare('EXPLAIN SELECT * FROM employees WHERE company_id=? AND department_id=? AND status=?').all(1,1,'ativo');
    assert.ok(JSON.stringify(plans).includes('idx_company_employees'));
    for(const [label,sql,params] of [
      ['dashboard','SELECT o.* FROM days_off o JOIN employees e ON e.company_id=o.company_id AND e.id=o.employee_id WHERE o.company_id=? AND o.date BETWEEN ? AND ?',[1,'2026-12-01','2026-12-31']],
      ['report','SELECT e.id,d.name FROM employees e JOIN departments d ON d.company_id=e.company_id AND d.id=e.department_id WHERE e.company_id=? ORDER BY d.name,e.name,e.id',[1]],
      ['audit','SELECT id FROM audit_logs WHERE company_id=? ORDER BY created_at DESC,id DESC LIMIT ?',[1,100]],
    ] as const) {
      const result=await db.prepare(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${sql}`).get(...params);
      const plan=result['QUERY PLAN'][0].Plan;
      console.log(`Plano ${label}: ${plan['Node Type']}; linhas=${plan['Actual Rows']} (fixture pequena; não é teste de capacidade).`);
    }
    console.log('Dump global, restauração isolada, extração por empresa e índice de listagem: OK');
  } finally {await restored.end();await administrator.query(`DROP DATABASE ${restoredName}`);await administrator.end();}
  await db.close();
}
