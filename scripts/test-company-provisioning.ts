import assert from 'node:assert/strict';
import db,{dialect} from '../server/db/connection';
import { companySchema,companyPolicies } from '../server/db/company-schema';
import { provisionCompany,setCompanyActive } from '../server/services/companyProvisioning';
import { companyAuthentication } from '../server/services/companyAuth';
import { companyAuthStore } from '../server/db/company-auth-store';
import { companyAuthSchema,companyAuthGrants } from '../server/db/company-auth-schema';
import { companyRuntimeGrants } from '../server/db/company-runtime-grants';

await db.exec(companySchema(dialect));
await db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(3)');
const input={operationKey:'create-company-alpha',operator:'test-operator',code:'alpha',name:'Alpha',adminName:'Admin',email:'same@example.com',password:'ProvisionPassword123!'};
const a=await provisionCompany(input);
assert.deepEqual(await provisionCompany(input),{...a,repeated:true});
await assert.rejects(provisionCompany({...input,name:'Changed'}));
await assert.rejects(provisionCompany({...input,password:'DifferentPassword123!'}));
await assert.rejects(provisionCompany({...input,operationKey:'another-create-key'}));
const b=await provisionCompany({...input,operationKey:'create-company-beta',code:'beta',name:'Beta'});
assert.notEqual(a.companyId,b.companyId);
assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM companies').get()).n,2);
assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM settings').get()).n,6);
if(dialect==='postgres') {
  await db.exec(companyPolicies());await db.exec('CREATE ROLE provisioning_runtime; CREATE ROLE provisioning_resolver;');
  await db.exec(companyAuthSchema);await db.exec(companyAuthGrants('provisioning_runtime','provisioning_resolver'));await db.exec(companyRuntimeGrants('provisioning_runtime'));
}
const auth=companyAuthentication(companyAuthStore);
async function asRuntime<T>(fn:()=>Promise<T>) {
  if(dialect==='postgres') await db.exec('SET ROLE provisioning_runtime');
  try{return await fn();}finally{if(dialect==='postgres')await db.exec('RESET ROLE');}
}
const sessionA=await asRuntime(()=>auth.login('alpha',input.email,input.password));
const sessionB=await asRuntime(()=>auth.login('beta',input.email,input.password));
await setCompanyActive({operationKey:'suspend-alpha-once',operator:'test',code:'alpha',active:false});
await asRuntime(()=>assert.rejects(auth.authenticate(sessionA.token,async()=>true)));
await asRuntime(()=>assert.rejects(auth.login('alpha',input.email,input.password)));
await asRuntime(()=>auth.authenticate(sessionB.token,async user=>assert.equal(user.companyId,b.companyId)));
await setCompanyActive({operationKey:'reactivate-alpha',operator:'test',code:'alpha',active:true});
await asRuntime(()=>assert.rejects(auth.authenticate(sessionA.token,async()=>true)));
await asRuntime(()=>auth.login('alpha',input.email,input.password));
if(dialect==='postgres') await asRuntime(()=>assert.rejects(provisionCompany({...input,operationKey:'runtime-forbidden',code:'forbidden'})));
// Atomic failure on the platform audit must remove the company/admin/default settings too.
if(dialect==='sqlite')await db.exec("CREATE TRIGGER reject_provision BEFORE INSERT ON platform_operations WHEN NEW.operation_key='audit-failure-test' BEGIN SELECT RAISE(ABORT,'audit failed'); END;");
else await db.exec("CREATE FUNCTION reject_provision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation_key='audit-failure-test' THEN RAISE EXCEPTION 'audit failed'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_provision BEFORE INSERT ON platform_operations FOR EACH ROW EXECUTE FUNCTION reject_provision();");
await assert.rejects(provisionCompany({...input,operationKey:'audit-failure-test',code:'rollback'}));
assert.equal(await db.prepare("SELECT id FROM companies WHERE code='rollback'").get(),undefined);
assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM companies').get()).n,2);
console.log(`Provisionamento, idempotência, suspensão, revogação e rollback: OK (${dialect})`);
await db.close();
