import assert from 'node:assert/strict';
import { backup,DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import db,{dialect,sqlite,dbPath} from '../server/db/connection';
import { runMigrations } from '../server/db/migrate';
import { runSeed } from '../server/db/seed';
import { upgradeCompanySchema } from '../server/db/upgrade-company';
import { assertLegacyRuntime } from '../server/db/company-cutover-guard';
import { companyTables } from '../server/db/company-schema';

await runMigrations(); await runSeed(); await assertLegacyRuntime();
// Normalization collision must abort after table reconstruction and recover the entire legacy schema.
const original = await db.prepare('SELECT * FROM users WHERE id=1').get();
const duplicate = await db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run('Collision',original.email.toUpperCase(),original.password_hash,'VIEWER');
const snapshot: Record<string,any[]> = {};
for (const table of companyTables) snapshot[table] = await db.prepare(`SELECT * FROM ${table}`).all();
await assert.rejects(upgradeCompanySchema({code:'demo',name:'Demo'},{backupVerified:true}));
for (const table of companyTables) assert.deepEqual(await db.prepare(`SELECT * FROM ${table}`).all(),snapshot[table]);
assert.equal(await db.prepare('SELECT version FROM schema_migrations WHERE version=3').get(),undefined);
await assertLegacyRuntime();
await db.prepare('DELETE FROM users WHERE id=?').run(Number(duplicate.lastInsertRowid));
let restored: DatabaseSync | undefined;
if (sqlite) {
  const target = path.join(path.dirname(dbPath),'verified-backup.db');
  await backup(sqlite,target);
  restored = new DatabaseSync(target,{readOnly:true});
  assert.equal(restored.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');
  assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(),[]);
  for (const table of companyTables) {
    assert.deepEqual(restored.prepare(`SELECT * FROM ${table}`).all(),await db.prepare(`SELECT * FROM ${table}`).all());
  }
}
const before = await db.prepare('SELECT COUNT(*) AS n FROM employees').get();
if(dialect==='postgres' && process.env.TEST_REAL_POSTGRES==='1') {
  const {spawn}=await import('node:child_process');
  const {Pool}=await import('pg');const {randomBytes}=await import('node:crypto');
  const {writeFile}=await import('node:fs/promises');
  const source=new URL(process.env.DATABASE_URL!),adminAddress=new URL(source);adminAddress.pathname='/postgres';
  const owner=new Pool({connectionString:adminAddress.toString(),max:1});
  const restoredName=`company_test_legacy_${randomBytes(6).toString('hex')}`,dump=path.join(path.dirname(dbPath),'legacy.dump');
  const bin=process.env.COMPANY_TEST_PG_BIN??'C:/Program Files/PostgreSQL/11/bin';
  const command=async(program:string,args:string[],database:string)=>{
    const result=await new Promise(resolve=>{const child=spawn(`${bin}/${program}.exe`,args,{stdio:'inherit',env:{...process.env,PGHOST:source.hostname,PGPORT:source.port,PGUSER:decodeURIComponent(source.username),PGPASSWORD:decodeURIComponent(source.password),PGDATABASE:database}});child.on('exit',resolve);child.on('error',()=>resolve(1));});assert.equal(result,0);
  };
  await command('pg_dump',['-Fc','--file',dump],source.pathname.slice(1));await owner.query(`CREATE DATABASE ${restoredName}`);
  const restoredAddress=new URL(source);restoredAddress.pathname=`/${restoredName}`;const restoredLegacy=new Pool({connectionString:restoredAddress.toString(),max:1});
  try {
    await command('pg_restore',['--exit-on-error','--no-owner','--no-privileges','--dbname',restoredName,dump],restoredName);
    for(const table of companyTables) assert.deepEqual((await restoredLegacy.query(`SELECT * FROM ${table}`)).rows,await db.prepare(`SELECT * FROM ${table}`).all());
  } finally {await restoredLegacy.end();await owner.query(`DROP DATABASE ${restoredName}`);await owner.end();}
  const report=path.join(path.dirname(dbPath),'verified-restore.json');
  await writeFile(report,JSON.stringify({verified:true,destinationCode:'demo',restoredAt:new Date().toISOString(),backup:dump}));
  await db.exec('CREATE ROLE migration_runtime; CREATE ROLE migration_resolver;');
  const cutover=()=>new Promise(resolve=>{
    const child=spawn(process.execPath,['--import','tsx','scripts/company-ops.ts'],{stdio:['pipe','inherit','inherit'],env:{...process.env,MIGRATION_DATABASE_URL:process.env.DATABASE_URL}});
    child.stdin.end(JSON.stringify({action:'migrate',code:'demo',name:'Demo',backupReport:report,runtimeRole:'migration_runtime',resolverRole:'migration_resolver'}));child.on('exit',resolve);child.on('error',()=>resolve(1));
  });
  assert.deepEqual(await Promise.all([cutover(),cutover()]),[0,0]);
  console.log('Backup/restore legado e dois comandos de corte simultâneos com lock transacional: OK');
}
await upgradeCompanySchema({code:'demo',name:'Demo'},{backupVerified:true});
await upgradeCompanySchema({code:'demo',name:'Demo'},{backupVerified:true});
await assert.rejects(upgradeCompanySchema({code:'second',name:'Wrong destination'},{backupVerified:true}));
await assert.rejects(assertLegacyRuntime());
await assert.rejects(runSeed());
assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM employees').get()).n,before.n);
assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM companies').get()).n,1);
assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM user_sessions').get()).n,0);
// The backup remains a complete independent legacy image after the source is migrated.
if (restored) {
  assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM employees').get()!.n,before.n);
  assert.equal(restored.prepare('SELECT version FROM schema_migrations WHERE version=3').get(),undefined);
  restored.close();
}
await db.close();
console.log(`${dialect}: colisão aborta sem perda, migração idempotente e bloqueios de runtime/seed legados aprovados${sqlite?', incluindo backup físico íntegro e leitura restaurada':''}.`);
