import db, { transaction } from './connection';
async function baseMigration() {
    console.log('🔄 Executando migrações do banco SQLite...');
    // 1. Criação das tabelas base e novas entidades (departamentos, usuários, sessões)
    await db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'MANAGER' CHECK(role IN ('ADMIN', 'MANAGER', 'VIEWER')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS user_departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      department_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
      UNIQUE(user_id, department_id)
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cpf TEXT UNIQUE NOT NULL,
      position TEXT NOT NULL,
      department TEXT NOT NULL,
      department_id INTEGER DEFAULT 1,
      hire_date TEXT NOT NULL,
      work_regime TEXT NOT NULL DEFAULT 'CLT',
      weekly_hours INTEGER NOT NULL DEFAULT 44,
      work_schedule_type TEXT NOT NULL DEFAULT '6x1',
      avatar_url TEXT,
      status TEXT NOT NULL DEFAULT 'ativo',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (department_id) REFERENCES departments(id)
    );

    CREATE TABLE IF NOT EXISTS days_off (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'dsr',
      status TEXT NOT NULL DEFAULT 'confirmada',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
      UNIQUE(employee_id, date)
    );

    CREATE TABLE IF NOT EXISTS work_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      shift TEXT NOT NULL DEFAULT 'integral',
      status TEXT NOT NULL DEFAULT 'trabalho',
      notes TEXT,
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
      UNIQUE(employee_id, date)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER,
      user_id INTEGER,
      user_name TEXT,
      action TEXT NOT NULL,
      entity TEXT NOT NULL DEFAULT 'employee',
      entity_id INTEGER,
      department_id INTEGER,
      old_value TEXT,
      new_value TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      related_id INTEGER,
      department_id INTEGER,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
    );
  `);
    // 2. Migrações incrementais em bancos já existentes (adiciona colunas sem perder dados)
    try {
        const empColumns = await db.prepare(`PRAGMA table_info(employees)`).all() as any[];
        const hasDeptId = empColumns.some(c => c.name === 'department_id' || c.name === 'departmentId');
        if (!hasDeptId) {
            await db.exec(`ALTER TABLE employees ADD COLUMN department_id INTEGER;`);
        }
    }
    catch (err: any) {
        throw err;
    }
    try {
        const auditColumns = await db.prepare(`PRAGMA table_info(audit_logs)`).all() as any[];
        const colNames = auditColumns.map(c => c.name);
        if (!colNames.includes('user_id'))
            await db.exec(`ALTER TABLE audit_logs ADD COLUMN user_id INTEGER;`);
        if (!colNames.includes('user_name'))
            await db.exec(`ALTER TABLE audit_logs ADD COLUMN user_name TEXT;`);
        if (!colNames.includes('entity'))
            await db.exec(`ALTER TABLE audit_logs ADD COLUMN entity TEXT DEFAULT 'employee';`);
        if (!colNames.includes('entity_id'))
            await db.exec(`ALTER TABLE audit_logs ADD COLUMN entity_id INTEGER;`);
        if (!colNames.includes('department_id'))
            await db.exec(`ALTER TABLE audit_logs ADD COLUMN department_id INTEGER;`);
    }
    catch (err: any) {
        throw err;
    }
    try {
        const notifColumns = await db.prepare(`PRAGMA table_info(notifications)`).all() as any[];
        const notifColNames = notifColumns.map(c => c.name);
        if (!notifColNames.includes('department_id'))
            await db.exec(`ALTER TABLE notifications ADD COLUMN department_id INTEGER;`);
    }
    catch (err: any) {
        throw err;
    }
    // 3. Índices de alta performance
    await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
    CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
    CREATE INDEX IF NOT EXISTS idx_employees_department_id ON employees(department_id);
    CREATE INDEX IF NOT EXISTS idx_user_departments_user ON user_departments(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_departments_dep ON user_departments(department_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_days_off_employee_date ON days_off(employee_id, date);
    CREATE INDEX IF NOT EXISTS idx_days_off_date ON days_off(date);
    CREATE INDEX IF NOT EXISTS idx_work_schedules_employee_date ON work_schedules(employee_id, date);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_department ON audit_logs(department_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(is_read);
    CREATE INDEX IF NOT EXISTS idx_notifications_department ON notifications(department_id);
  `);
    console.log('✅ Migrações aplicadas com sucesso!');
}
export async function runSqliteMigrations() {
    await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    const migrate = async (version: number, action: () => Promise<void>) => {
        if (await db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version))
            return;
        await transaction(async () => { await action(); await db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(version); });
    };
    await migrate(1, async () => {
        await baseMigration();
        await db.exec(`INSERT OR IGNORE INTO departments(name) SELECT DISTINCT trim(department) FROM employees WHERE trim(department) <> '';
      UPDATE employees SET department_id = (SELECT id FROM departments WHERE lower(name) = lower(trim(employees.department))) WHERE trim(department) <> '';
      UPDATE employees SET department = (SELECT name FROM departments WHERE id = employees.department_id);`);
        if ((await db.prepare('PRAGMA foreign_key_check').all()).length)
            throw new Error('Vinculos invalidos no banco.');
    });
    await migrate(2, async () => {
        await db.exec(`ALTER TABLE employees ADD COLUMN weekly_work_days TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE notifications ADD COLUMN source_key TEXT;
      CREATE UNIQUE INDEX idx_notifications_source ON notifications(source_key);
      CREATE TABLE notification_reads (
        notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(notification_id,user_id)
      );`);
    });
}
