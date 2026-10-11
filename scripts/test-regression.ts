import assert from 'node:assert/strict';
import app from '../server/app';
import db, { transaction, dialect } from '../server/db/connection';
import { runMigrations } from '../server/db/migrate';
import { runSeed } from '../server/db/seed';
import { calculateStatus } from '../server/services/dsrRules';
import { dayType } from '../shared/schedule';
import { validDate } from '../shared/dates';
import { generateFakeValidCPF } from '../server/utils/cpf';
import { recurrenceDates } from '../shared/recurrence';
async function installAuditFailure(name: string) {
  if (dialect==='sqlite') await db.exec(`CREATE TEMP TRIGGER ${name} BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit failure'); END`);
  else await db.exec(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$; CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}();`);
}
async function dropAuditFailure(name: string) {
  await db.exec(dialect==='sqlite'?`DROP TRIGGER ${name}`:`DROP TRIGGER ${name} ON audit_logs; DROP FUNCTION ${name}()`);
}
await runMigrations();
await runSeed();
await runMigrations();
assert.equal((await db.prepare('SELECT * FROM schema_migrations').all()).length, 2);
assert.equal(validDate('2026-02-30'), false);
assert.equal(validDate('2028-02-29'), true);
const employee = { id: 1, name: 'Teste', department: 'Cozinha', position: 'QA', status: 'ativo', work_regime: 'CLT', work_schedule_type: '3x4', weekly_work_days: [1, 3, 5], hire_date: '2026-10-01' };
assert.equal(dayType(employee, '2026-10-12'), 'trabalho');
assert.equal(dayType(employee, '2026-10-13'), 'folga');
assert.equal(dayType(employee, '2026-10-13', undefined, { status: 'trabalho' }), 'trabalho');
assert.equal(calculateStatus(employee, '2026-10-12', [], []).smartStatus, 'proxima');
const freelance = { ...employee, work_regime: 'Freelancer' };
assert.equal(dayType(freelance, '2026-10-12'), 'indefinido');
assert.equal(dayType(freelance, '2026-10-12', undefined, { status: 'trabalho' }), 'trabalho');
assert.equal(calculateStatus(freelance, '2026-10-12', [], []).smartStatus, 'sem_escala');
assert.equal(calculateStatus({ ...employee, work_schedule_type: '6x1', weekly_work_days: [], hire_date: '2026-09-01' }, '2026-10-12', [{ date: '2026-10-13', type: 'dsr' }], []).smartStatus, 'pendente');
const server = app.listen(0);
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address() as {
    port: number;
};
const base = `http://localhost:${address.port}/api`;
async function request(path: string, token: string, method = 'GET', body?: unknown) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
}
async function login(email: string, password: string) {
    const result = await request('/auth/login', '', 'POST', { email, password });
    assert.equal(result.status, 200);
    return result.data.token as string;
}
try {
    const admin = await login('admin@folgamanager.local', 'AdminPassword123!');
    const manager = await login('cozinha@folgamanager.local', 'CozinhaPassword123!');
    const create = await request('/employees', admin, 'POST', { name: 'Regressão 3x4', cpf: generateFakeValidCPF(123), position: 'QA', department_id: 1, hire_date: '2026-10-01', work_regime: 'CLT', work_schedule_type: '3x4', weekly_work_days: [1, 3, 5] });
    assert.equal(create.status, 201);
    const id = create.data.id;
    assert.equal((await request(`/employees/${id}`, admin, 'PUT', { weekly_work_days: [1, 3] })).status, 400);
    const off = await request('/days-off', admin, 'POST', { employee_id: id, date: '2026-10-14' });
    assert.equal(off.status, 201);
    await db.prepare("INSERT INTO work_schedules(employee_id,date,status,notes) VALUES (?,?,'folga','Folga agendada')").run(id, '2026-10-14');
    assert.equal((await request(`/days-off/${off.data.id}`, admin, 'PUT', { date: '2026-10-16' })).status, 200);
    assert.equal((await request(`/schedules?employeeId=${id}`, admin)).data.length, 0);
    assert.equal(dayType(employee, '2026-10-14', undefined, { status: 'folga', notes: 'Folga agendada' }), 'trabalho');
    assert.equal((await request('/schedules', admin, 'POST', { employee_id: id, date: '2026-10-16' })).status, 409);
    const before = (await db.prepare('SELECT id FROM days_off WHERE employee_id=?').all(id)).length;
    assert.equal((await request('/days-off/batch', admin, 'POST', { items: [{ employee_id: id, date: '2026-10-20' }, { employee_id: id, date: '2026-02-30' }] })).status, 400);
    assert.equal((await db.prepare('SELECT id FROM days_off WHERE employee_id=?').all(id)).length, before);
    await installAuditFailure('fail_audit');
    await assert.rejects(() => transaction(async () => { await db.prepare("INSERT INTO days_off(employee_id,date) VALUES (?,?)").run(id, '2026-10-21'); await db.prepare("INSERT INTO audit_logs(action) VALUES ('TEST')").run(); }));
    await dropAuditFailure('fail_audit');
    assert.equal(await db.prepare('SELECT id FROM days_off WHERE employee_id=? AND date=?').get(id, '2026-10-21'), undefined);
    const notification = await db.prepare("INSERT INTO notifications(type,title,message,department_id) VALUES ('aviso','Pessoal','Teste',1)").run();
    const notificationId = Number(notification.lastInsertRowid);
    assert.equal((await request(`/notifications/${notificationId}/read`, manager, 'PUT')).status, 200);
    const managerRows = (await request('/notifications', manager)).data.notifications;
    const adminRows = (await request('/notifications', admin)).data.notifications;
    assert.equal(managerRows.find((n: any) => n.id === notificationId).is_read, 1);
    assert.equal(adminRows.find((n: any) => n.id === notificationId).is_read, 0);
    const outside = await db.prepare("INSERT INTO notifications(type,title,message,department_id) VALUES ('aviso','Restrita','Teste',2)").run();
    assert.equal((await request(`/notifications/${outside.lastInsertRowid}/read`, manager, 'PUT')).status, 403);
    assert.equal((await request('/notifications/read-all', manager, 'PUT')).status, 200);
    assert.equal((await request(`/days-off/${off.data.id}`, admin, 'DELETE')).status, 200);
    const free = await request('/employees', admin, 'POST', { name: 'Freelancer QA', cpf: generateFakeValidCPF(124), position: 'QA', department_id: 1, hire_date: '2026-10-01', work_regime: 'Freelancer' });
    assert.equal(free.status, 201);
    assert.equal((await request('/schedules', admin, 'POST', { employee_id: free.data.id, date: '2026-10-12', status: 'trabalho' })).status, 200);
    assert.equal((await request(`/schedules?employeeId=${free.data.id}`, admin)).data.length, 1);
    // Repetição semanal + domingos mensais, preservando marcações prévias.
    assert.deepEqual(recurrenceDates('2026-10-05', { weekly: true, sundays: [1, 3], until: '2026-10-31' }), ['2026-10-05', '2026-10-12', '2026-10-18', '2026-10-19', '2026-10-26']);
    assert.deepEqual(recurrenceDates('2026-11-01', { weekly: false, sundays: [1, 3, 5], until: '2026-12-31' }), ['2026-11-01', '2026-11-15', '2026-11-29', '2026-12-06', '2026-12-20']);
    assert.deepEqual(recurrenceDates('2026-11-01', { weekly: true, sundays: [1, 3], until: '2026-11-15' }), ['2026-11-01', '2026-11-08', '2026-11-15']);
    assert.throws(() => recurrenceDates('2026-10-01', { weekly: true, sundays: [], until: '2028-01-01' }));
    const repeatEmp = await request('/employees', admin, 'POST', { name: 'Recorrência QA', cpf: generateFakeValidCPF(125), position: 'QA', department_id: 1, hire_date: '2026-01-01', work_schedule_type: '6x1' });
    assert.equal(repeatEmp.status, 201);
    const repeatId = repeatEmp.data.id;
    await request('/days-off', admin, 'POST', { employee_id: repeatId, date: '2026-11-09', type: 'ferias', notes: 'Preservar férias' });
    await request('/schedules', admin, 'POST', { employee_id: repeatId, date: '2026-11-16', status: 'trabalho', notes: 'Ajuste individual' });
    const rule = { weekly: true, sundays: [1, 3], until: '2026-11-30' };
    const payload = { employee_id: repeatId, date: '2026-11-02', type: 'dsr', status: 'realizada', recurrence: rule };
    const repeated = await request('/days-off', manager, 'POST', payload);
    assert.equal(repeated.status, 201);
    assert.deepEqual(repeated.data.insertedDates, ['2026-11-02', '2026-11-15', '2026-11-23', '2026-11-30']);
    assert.deepEqual(repeated.data.skippedDates, ['2026-11-09', '2026-11-16']);
    const saved = (await request(`/days-off?employeeId=${repeatId}`, admin)).data;
    assert.equal(saved.find((d: any) => d.date === '2026-11-09').type, 'ferias');
    assert.equal(saved.find((d: any) => d.date === '2026-11-02').status, 'realizada');
    assert.equal(saved.find((d: any) => d.date === '2026-11-23').status, 'planejada');
    assert.equal((await request('/days-off', manager, 'POST', payload)).data.insertedCount, 0);
    const currentId = saved.find((d: any) => d.date === '2026-11-23').id;
    assert.equal((await request(`/days-off/${currentId}`, manager, 'PUT', { recurrence: { weekly: true, sundays: [], until: '2026-12-07' } })).data.insertedCount, 1);
    await installAuditFailure('fail_recurring_audit');
    assert.equal((await request('/days-off', manager, 'POST', { ...payload, date: '2027-01-04', recurrence: { weekly: true, sundays: [], until: '2027-01-18' } })).status, 500);
    await dropAuditFailure('fail_recurring_audit');
    assert.equal(await db.prepare('SELECT id FROM days_off WHERE employee_id=? AND date=?').get(repeatId, '2027-01-04'), undefined);
    assert.equal((await request('/days-off', manager, 'POST', { ...payload, recurrence: { ...rule, sundays: [6] } })).status, 400);
    const viewer = await login('visualizacao@folgamanager.local', 'ViewerPassword123!');
    assert.equal((await request('/days-off', viewer, 'POST', payload)).status, 403);
    const salao = await login('salao@folgamanager.local', 'SalaoPassword123!');
    assert.equal((await request('/days-off', salao, 'POST', payload)).status, 403);
    console.log('Repetições aprovadas: semanal, domingos ordinais, combinação, pré-existentes, repetição idempotente, edição, rollback e escopo.');
    console.log('Regressões aprovadas: 3x4, freelancers, datas, migrações, folgas, lote atômico, auditoria e notificações pessoais com escopo.');
}
finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close();
}
