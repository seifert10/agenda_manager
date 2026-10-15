import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import db,{dialect} from './db/connection';
import { assertCompanyRuntimeRole } from './db/company-runtime-check';
import { companyAuthStore } from './db/company-auth-store';
import { companyAuthRouter } from './routes/company-auth';
import { companyAdministrationRouter } from './routes/company-administration';
import { companyEmployeesRouter } from './routes/company-employees';
import { companySchedulingRouter } from './routes/company-scheduling';
import { companyReportingRouter } from './routes/company-reporting';
import { companyDashboardRouter } from './routes/company-dashboard';

/** Complete backend composition. Does not migrate, provision, listen or activate legacy startup. */
export async function createCompanyApplication(options:{resolverRole?:string}={}) {
  if(dialect==='postgres') await assertCompanyRuntimeRole(options.resolverRole ?? process.env.COMPANY_AUTH_RESOLVER_ROLE ?? '');
  else if(!await db.prepare('SELECT version FROM schema_migrations WHERE version=3').get()) throw new Error('Aplicação multiempresa exige schema versão 3.');
  const app=express();app.disable('x-powered-by');app.disable('etag');
  if(process.env.NODE_ENV==='production') app.set('trust proxy',1);
  app.use(helmet({contentSecurityPolicy:process.env.NODE_ENV==='production'?undefined:false}));
  if(process.env.NODE_ENV!=='production') app.use(cors());
  app.use(express.json({limit:'1mb'}));
  app.use('/api',(req,res,next)=>{
    const started=performance.now();
    res.locals.requestId=randomUUID();res.setHeader('X-Request-ID',res.locals.requestId);
    res.on('finish',()=>{
      if(process.env.NODE_ENV!=='test') console.log(JSON.stringify({event:'http',requestId:res.locals.requestId,companyId:res.locals.companyId??null,userId:res.locals.userId??null,method:req.method,route:req.route?.path??'unmatched',status:res.statusCode,durationMs:Math.round(performance.now()-started)}));
    });
    next();
  });
  app.use('/api',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  app.get('/api/health',async(_req,res)=>{
    try {await db.prepare('SELECT 1 AS ok').get();res.json({status:'online',app:'Folga Manager API',timestamp:new Date().toISOString()});}
    catch {res.status(503).json({status:'unavailable'});}
  });
  app.use('/api/auth',companyAuthRouter(companyAuthStore));
  app.use('/api',companyAdministrationRouter());
  app.use('/api/employees',companyEmployeesRouter());
  app.use('/api',companySchedulingRouter());
  app.use('/api',companyReportingRouter());
  app.use('/api',companyDashboardRouter());
  app.use('/api',(_req,res)=>res.status(404).json({error:'Rota não encontrada.'}));
  if(process.env.NODE_ENV==='production') {
    app.use(express.static(path.resolve('dist')));
    app.get('*',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));
  }
  app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
    // Database exceptions can contain CPF/values. Never log their message, SQL or parameters.
    if(process.env.NODE_ENV!=='test') console.error('Falha de requisição.',{type:typeof error?.name==='string'?error.name:'Error'});
    if(res.headersSent) return res.end();
    const status=error?.status===400?400:500;
    res.status(status).json({error:status===400?'Requisição inválida.':'Erro interno. Tente novamente.'});
  });
  return app;
}
