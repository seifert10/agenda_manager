import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
if(process.env.TEST_DATABASE==='postgres') {
  console.log('CLI persistente coberta por SQLite e PostgreSQL real; PGlite é somente em memória.');
} else {
  const real=!!process.env.DATABASE_URL;
  if(real) {
    const {Pool}=await import('pg');const owner=new Pool({connectionString:process.env.DATABASE_URL});
    await owner.query('CREATE ROLE ops_runtime; CREATE ROLE ops_resolver;');await owner.end();
  }
  const call=async(input:unknown,success=true)=>{
    let output='',errors='';const status=await new Promise(resolve=>{
      const args=process.env.TEST_COMPILED_COMPANY_OPS==='1'?['dist-server/company-ops.mjs']:['--import','tsx','scripts/company-ops.ts'];
      const child=spawn(process.execPath,args,{env:{...process.env,MIGRATION_DATABASE_URL:process.env.DATABASE_URL??''},stdio:['pipe','pipe','pipe']});
      child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{errors+=chunk;});child.stdin.end(typeof input==='string'?input:JSON.stringify(input));child.on('exit',resolve);child.on('error',()=>resolve(1));
    });
    assert.equal(status,success?0:1);assert.ok(!output.includes('SecretPassword123!'));assert.ok(!errors.includes('SecretPassword123!'));return output;
  };
  const initial={action:'initialize',code:'alpha',name:'Alpha',runtimeRole:'ops_runtime',resolverRole:'ops_resolver'};
  await call(initial);await call(initial,false);
  await call('{"password":"SecretPassword123!',false);
  const input={action:'create',operationKey:'ops-create-alpha',operator:'test',code:'alpha',name:'Alpha',adminName:'Admin',email:'admin@example.com',password:'SecretPassword123!'};
  assert.ok((await call(input)).includes('"repeated":false'));
  assert.ok((await call(input)).includes('"repeated":true'));
  await call({...input,name:'Conflicting'},false);
  await call({action:'suspend',operationKey:'ops-suspend-alpha',operator:'test',code:'alpha'});
  await call({action:'reactivate',operationKey:'ops-reactivate-alpha',operator:'test',code:'alpha'});
  const {default:db}=await import('../server/db/connection');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM companies').get()).n,1);
  assert.equal((await db.prepare('SELECT active FROM companies').get()).active,1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_operations').get()).n,3);
  if(real) {await db.exec('SET ROLE ops_runtime');const {assertCompanyRuntimeRole}=await import('../server/db/company-runtime-check');await assertCompanyRuntimeRole('ops_resolver');}
  await db.close();
  console.log(`CLI stdin, banco vazio, credenciais separadas, idempotência e ciclo de vida: OK (${real?'PostgreSQL real':'SQLite'})`);
}
