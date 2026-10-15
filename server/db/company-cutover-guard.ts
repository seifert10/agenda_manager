import db from './connection';

/** The legacy runtime cannot serve a database after its company cutover. */
export async function assertLegacyRuntime() {
  const target = await db.prepare('SELECT version FROM schema_migrations WHERE version=3').get();
  if (target) throw new Error('Banco multiempresa: esta versão do runtime legado não pode atendê-lo. Use o artefato multiempresa completo; não retorne à versão sem isolamento.');
}
