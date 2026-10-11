import db, {dialect, transaction} from './connection';
import {runSqliteMigrations} from './migrate-sqlite';
import {baseSchema, recurrenceSchema} from './postgres-schema';

export async function runMigrations() {
  if (dialect === 'sqlite') return runSqliteMigrations();
  // The transaction-scoped lock also protects concurrent Render deploys.
  await transaction(async () => {
    if (process.env.TEST_DATABASE !== 'postgres') await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74192301);
    await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    for (const [version, sql] of [[1,baseSchema],[2,recurrenceSchema]] as const) {
      if (await db.prepare('SELECT version FROM schema_migrations WHERE version=?').get(version)) continue;
      await db.exec(sql);
      await db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(version);
    }
  });
}
if (process.argv[1]?.endsWith('migrate.ts')) {
  try { await runMigrations(); console.log('Migrações concluídas.'); }
  finally { await db.close(); }
}
