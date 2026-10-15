import type { AuthenticatedUser } from '../middlewares/auth';
import { normalizeCompanyCode, sessionTokenHash, withCompanyContext } from './companyContext';
import { generateSessionToken, hashPassword, verifyPassword } from '../utils/auth';

export interface CompanyUser extends AuthenticatedUser {
  companyId: number;
  company: { id: number; code: string; name: string };
}
export interface CompanyAuthStore {
  loginCandidate(code: string, email: string): Promise<{id:number;company_id:number;password_hash:string}|undefined>;
  sessionCandidate(hash: string): Promise<{id:number;company_id:number;expires_at:string}|undefined>;
  transaction<T>(operation: () => Promise<T>): Promise<T>;
  user(id: number): Promise<CompanyUser|undefined>;
  passwordHash(id: number): Promise<string|undefined>;
  session(hash: string): Promise<{user_id:number;expires_at:string}|undefined>;
  createSession(hash: string, userId: number, expiresAt: string): Promise<void>;
  deleteSession(hash: string): Promise<void>;
}
const dummyPasswordHash = hashPassword('company-auth-dummy-not-a-valid-account');

export class CompanyAuthError extends Error {
  readonly status = 401;
  constructor() { super('Credenciais ou sessão inválidas.'); }
}

/** No caller-supplied company id is accepted. Only resolver results become context. */
export function companyAuthentication(store: CompanyAuthStore, now: () => number = Date.now) {
  return {
    async login(code: unknown, email: unknown, password: unknown) {
      if (typeof code !== 'string' || typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password || password.length > 1024) throw new CompanyAuthError();
      let normalized: string;
      try { normalized = normalizeCompanyCode(code); } catch { throw new CompanyAuthError(); }
      const candidate = await store.loginCandidate(normalized, email.trim().toLowerCase());
      const matches = verifyPassword(password, candidate?.password_hash || dummyPasswordHash);
      if (!candidate || !matches) throw new CompanyAuthError();
      return withCompanyContext({companyId:candidate.company_id,userId:candidate.id}, () => store.transaction(async () => {
        const user = await store.user(candidate.id);
        // An administrative password/email change between resolution and BEGIN invalidates this attempt.
        if (!user || user.companyId !== candidate.company_id || user.email !== email.trim().toLowerCase() || await store.passwordHash(candidate.id) !== candidate.password_hash) throw new CompanyAuthError();
        const token = generateSessionToken();
        await store.createSession(sessionTokenHash(token), candidate.id, new Date(now()+7*24*60*60*1000).toISOString());
        return { token, user };
      }));
    },
    async authenticate<T>(token: string, operation: (user: CompanyUser) => Promise<T>): Promise<T> {
      if (typeof token !== 'string' || !token || token.length > 1024) throw new CompanyAuthError();
      const candidate = await store.sessionCandidate(sessionTokenHash(token));
      const expiration = candidate ? Date.parse(candidate.expires_at) : NaN;
      if (!candidate || !Number.isFinite(expiration) || expiration <= now()) throw new CompanyAuthError();
      return withCompanyContext({companyId:candidate.company_id,userId:candidate.id}, () => store.transaction(async () => {
        const session = await store.session(sessionTokenHash(token));
        const currentExpiration = session ? Date.parse(session.expires_at) : NaN;
        if (!session || session.user_id !== candidate.id || !Number.isFinite(currentExpiration) || currentExpiration <= now()) throw new CompanyAuthError();
        const user = await store.user(candidate.id);
        if (!user || user.companyId !== candidate.company_id) throw new CompanyAuthError();
        return operation(user);
      }));
    },
    async logout(token: string) {
      return this.authenticate(token, async () => { await store.deleteSession(sessionTokenHash(token)); });
    },
  };
}
