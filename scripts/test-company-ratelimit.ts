import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { companyAuthRouter } from '../server/routes/company-auth';
import type { CompanyAuthStore } from '../server/services/companyAuth';

const store: CompanyAuthStore = {
  async loginCandidate() { return undefined; }, async sessionCandidate() { return undefined; },
  transaction:operation=>operation(),async user() { return undefined; },async passwordHash() { return undefined; },async session() { return undefined; },
  async createSession() { throw new Error('Not expected'); },async deleteSession() { throw new Error('Not expected'); },
};
const app = express();app.use(express.json());app.use('/auth',companyAuthRouter(store,{enforceRateLimitInTests:true}));
const server = http.createServer(app);
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${(server.address() as {port:number}).port}/auth/login`;
try {
  const request = (companyCode:string,email:string)=>fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyCode,email,password:'InvalidPassword123!'}),signal:AbortSignal.timeout(5000)});
  for(let i=0;i<10;i++) assert.equal((await request(i%2?' DEMO ':'demo',i%2?' ADMIN@example.test ':'admin@example.test')).status,401);
  assert.equal((await request('demo','admin@example.test')).status,429);
  for(let i=0;i<9;i++) assert.equal((await request(`other-${i}`,'other@example.test')).status,401);
  assert.equal((await request('different-company','different@example.test')).status,429);
} finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
console.log('HTTP: limite por empresa/e-mail normalizados e limite global por IP, inclusive com variação do código, aprovados.');
