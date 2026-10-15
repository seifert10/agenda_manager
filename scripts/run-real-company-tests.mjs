import { Pool } from 'pg';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const address=new URL(process.env.COMPANY_TEST_POSTGRES_URL??'postgresql://company_test_owner@127.0.0.1:55439/postgres');
if(!['127.0.0.1','localhost'].includes(address.hostname)||address.pathname!=='/postgres') throw new Error('Somente cluster local descartável permitido.');
const owner=new Pool({connectionString:address.toString(),max:1});
const originalRoles=new Set((await owner.query('SELECT rolname FROM pg_roles')).rows.map(r=>r.rolname));
const files=process.argv.slice(2);
for(const file of files.length?files:['scripts/test-company-migration.ts','scripts/test-company-auth.ts','scripts/test-company-administration.ts','scripts/test-company-scheduling.ts','scripts/test-company-provisioning.ts','scripts/test-company-pool.ts','scripts/test-company-ops.ts']) {
  const name=`company_test_${randomBytes(8).toString('hex')}`;
  const directory=mkdtempSync(path.join(tmpdir(),'company-real-tests-'));
  await owner.query(`CREATE DATABASE ${name}`);
  const url=new URL(address);url.pathname=`/${name}`;
  let result;
  try {
    result=await new Promise(resolve=>{
      const child=spawn(process.execPath,['--import','tsx',file],{stdio:'inherit',env:{...process.env,NODE_ENV:'test',DATABASE_URL:url.toString(),TEST_DATABASE:'',TEST_REAL_POSTGRES:'1',DB_POOL_MAX:'1',DB_PATH:path.join(directory,'unused.db'),DOTENV_CONFIG_PATH:path.join(directory,'absent.env'),ALLOW_DATABASE_RESET:'1',TZ:'America/Sao_Paulo'}});
      child.on('exit',resolve);child.on('error',()=>resolve(1));
    });
  } finally {
    await owner.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',[name]);
    await owner.query(`DROP DATABASE ${name}`);
    const roles=(await owner.query('SELECT rolname FROM pg_roles')).rows.map(r=>r.rolname).filter(role=>!originalRoles.has(role));
    for(const role of roles) {if(!/^[a-z][a-z0-9_]+$/.test(role))throw new Error('Papel inesperado.');await owner.query(`DROP ROLE ${role}`);}
    const resolved=path.resolve(directory);
    if(!resolved.startsWith(path.resolve(tmpdir())+path.sep))throw new Error('Diretório de teste inválido.');
    rmSync(resolved,{recursive:true,force:true});
  }
  if(result!==0){await owner.end();process.exit(1);}
}
await owner.end();
