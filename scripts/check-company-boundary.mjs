import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root=process.cwd();
const allowedDB=new Set([
  'server/index.ts','server/company-app.ts','server/db/company-auth-store.ts','server/db/company-audit.ts','server/db/company-runtime-check.ts',
  'server/services/companyAdministration.ts','server/services/companyAuthorization.ts','server/services/companyEmployees.ts','server/services/companyScheduling.ts',
  'server/services/companyReporting.ts','server/services/companyNotifications.ts','server/services/companyDashboard.ts',
]);
const visited=new Set();
function inspect(file) {
  if(visited.has(file))return;visited.add(file);
  const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);
  for(const statement of source.statements) {
    if(!ts.isImportDeclaration(statement)||statement.importClause?.isTypeOnly)continue;
    const name=statement.moduleSpecifier.text;
    if(!name.startsWith('.'))continue;
    const target=path.relative(root,path.resolve(root,path.dirname(file),name+'.ts')).replaceAll('\\','/');
    if(target==='server/db/connection.ts' && !allowedDB.has(file))throw new Error(`Importação de banco fora da lista permitida: ${file}`);
    if(target==='server/app.ts'||target.startsWith('server/routes/')&&!path.basename(target).startsWith('company-')||['server/db/seed.ts','server/db/bootstrap.ts','server/db/migrate.ts','server/services/companyProvisioning.ts','server/db/upgrade-company.ts'].includes(target))throw new Error(`Dependência legada/operacional no HTTP: ${file} → ${target}`);
    inspect(target);
  }
}
inspect('server/index.ts');
console.log(`Fronteira HTTP: ${visited.size} módulos revisados; nenhum router legado/provisionamento/migração e imports de banco somente na lista explícita.`);
