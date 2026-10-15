import 'dotenv/config';
import path from 'node:path';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
// Browser rehearsal always uses disposable data, irrespective of the local app database.
const directory=mkdtempSync(path.join(tmpdir(),'company-browser-'));
process.env.NODE_ENV='test';process.env.DATABASE_URL='';process.env.TEST_DATABASE='';
process.env.DB_PATH=path.join(directory,'browser.db');process.env.ALLOW_DATABASE_RESET='1';
const {runMigrations}=await import('../server/db/migrate');
const {runSeed}=await import('../server/db/seed');
const {upgradeCompanySchema}=await import('../server/db/upgrade-company');
const {provisionCompany}=await import('../server/services/companyProvisioning');
const {default:db}=await import('../server/db/connection');
await runMigrations();await runSeed();await upgradeCompanySchema({code:'demo',name:'Empresa de demonstração'},{backupVerified:true});
const beta=await provisionCompany({operationKey:'browser-create-beta',operator:'test',code:'beta',name:'Empresa Beta',adminName:'Administrador Beta',email:'admin@folgamanager.local',password:'BetaPassword123!'});
const department=await db.prepare('INSERT INTO departments(company_id,name) VALUES(?,?)').run(beta.companyId,'cozinha');
await db.prepare('INSERT INTO employees(company_id,name,cpf,position,department,department_id,hire_date) VALUES(?,?,?,?,?,?,?)').run(beta.companyId,'COLABORADOR EXCLUSIVO BETA','52998224725','Cargo','cozinha',Number(department.lastInsertRowid),'2020-01-01');
const {hashPassword}=await import('../server/utils/auth');
for(const role of ['MANAGER','VIEWER']) {
  const user=await db.prepare('INSERT INTO users(company_id,name,email,password_hash,role) VALUES(?,?,?,?,?)').run(beta.companyId,role+' Beta',role.toLowerCase()+'@example.com',hashPassword('BetaPassword123!'),role);
  await db.prepare('INSERT INTO user_departments(company_id,user_id,department_id) VALUES(?,?,?)').run(beta.companyId,Number(user.lastInsertRowid),Number(department.lastInsertRowid));
}
const {createCompanyApplication}=await import('../server/company-app');
const {default:express}=await import('express');
const app=await createCompanyApplication();app.use(express.static(path.resolve('dist')));app.get('*',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));
app.listen(3417,'127.0.0.1',()=>console.log('Ensaio de navegador: http://127.0.0.1:3417 (dados descartáveis)'));
