import db,{dialect} from './connection';
import { companyTables } from './company-schema';

/** Must run before the future company HTTP server listens. It never fixes privileges. */
export async function assertCompanyRuntimeRole(resolverRole: string) {
  if (dialect !== 'postgres') return;
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(resolverRole)) throw new Error('Papel resolvedor inválido.');
  const role = await db.prepare('SELECT oid,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication FROM pg_catalog.pg_roles WHERE rolname=current_user').get();
  if (!role || role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole || role.rolreplication) throw new Error('Runtime exige papel sem privilégios administrativos.');
  const resolver = await db.prepare('SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolcanlogin,pg_has_role(current_user,oid,?) AS member FROM pg_catalog.pg_roles WHERE rolname=?').get('MEMBER',resolverRole);
  if (!resolver || resolver.rolsuper || resolver.rolbypassrls || resolver.rolcreatedb || resolver.rolcreaterole || resolver.rolreplication || resolver.rolcanlogin || resolver.member) throw new Error('Resolvedor exige papel restrito sem login ou associação ao runtime.');
  const tables = ['companies',...companyTables];
  const rows = await db.prepare(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_has_role(current_user,c.relowner,'MEMBER') AS owner_access FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${tables.map(()=>'?').join(',')})`).all(...tables);
  if (rows.length !== tables.length || rows.some(r=>!r.relrowsecurity || !r.relforcerowsecurity || r.owner_access)) throw new Error('Schema incompleto, RLS desabilitada ou runtime com acesso ao proprietário.');
  const schema = await db.prepare("SELECT has_schema_privilege(current_user,'public','CREATE') AS can_create").get();
  if (schema.can_create) throw new Error('Runtime não pode criar objetos no schema.');
  const database = await db.prepare("SELECT has_database_privilege(current_user,current_database(),'CREATE') AS can_create").get();
  if (database.can_create) throw new Error('Runtime não pode criar schemas no banco.');
  const functions = await db.prepare(`SELECT p.proname,p.prosecdef,p.proconfig,r.rolname AS owner,
    has_function_privilege(current_user,p.oid,'EXECUTE') AS allowed,
    EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
    WHERE n.nspname='public' AND p.proname IN ('company_login_candidate','company_session_candidate')`).all();
  if (functions.length!==2 || functions.some(f=>!f.prosecdef || f.owner!==resolverRole || !f.allowed || f.public_execute || !f.proconfig?.includes('search_path=pg_catalog'))) throw new Error('Resolvedores de autenticação com definição/privilégios inválidos.');
  for (const table of tables) {
    const permissions=await db.prepare('SELECT has_table_privilege(?, ?, ?) AS allowed').get(resolverRole,`public.${table}`,['companies','users','user_sessions'].includes(table)?'INSERT,UPDATE,DELETE,TRUNCATE':'SELECT,INSERT,UPDATE,DELETE,TRUNCATE');
    if(permissions.allowed) throw new Error('Resolvedor não pode escrever autenticação ou acessar tabelas de RH.');
  }
  for(const column of ['id','code','active']) {
    const access=await db.prepare("SELECT has_column_privilege(current_user,'public.companies',?,'UPDATE') AS allowed").get(column);
    if(access.allowed) throw new Error('Runtime não pode alterar identidade/estado da empresa.');
  }
  const platformWrites=await db.prepare("SELECT has_table_privilege(current_user,'public.companies','INSERT,DELETE') OR has_table_privilege(current_user,'public.audit_logs','DELETE') OR has_table_privilege(current_user,'public.user_sessions','UPDATE') AS allowed").get();
  if(platformWrites.allowed) throw new Error('Runtime com concessões operacionais indevidas.');
  for (const table of tables) {
    const access = await db.prepare('SELECT has_table_privilege(current_user,?,?) AS allowed').get(`public.${table}`,'TRUNCATE');
    if (access.allowed) throw new Error('Runtime não pode truncar tabelas.');
  }
  for (const table of ['platform_operations','schema_migrations']) {
    const access = await db.prepare('SELECT has_table_privilege(current_user,?,?) AS allowed').get(`public.${table}`,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE');
    if (access.allowed) throw new Error('Runtime não pode acessar tabelas da plataforma/migração.');
  }
}
