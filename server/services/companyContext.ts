import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

export interface CompanyContext { readonly companyId: number; readonly userId: number }
const storage = new AsyncLocalStorage<Readonly<CompanyContext>>();

export function requireCompanyContext(): Readonly<CompanyContext> {
  const context = storage.getStore();
  if (!context) throw new Error('Contexto de empresa obrigatório.');
  return context;
}

export async function withCompanyContext<T>(context: CompanyContext, operation: () => Promise<T>): Promise<T> {
  if (!Number.isSafeInteger(context.companyId) || context.companyId < 1 || !Number.isSafeInteger(context.userId) || context.userId < 1) throw new Error('Contexto inválido.');
  const current = storage.getStore();
  if (current) {
    if (current.companyId !== context.companyId || current.userId !== context.userId) throw new Error('Troca de contexto não permitida.');
    return operation();
  }
  return storage.run(Object.freeze({ ...context }), operation);
}

export function sessionTokenHash(token: string): string {
  if (!token || typeof token !== 'string') throw new Error('Token inválido.');
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeCompanyCode(value: string): string {
  const code = value.trim().toLowerCase();
  if (code.length < 3 || code.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) throw new Error('Código da empresa inválido.');
  return code;
}
