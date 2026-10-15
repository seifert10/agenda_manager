/** Applied with migration credentials. Runtime owns no tables and has no platform access. */
export function companyRuntimeGrants(role: string): string {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(role)) throw new Error('Nome de papel inválido.');
  return `
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO ${role};
    GRANT SELECT ON companies TO ${role};
    GRANT UPDATE(name,updated_at) ON companies TO ${role};
    GRANT SELECT,INSERT,UPDATE,DELETE ON users,departments,user_departments,employees,days_off,work_schedules,settings,notifications,notification_reads TO ${role};
    GRANT SELECT,INSERT,DELETE ON user_sessions TO ${role};
    GRANT SELECT,INSERT ON audit_logs TO ${role};
    GRANT UPDATE(employee_id,user_id,department_id) ON audit_logs TO ${role};
    GRANT USAGE,SELECT ON SEQUENCE users_id_seq,departments_id_seq,user_departments_id_seq,employees_id_seq,days_off_id_seq,work_schedules_id_seq,settings_id_seq,notifications_id_seq,audit_logs_id_seq TO ${role};
  `;
}
