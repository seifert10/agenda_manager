import assert from 'node:assert/strict';
const values = new Map<string,string>();
const events = new EventTarget();
Object.assign(globalThis, { localStorage: {
  getItem: (key:string) => values.get(key) ?? null,
  setItem: (key:string,value:string) => { values.set(key,value); },
  removeItem: (key:string) => { values.delete(key); },
}, window: events });
const { api } = await import('../src/services/api');
const session = await import('../src/services/session');
function activate(token: string) {session.setStoredToken(token);session.validateSession(session.getSession().revision);}
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
activate('company-a');
let captured:RequestInit | undefined;
const delayed=deferred<Response>();
globalThis.fetch=async(_url,options)=>{captured=options;return delayed.promise;};
const stale=api.getEmployees();
assert.equal((captured?.headers as any).Authorization,'Bearer company-a');
activate('company-b');
assert.equal(captured?.signal?.aborted,true);
delayed.resolve(new Response(JSON.stringify([{name:'SECRET A'}]),{status:200}));
await assert.rejects(stale,/Sessão alterada/);
assert.equal(session.getSession().token,'company-b');
// Late 401 from A must not revoke the current B session.
const old401=deferred<Response>();globalThis.fetch=async()=>old401.promise;
const old=api.getDashboard();activate('company-c');old401.resolve(new Response('{}',{status:401}));
await assert.rejects(old);assert.equal(session.getSession().token,'company-c');
// Storage changed before React/the storage event ran: sending from the old screen fails closed.
values.set('folga_manager_token','company-d');
let called=false;globalThis.fetch=async()=>{called=true;return new Response('{}');};
await assert.rejects(api.createDayOff({employee_id:1,date:'2026-10-12'}),/validação/);
assert.equal(called,false);assert.equal(session.getSession().ready,false);
session.validateSession(session.getSession().revision);
// Logout clears locally before HTTP finishes; its completion cannot erase a subsequent login.
const logoutResponse=deferred<Response>();globalThis.fetch=async()=>logoutResponse.promise;
const logout=api.logout();assert.equal(session.getSession().token,null);
activate('company-e');logoutResponse.resolve(new Response('{}'));await logout;
assert.equal(session.getSession().token,'company-e');
// Swap while decoding JSON and CSV bodies, after fetch already completed.
const body=deferred<any>();globalThis.fetch=async()=>({ok:true,json:()=>body.promise}) as Response;
const parsed=api.getEmployees();await Promise.resolve();activate('company-f');body.resolve([{name:'OLD'}]);await assert.rejects(parsed);
const blob=deferred<Blob>();globalThis.fetch=async()=>({ok:true,blob:()=>blob.promise}) as Response;
const exportOld=api.downloadCsv('folgas');await Promise.resolve();activate('company-g');blob.resolve(new Blob(['secret']));await assert.rejects(exportOld);
console.log('Sessão frontend: abort, resposta/401/CSV atrasados, storage e logout concorrente: OK');
