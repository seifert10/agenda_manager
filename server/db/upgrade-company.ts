import db, { dialect, transaction } from './connection';
import { companyTables } from './company-schema';
import { importLegacyCompany, type LegacySnapshot } from './company-migration';
import { normalizeCompanyCode } from '../services/companyContext';

/** Migration 3. Caller must take and verify a physical backup before persistent cutover. */
export async function upgradeCompanySchema(company: {code:string;name:string}, options: {backupVerified:boolean}) {
  if (!options.backupVerified) throw new Error('Backup verificado obrigatório antes da migração.');
  const code = normalizeCompanyCode(company.code);
  if (!company.name.trim()) throw new Error('Nome da empresa obrigatório.');
  return transaction(async () => {
    if(dialect === 'postgres' && process.env.TEST_DATABASE !== 'postgres') await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74192301);
    if(await db.prepare('SELECT version FROM schema_migrations WHERE version=3').get()) {
      const destination = await db.prepare('SELECT code FROM companies WHERE id=1').get();
      if (destination?.code !== code) throw new Error('Migração já aplicada para outro destino; remapeamento recusado.');
      return;
    }
    const snapshot: LegacySnapshot = {};
    for(const table of companyTables) snapshot[table] = await db.prepare(`SELECT * FROM ${table}`).all();
    const expected = Object.fromEntries(companyTables.map(table=>[table,snapshot[table]!.length]));
    // Dependency order: all references are removed before their parents.
    for(const table of ['notification_reads','audit_logs','user_departments','user_sessions','days_off','work_schedules','notifications','employees','departments','users','settings']) await db.exec(`DROP TABLE ${table}`);
    await importLegacyCompany({exec:sql=>db.exec(sql),run:async(sql,params)=>{await db.prepare(dialect === 'postgres' ? sql.replace(/\$\d+/g,'?') : sql).run(...params);}},dialect,snapshot,company);
    for(const table of companyTables) {
      const count = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
      const expectedCount = table === 'user_sessions' ? 0 : table === 'settings' ? expected[table] - snapshot.settings!.filter(s=>s.key==='company_name').length : expected[table];
      if(Number(count.count) !== expectedCount) throw new Error(`Contagem divergente na migração: ${table}`);
    }
    if(dialect === 'sqlite' && (await db.prepare('PRAGMA foreign_key_check').all()).length) throw new Error('Referências inválidas na migração.');
    await db.prepare('INSERT INTO schema_migrations(version) VALUES(3)').run();
  });
}
