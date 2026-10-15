import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PGlite } from '@electric-sql/pglite';
import { importLegacyCompany, type MigrationDatabase } from '../server/db/company-migration';
import { companyPolicies } from '../server/db/company-schema';
import { requireCompanyContext, withCompanyContext, sessionTokenHash } from '../server/services/companyContext';

assert.throws(requireCompanyContext);
await Promise.all([1,2].map(companyId => withCompanyContext({companyId,userId:companyId}, async () => {
  await Promise.resolve();
  assert.equal(requireCompanyContext().companyId, companyId);
  assert.ok(Object.isFrozen(requireCompanyContext()));
  await assert.rejects(withCompanyContext({companyId:companyId+10,userId:companyId}, async () => {}));
})));
assert.throws(requireCompanyContext);
assert.equal(sessionTokenHash('token').length, 64);

for (const dialect of ['sqlite','postgres'] as const) {
  const sqlite = dialect === 'sqlite' ? new DatabaseSync(':memory:') : null;
  sqlite?.exec('PRAGMA foreign_keys=ON');
  const pg = dialect === 'postgres' ? new PGlite() : null;
  const target: MigrationDatabase = {
    exec: async sql => { if(sqlite) sqlite.exec(sql); else await pg!.exec(sql); },
    run: async (sql, params) => { if(sqlite) sqlite.prepare(sql).run(...params as any[]); else await pg!.query(sql,params); },
  };
  const rows = async (sql: string) => sqlite ? sqlite.prepare(sql).all() as any[] : (await pg!.query(sql)).rows as any[];
  await target.exec('BEGIN');
  try {
    await importLegacyCompany(target,dialect,{
      departments:[{id:10,name:'Cozinha'}],
      users:[{id:20,name:'Admin',email:' ADMIN@EXAMPLE.COM ',password_hash:'test-only',role:'ADMIN'}],
      settings:[{id:30,key:'company_name',value:'Antigo'},{id:31,key:'clt_alert_days',value:'6'}],
      user_sessions:[{token:'raw-secret',user_id:20}],
    },{code:'demo',name:'Empresa de demonstração'});
    await target.exec('COMMIT');
  } catch(error) { await target.exec('ROLLBACK'); throw error; }
  assert.equal((await rows('SELECT * FROM user_sessions')).length,0);
  assert.equal((await rows('SELECT * FROM users'))[0].id,20);
  assert.equal((await rows('SELECT * FROM users'))[0].email,'admin@example.com');
  assert.equal((await rows('SELECT * FROM settings')).length,1);
  await target.exec("INSERT INTO companies(id,code,name) VALUES (2,'second','Outra'); INSERT INTO users(company_id,name,email,password_hash,role) VALUES(2,'Admin','admin@example.com','independent','ADMIN'); INSERT INTO departments(company_id,name) VALUES(2,'cozinha');");
  await assert.rejects(target.exec('INSERT INTO user_departments(company_id,user_id,department_id) VALUES(2,20,10)'));
  await assert.rejects(target.exec("INSERT INTO users(company_id,name,email,password_hash) VALUES(1,'Dup','admin@example.com','test')"));
  await assert.rejects(target.exec("INSERT INTO settings(key,value) VALUES('global','invalid')"));
  if(pg) {
    await target.exec(companyPolicies());
    await target.exec('CREATE ROLE company_test_runtime; GRANT USAGE ON SCHEMA public TO company_test_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON users TO company_test_runtime;');
    await target.exec('SET ROLE company_test_runtime');
    assert.equal((await rows('SELECT * FROM users')).length,0);
    await target.exec('BEGIN; SET LOCAL app.company_id=1');
    assert.equal((await rows('SELECT * FROM users')).length,1);
    await assert.rejects(target.exec("UPDATE users SET company_id=2 WHERE id=20"));
    await target.exec('ROLLBACK');
    assert.equal((await rows('SELECT * FROM users')).length,0);
    await target.exec('BEGIN; SET LOCAL app.company_id=2');
    assert.equal((await rows('SELECT * FROM users'))[0].company_id,2);
    await target.exec('COMMIT; RESET ROLE');
  }
  sqlite?.close(); await pg?.close();
  console.log(`${dialect}: importação, IDs, unicidade local, referências e isolamento aprovados.`);
}
