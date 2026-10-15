import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createHash } from 'node:crypto';
import { companyAuthentication, CompanyAuthError, type CompanyAuthStore } from '../services/companyAuth';
import { asyncHandler } from '../utils/asyncHandler';

/** Mounted only by the multi-company app after all protected routes have tenant scope. */
export function companyAuthRouter(store: CompanyAuthStore, options: { enforceRateLimitInTests?: boolean } = {}) {
  const router = Router();
  const auth = companyAuthentication(store);
  const skip = () => process.env.NODE_ENV==='test' && !options.enforceRateLimitInTests;
  const limit = rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-7',legacyHeaders:false,skip,message:{error:'Muitas tentativas de login. Aguarde alguns minutos.'}});
  const accountLimit = rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,skip,
    keyGenerator:req=>createHash('sha256').update(JSON.stringify([String(req.body?.companyCode || '').trim().toLowerCase(),String(req.body?.email || '').trim().toLowerCase()])).digest('hex'),
    message:{error:'Muitas tentativas de login. Aguarde alguns minutos.'}});
  const tokenFrom = (header?: string) => header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  router.post('/login',limit,accountLimit,asyncHandler(async(req,res)=>{
    try {
      const result = await auth.login(req.body?.companyCode,req.body?.email,req.body?.password);
      res.json(result);
    } catch(error) {
      if(error instanceof CompanyAuthError) return res.status(401).json({error:error.message});
      throw error;
    }
  }));
  router.get('/me',asyncHandler(async(req,res)=>{
    try {
      const user = await auth.authenticate(tokenFrom(req.headers.authorization),async user=>user);
      res.json({user});
    } catch(error) {
      if(error instanceof CompanyAuthError) return res.status(401).json({error:error.message});
      throw error;
    }
  }));
  router.post('/logout',asyncHandler(async(req,res)=>{
    try { await auth.logout(tokenFrom(req.headers.authorization)); }
    catch(error) { if(!(error instanceof CompanyAuthError)) throw error; }
    res.json({message:'Logout realizado com sucesso'});
  }));
  return router;
}
