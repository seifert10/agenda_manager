import db, { companyTransaction, dialect, requireCompanyTransaction } from './connection';
import type { CompanyAuthStore, CompanyUser } from '../services/companyAuth';

/** The only unscoped queries are the two narrow auth resolvers. */
export const companyAuthStore: CompanyAuthStore = {
  async loginCandidate(code, email) {
    if(dialect === 'postgres') return db.prepare('SELECT * FROM public.company_login_candidate(?,?)').get(code,email);
    return db.prepare(`SELECT u.id,u.company_id,u.password_hash FROM users u JOIN companies c ON c.id=u.company_id WHERE c.code=? AND u.email=? AND u.active=1 AND c.active=1`).get(code,email);
  },
  async sessionCandidate(hash) {
    if(dialect === 'postgres') return db.prepare('SELECT * FROM public.company_session_candidate(?)').get(hash);
    return db.prepare(`SELECT s.user_id AS id,s.company_id,s.expires_at FROM user_sessions s JOIN users u ON u.id=s.user_id AND u.company_id=s.company_id JOIN companies c ON c.id=s.company_id WHERE s.token_hash=? AND u.active=1 AND c.active=1`).get(hash);
  },
  transaction: companyTransaction,
  async passwordHash(id) {
    const {companyId,userId} = requireCompanyTransaction();
    if (id !== userId) throw new Error('Credencial fora do contexto.');
    return (await db.prepare('SELECT password_hash FROM users WHERE company_id=? AND id=? AND active=1').get(companyId,id))?.password_hash;
  },
  async session(hash) {
    const {companyId,userId} = requireCompanyTransaction();
    return db.prepare('SELECT user_id,expires_at FROM user_sessions WHERE company_id=? AND user_id=? AND token_hash=?').get(companyId,userId,hash);
  },
  async user(id) {
    const {companyId,userId} = requireCompanyTransaction();
    if(id !== userId) throw new Error('Usuário fora do contexto.');
    const row = await db.prepare(`SELECT u.id,u.name,u.email,u.role,u.active,c.id AS company_id,c.code AS company_code,c.name AS company_name FROM users u JOIN companies c ON c.id=u.company_id WHERE u.company_id=? AND u.id=? AND u.active=1 AND c.active=1`).get(companyId,id);
    if(!row) return;
    const departments = row.role === 'ADMIN'
      ? await db.prepare('SELECT id,name FROM departments WHERE company_id=? AND active=1 ORDER BY name').all(companyId)
      : await db.prepare(`SELECT d.id,d.name FROM user_departments ud JOIN departments d ON d.company_id=ud.company_id AND d.id=ud.department_id WHERE ud.company_id=? AND ud.user_id=? AND d.active=1 ORDER BY d.name`).all(companyId,id);
    return {id:row.id,name:row.name,email:row.email,role:row.role,active:row.active,companyId,company:{id:companyId,code:row.company_code,name:row.company_name},departments,departmentIds:departments.map(d=>d.id)} as CompanyUser;
  },
  async createSession(hash,userId,expiresAt) {
    const context = requireCompanyTransaction();
    if(userId !== context.userId) throw new Error('Sessão fora do contexto.');
    await db.prepare('INSERT INTO user_sessions(token_hash,company_id,user_id,expires_at) VALUES(?,?,?,?)').run(hash,context.companyId,userId,expiresAt);
  },
  async deleteSession(hash) {
    const {companyId,userId} = requireCompanyTransaction();
    await db.prepare('DELETE FROM user_sessions WHERE company_id=? AND user_id=? AND token_hash=?').run(companyId,userId,hash);
  },
};
