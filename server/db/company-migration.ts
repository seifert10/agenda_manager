import { companySchema, companyTables } from './company-schema';
import { normalizeCompanyCode } from '../services/companyContext';

export interface MigrationDatabase {
  exec(sql: string): Promise<void>;
  run(sql: string, params: unknown[]): Promise<void>;
}
export type LegacySnapshot = Partial<Record<typeof companyTables[number], Record<string, unknown>[]>>;

/** Install into an EMPTY target, inside the caller's transaction. Never drops the source. */
export async function importLegacyCompany(target: MigrationDatabase, dialect: 'sqlite' | 'postgres', snapshot: LegacySnapshot, company: { code: string; name: string }) {
  const code = normalizeCompanyCode(company.code);
  if (!company.name.trim()) throw new Error('Nome da empresa obrigatório.');
  await target.exec(companySchema(dialect));
  const insert = async (table: string, row: Record<string, unknown>) => {
    const columns = Object.keys(row);
    if (!columns.every(c => /^[a-z_]+$/.test(c))) throw new Error('Coluna inválida.');
    const markers = columns.map((_, index) => dialect === 'postgres' ? `$${index+1}` : '?');
    await target.run(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${markers.join(',')})`, Object.values(row));
  };
  await insert('companies', { id: 1, code, name: company.name.trim(), active: 1 });
  // Parents precede children; foreign keys enforce the entire imported graph.
  const order = ['departments','users','employees','days_off','work_schedules','settings','notifications','user_departments','notification_reads','audit_logs'] as const;
  for (const table of order) {
    for (const original of snapshot[table] || []) {
      if ('company_id' in original) throw new Error('Origem já possui empresas: importação legada recusada.');
      if (table === 'settings' && original.key === 'company_name') continue;
      const row: Record<string, unknown> = { ...original, company_id: 1 };
      if (table === 'users') row.email = String(row.email).trim().toLowerCase();
      if (table === 'employees') row.cpf = String(row.cpf).replace(/\D/g, '');
      if (table === 'departments') row.name = String(row.name).trim().toLowerCase();
      await insert(table, row);
    }
  }
  // Legacy raw tokens are intentionally not imported. All users must log in again.
  await insert('platform_operations', { company_id: 1, operator: 'legacy-migration', action: 'IMPORT_LEGACY_COMPANY' });
  if (dialect === 'postgres') {
    for (const table of ['companies', ...order.filter(t => t !== 'notification_reads'), 'platform_operations']) {
      await target.exec(`SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE((SELECT MAX(id) FROM ${table}),1), EXISTS(SELECT 1 FROM ${table}));`);
    }
  }
}
