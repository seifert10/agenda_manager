import 'dotenv/config';
import { readFile } from 'node:fs/promises';

// Secrets arrive through stdin, never CLI arguments or command history.
let source = '';
for await (const chunk of process.stdin) {
  source += chunk;
  if (source.length > 32_768) throw new Error('Entrada operacional muito grande.');
}
let input: any;
try { input = JSON.parse(source); }
catch { console.error('Entrada JSON inválida.'); process.exit(1); }
if (process.env.MIGRATION_DATABASE_URL) process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
else if (process.env.DATABASE_URL || !process.env.DB_PATH) throw new Error('Informe MIGRATION_DATABASE_URL ou DB_PATH local explícito.');
const { default: db, dialect, transaction } = await import('../server/db/connection');
try {
  if (input.action === 'migrate' || input.action === 'initialize') {
    const { normalizeCompanyCode } = await import('../server/services/companyContext');
    normalizeCompanyCode(input.code);
    if (typeof input.name !== 'string' || !input.name.trim()) throw new Error('Nome da empresa obrigatório.');
    if (input.action === 'migrate') {
      const proof = JSON.parse(await readFile(input.backupReport, 'utf8'));
      if (proof.verified !== true || !proof.restoredAt || proof.destinationCode !== input.code) throw new Error('Relatório de restauração verificada obrigatório para o destino.');
      const { upgradeCompanySchema } = await import('../server/db/upgrade-company');
      await upgradeCompanySchema(input, { backupVerified: true });
    } else {
      const { companySchema } = await import('../server/db/company-schema');
      await transaction(async () => {
        const tables = dialect === 'sqlite'
          ? await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
          : await db.prepare("SELECT tablename FROM pg_tables WHERE schemaname='public'").all();
        if (tables.length) throw new Error('Inicialização exige banco vazio; use migração para dados legados.');
        await db.exec(companySchema(dialect));
        await db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO schema_migrations(version) VALUES(3);');
      });
    }
    if (dialect === 'postgres') {
      const { companyPolicies } = await import('../server/db/company-schema');
      const { companyAuthSchema, companyAuthGrants } = await import('../server/db/company-auth-schema');
      const { companyRuntimeGrants } = await import('../server/db/company-runtime-grants');
      // Security installation is atomic; repeating recognizes completed installation.
      await transaction(async () => {
        if(process.env.TEST_DATABASE !== 'postgres') await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74192301);
        const installed = await db.prepare("SELECT to_regprocedure('public.company_login_candidate(text,text)') AS installed").get();
        if (!installed?.installed) {
          await db.exec(companyPolicies());
          await db.exec(companyAuthSchema);
          await db.exec(companyAuthGrants(input.runtimeRole, input.resolverRole));
          await db.exec(companyRuntimeGrants(input.runtimeRole));
        }
      });
    }
    console.log(JSON.stringify({ action: input.action, schemaVersion: 3, securityInstalled: dialect === 'postgres' }));
  } else {
    if (!await db.prepare('SELECT version FROM schema_migrations WHERE version=3').get()) throw new Error('Schema multiempresa obrigatório.');
    const { provisionCompany, setCompanyActive } = await import('../server/services/companyProvisioning');
    const result = input.action === 'create' ? await provisionCompany(input)
      : input.action === 'suspend' || input.action === 'reactivate' ? await setCompanyActive({ ...input, active: input.action === 'reactivate' })
      : (() => { throw new Error('Operação desconhecida.'); })();
    console.log(JSON.stringify(result));
  }
} catch {
  // Driver errors can contain secrets and record values. Do not dump input or exceptions.
  console.error('Operação recusada. Confira schema, destino, relatório de backup, privilégios e identificador da operação.');
  process.exitCode = 1;
} finally { await db.close(); }
