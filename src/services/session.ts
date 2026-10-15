const TOKEN_KEY = 'folga_manager_token';
export const getStoredToken = () => localStorage.getItem(TOKEN_KEY);
let snapshot = { token: getStoredToken(), revision: 0, ready: false };
const listeners = new Set<() => void>();
const pending = new Set<AbortController>();
export const getSession = () => snapshot;
export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function rotate(token: string | null) {
  snapshot = { token, revision: snapshot.revision + 1, ready: false };
  for (const controller of pending) controller.abort();
  pending.clear();
  for (const listener of listeners) listener();
}
export function setStoredToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  rotate(token);
}
export function validateSession(revision: number) {
  if (revision !== snapshot.revision) return false;
  snapshot = { ...snapshot, ready: true };
  for (const listener of listeners) listener();
  return true;
}
export function synchronizeSession() {
  const token = getStoredToken();
  if (token !== snapshot.token) rotate(token);
}
window.addEventListener('storage', event => {
  if (event.key === TOKEN_KEY || event.key === null) synchronizeSession();
});
window.addEventListener('focus', synchronizeSession);
export function sessionRequest(authCheck = false) {
  synchronizeSession();
  const current = snapshot;
  if (!authCheck && (!current.token || !current.ready)) throw new Error('Sessão em validação. Entre novamente.');
  const controller = new AbortController();
  pending.add(controller);
  return {
    token: current.token, signal: controller.signal,
    assertCurrent() {
      synchronizeSession();
      if (current.revision !== snapshot.revision || controller.signal.aborted) throw new Error('Sessão alterada; resposta descartada.');
    },
    unauthorized() {
      if (current.revision === snapshot.revision && current.token) setStoredToken(null);
    },
    finish() { pending.delete(controller); },
  };
}
