import db, {dialect} from './connection';
import { runMigrations } from './migrate';
import { assertLegacyRuntime } from './company-cutover-guard';
import { generateFakeValidCPF } from '../utils/cpf';
import { hashPassword } from '../utils/auth';
function formatDate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function addDays(d: Date, days: number): Date {
    const result = new Date(d);
    result.setDate(result.getDate() + days);
    return result;
}
export async function runSeed() {
    if (process.env.ALLOW_DATABASE_RESET !== '1' || process.env.NODE_ENV === 'production')
        throw new Error('Seed bloqueado. Use o comando de demonstracao fora de producao.');
    console.log('🌱 Populando banco SQLite com dados fictícios para demonstração...');
    // Garante que tabelas existam
    await runMigrations();
    await assertLegacyRuntime();
    // Limpa dados anteriores para garantir seed limpo
    await db.exec(`
    DELETE FROM user_sessions;
    DELETE FROM user_departments;
    DELETE FROM notifications;
    DELETE FROM audit_logs;
    DELETE FROM work_schedules;
    DELETE FROM days_off;
    DELETE FROM employees;
    DELETE FROM users;
    DELETE FROM departments;
    DELETE FROM settings;
  `);
    if (dialect === 'sqlite') await db.exec("DELETE FROM sqlite_sequence WHERE name IN ('departments','users','user_departments','employees','days_off','work_schedules','audit_logs','notifications')");
    else await db.exec('ALTER TABLE employees ALTER COLUMN id RESTART WITH 1; ALTER TABLE days_off ALTER COLUMN id RESTART WITH 1; ALTER TABLE work_schedules ALTER COLUMN id RESTART WITH 1; ALTER TABLE audit_logs ALTER COLUMN id RESTART WITH 1; ALTER TABLE notifications ALTER COLUMN id RESTART WITH 1; ALTER TABLE settings ALTER COLUMN id RESTART WITH 1; ALTER TABLE user_departments ALTER COLUMN id RESTART WITH 1;');
    const now = new Date();
    const todayStr = formatDate(now);
    const yesterdayStr = formatDate(addDays(now, -1));
    const tomorrowStr = formatDate(addDays(now, 1));
    const dayAfterTomorrowStr = formatDate(addDays(now, 2));
    const threeDaysAfterStr = formatDate(addDays(now, 3));
    const fiveDaysAgoStr = formatDate(addDays(now, -5));
    const sevenDaysAgoStr = formatDate(addDays(now, -7));
    // 1. Setores Iniciais
    const insertDept = db.prepare(`INSERT INTO departments (id, name, active) VALUES (?, ?, 1)`);
    await insertDept.run(1, 'Cozinha');
    await insertDept.run(2, 'Salão');
    await insertDept.run(3, 'Bar');
    await insertDept.run(4, 'Caixa');
    await insertDept.run(5, 'Administrativo');
    // 2. Usuários Fictícios do Sistema com senhas seguras (Credenciais de Teste / Dev)
    // ATENÇÃO: Senhas documentadas apenas para testes locais e desenvolvimento.
    const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `);
    const insertUserDept = db.prepare(`
    INSERT INTO user_departments (user_id, department_id)
    VALUES (?, ?)
  `);
    // ADMIN - admin@folgamanager.local (Senha: AdminPassword123!)
    await insertUser.run(1, 'Administrador Geral', 'admin@folgamanager.local', hashPassword('AdminPassword123!'), 'ADMIN');
    // MANAGER Cozinha - cozinha@folgamanager.local (Senha: CozinhaPassword123!)
    await insertUser.run(2, 'Carlos Silva (Cozinha)', 'cozinha@folgamanager.local', hashPassword('CozinhaPassword123!'), 'MANAGER');
    await insertUserDept.run(2, 1); // Cozinha
    // MANAGER Salão - salao@folgamanager.local (Senha: SalaoPassword123!)
    await insertUser.run(3, 'Maria Santos (Salão)', 'salao@folgamanager.local', hashPassword('SalaoPassword123!'), 'MANAGER');
    await insertUserDept.run(3, 2); // Salão
    // MANAGER Operações (Cozinha + Bar) - operacoes@folgamanager.local (Senha: OperacoesPassword123!)
    await insertUser.run(4, 'João Pereira (Cozinha & Bar)', 'operacoes@folgamanager.local', hashPassword('OperacoesPassword123!'), 'MANAGER');
    await insertUserDept.run(4, 1); // Cozinha
    await insertUserDept.run(4, 3); // Bar
    // VIEWER - visualizacao@folgamanager.local (Senha: ViewerPassword123!)
    await insertUser.run(5, 'Ana Clara (Leitura)', 'visualizacao@folgamanager.local', hashPassword('ViewerPassword123!'), 'VIEWER');
    await insertUserDept.run(5, 1);
    await insertUserDept.run(5, 2);
    await insertUserDept.run(5, 3);
    await insertUserDept.run(5, 4);
    await insertUserDept.run(5, 5);
    if (dialect === 'postgres') await db.exec('ALTER TABLE departments ALTER COLUMN id RESTART WITH 6; ALTER TABLE users ALTER COLUMN id RESTART WITH 6;');
    // 3. Configurações padrão
    const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    await insertSetting.run('company_name', 'Mercado & Restaurante Modelo Ltda');
    await insertSetting.run('manager_name', 'Administrador');
    await insertSetting.run('clt_alert_days', '6');
    await insertSetting.run('onboarding_completed', 'false');
    // 4. Colaboradores Fictícios (10 funcionários distribuídos nos setores)
    const insertEmp = db.prepare(`
    INSERT INTO employees (name, cpf, position, department, department_id, hire_date, work_regime, weekly_hours, work_schedule_type, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const employeesData = [
        { name: 'João Silva', pos: 'Cozinheiro Líder', dep: 'Cozinha', depId: 1, hire: '2023-03-15', regime: 'CLT', hours: 44, sched: '6x1', status: 'ativo' },
        { name: 'Maria Souza', pos: 'Atendente de Salão', dep: 'Salão', depId: 2, hire: '2022-08-10', regime: 'CLT', hours: 44, sched: '6x1', status: 'ativo' },
        { name: 'Carlos Oliveira', pos: 'Auxiliar de Cozinha', dep: 'Cozinha', depId: 1, hire: '2023-01-20', regime: 'CLT', hours: 44, sched: '6x1', status: 'ativo' },
        { name: 'Ana Santos', pos: 'Supervisora de Salão', dep: 'Salão', depId: 2, hire: '2021-05-12', regime: 'CLT', hours: 40, sched: '5x2', status: 'ativo' },
        { name: 'Pedro Ferreira', pos: 'Bartender', dep: 'Bar', depId: 3, hire: '2023-11-01', regime: 'CLT', hours: 44, sched: '6x1', status: 'ativo' },
        { name: 'Lucas Almeida', pos: 'Auxiliar de Bar', dep: 'Bar', depId: 3, hire: '2022-02-18', regime: 'CLT', hours: 44, sched: '6x1', status: 'ativo' },
        { name: 'Juliana Costa', pos: 'Operadora de Caixa', dep: 'Caixa', depId: 4, hire: '2020-09-01', regime: 'CLT', hours: 40, sched: '5x2', status: 'ativo' },
        { name: 'Marcos Lima', pos: 'Padeiro / Cozinha', dep: 'Cozinha', depId: 1, hire: '2023-06-10', regime: 'CLT', hours: 44, sched: '6x1', status: 'ativo' },
        { name: 'Fernanda Alves', pos: 'Garçonete', dep: 'Salão', depId: 2, hire: '2022-10-15', regime: 'CLT', hours: 36, sched: '6x1', status: 'ferias' },
        { name: 'Rafael Gomes', pos: 'Assistente Administrativo', dep: 'Administrativo', depId: 5, hire: '2024-01-08', regime: 'CLT', hours: 44, sched: '6x1', status: 'afastado' },
    ];
    const empIds: number[] = [];
    for (const [index, emp] of employeesData.entries()) {
        const fakeCpf = generateFakeValidCPF(index + 1);
        const result = await insertEmp.run(emp.name, fakeCpf, emp.pos, emp.dep, emp.depId, emp.hire, emp.regime, emp.hours, emp.sched, emp.status);
        empIds.push(Number(result.lastInsertRowid));
    }
    // 5. Folgas Cadastradas
    const insertDayOff = db.prepare(`
    INSERT INTO days_off (employee_id, date, type, status, notes)
    VALUES (?, ?, ?, ?, ?)
  `);
    // João Silva (Cozinha): folga hoje!
    await insertDayOff.run(empIds[0], todayStr, 'dsr', 'confirmada', 'Descanso semanal remunerado regulamentar');
    await insertDayOff.run(empIds[0], sevenDaysAgoStr, 'dsr', 'realizada', 'Folga anterior');
    // Maria Souza (Salão): Última folga há 5 dias, SEM PRÓXIMA FOLGA MARCADA!
    await insertDayOff.run(empIds[1], fiveDaysAgoStr, 'dsr', 'realizada', 'Última folga realizada');
    // Carlos Oliveira (Cozinha): Folga amanhã
    await insertDayOff.run(empIds[2], tomorrowStr, 'dsr', 'confirmada', 'DSR semanal agendado');
    await insertDayOff.run(empIds[2], sevenDaysAgoStr, 'dsr', 'realizada', 'Folga realizada');
    // Ana Santos (Salão - 5x2): folgas no sábado e domingo que vem
    const saturday = formatDate(addDays(now, 5));
    const sunday = formatDate(addDays(now, 6));
    await insertDayOff.run(empIds[3], saturday, 'dsr', 'confirmada', 'Escala 5x2 - Sábado');
    await insertDayOff.run(empIds[3], sunday, 'dsr', 'confirmada', 'Escala 5x2 - Domingo');
    // Pedro Ferreira (Bar): PENDÊNCIA CRÍTICA!
    await insertDayOff.run(empIds[4], sevenDaysAgoStr, 'dsr', 'realizada', 'Folga da semana anterior');
    // Lucas Almeida (Bar): Folga em 2 dias
    await insertDayOff.run(empIds[5], dayAfterTomorrowStr, 'folga_compensatoria', 'planejada', 'Banco de horas acumulado');
    // Juliana Costa (Caixa): folgas
    await insertDayOff.run(empIds[6], saturday, 'dsr', 'confirmada', 'Escala 5x2');
    await insertDayOff.run(empIds[6], sunday, 'dsr', 'confirmada', 'Escala 5x2');
    // Marcos Lima (Cozinha): folga em 3 dias
    await insertDayOff.run(empIds[7], threeDaysAfterStr, 'dsr', 'confirmada', 'DSR semanal');
    // Fernanda Alves (Salão): Férias
    await insertDayOff.run(empIds[8], todayStr, 'ferias', 'confirmada', 'Férias regulamentares');
    await insertDayOff.run(empIds[8], tomorrowStr, 'ferias', 'confirmada', 'Férias');
    // Rafael Gomes (Administrativo): Afastamento
    await insertDayOff.run(empIds[9], todayStr, 'afastamento', 'confirmada', 'Atestado médico');
    // 6. Escalas de trabalho (Work Schedules)
    const insertSchedule = db.prepare(`
    INSERT INTO work_schedules (employee_id, date, shift, status, notes)
    VALUES (?, ?, ?, ?, ?)
  `);
    for (let d = -2; d <= 5; d++) {
        const dStr = formatDate(addDays(now, d));
        for (const [idx, id] of empIds.slice(0, 8).entries()) {
            const isOffToday = (id === empIds[0] && dStr === todayStr) ||
                (id === empIds[2] && dStr === tomorrowStr) ||
                (id === empIds[5] && dStr === dayAfterTomorrowStr);
            const schedStatus = isOffToday ? 'folga' : 'trabalho';
            const shift = idx % 2 === 0 ? 'manha' : 'tarde';
            await insertSchedule.run(id, dStr, shift, schedStatus, `Escala programada ${shift}`);
        }
    }
    // 7. Histórico de Alterações (Audit Logs) com user e department
    const insertAudit = db.prepare(`
    INSERT INTO audit_logs (employee_id, user_id, user_name, action, entity, entity_id, department_id, old_value, new_value, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    await insertAudit.run(empIds[0], 2, 'Carlos Silva (Cozinha)', 'CRIOU_FOLGA', 'days_off', 1, 1, null, todayStr, 'Folga DSR agendada para João Silva', yesterdayStr + ' 10:15:00');
    await insertAudit.run(empIds[2], 2, 'Carlos Silva (Cozinha)', 'ALTEROU_FOLGA', 'days_off', 3, 1, yesterdayStr, tomorrowStr, 'Remarcada folga de Carlos Oliveira a pedido do gestor', yesterdayStr + ' 14:30:00');
    await insertAudit.run(empIds[5], 4, 'João Pereira (Cozinha & Bar)', 'CRIOU_FOLGA', 'days_off', 6, 3, null, dayAfterTomorrowStr, 'Compensação de banco de horas aprovada', todayStr + ' 08:45:00');
    // 8. Notificações Iniciais com department_id
    const insertNotif = db.prepare(`
    INSERT INTO notifications (type, title, message, related_id, department_id)
    VALUES (?, ?, ?, ?, ?)
  `);
    await insertNotif.run('critico', 'Folga Pendente de Definição', 'Maria Souza está há mais de 5 dias sem folga agendada.', empIds[1], 2); // Salão
    await insertNotif.run('critico', 'Folga Pendente no Bar', 'Pedro Ferreira está há 7 dias sem folga agendada.', empIds[4], 3); // Bar
    await insertNotif.run('aviso', 'Folga Próxima a Confirmar', 'Carlos Oliveira possui folga agendada para amanhã.', empIds[2], 1); // Cozinha
    await insertNotif.run('info', 'Escala Semanal Publicada', 'A escala do setor de Cozinha para esta semana foi pré-gerada.', null, 1);
    console.log(`✅ Seed concluído!`);
    console.log(`   - 5 setores criados (Cozinha, Salão, Bar, Caixa, Administrativo)`);
    console.log(`   - 5 usuários criados (ADMIN, MANAGER Cozinha, MANAGER Salão, MANAGER Cozinha+Bar, VIEWER)`);
    console.log(`   - 10 colaboradores criados (com CPFs fictícios válidos)`);
    console.log(`   - Folgas e escalas cadastradas com pendências simuladas`);
    console.log(`   - Histórico de auditoria e notificações iniciadas com vínculo de setor.`);
}
if (process.argv[1]?.includes('seed')) {
    try { await runSeed(); } finally { await db.close(); }
}
