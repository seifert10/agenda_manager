import type { Request, RequestHandler } from 'express';
import { companyAuthentication, CompanyAuthError, type CompanyUser } from '../services/companyAuth';
import { companyAuthStore } from '../db/company-auth-store';
import { CompanyRequestError } from '../services/companyErrors';
export interface CompanyResult { status?: number; body: unknown; download?: {filename:string;contentType:string} }
const auth = companyAuthentication(companyAuthStore);

/** Use cases return values. Nothing is sent until authentication's transaction commits. */
export function companyEndpoint(operation: (req: Request, user: CompanyUser) => Promise<CompanyResult>): RequestHandler {
  return (req, res, next) => {
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : '';
    auth.authenticate(token, async user => {
      res.locals.companyId=user.companyId;res.locals.userId=user.id;
      if (['POST','PUT','PATCH'].includes(req.method) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
        throw new CompanyRequestError(400, 'Dados da requisição inválidos.');
      }
      for (const input of [req.body, req.query]) {
        if (input && (Object.hasOwn(input, 'company_id') || Object.hasOwn(input, 'companyId') || Object.hasOwn(input, 'companyCode'))) {
          throw new CompanyRequestError(400, 'A empresa é determinada pela sessão.');
        }
      }
      return operation(req, user);
    }).then(result => {
      res.status(result.status || 200);
      if (result.download) res.type(result.download.contentType).attachment(result.download.filename).send(result.body);
      else res.json(result.body);
    }).catch(error => {
      if (error instanceof CompanyRequestError || error instanceof CompanyAuthError) {
        res.status(error.status).json({ error: error.message });
      } else next(error);
    });
  };
}
