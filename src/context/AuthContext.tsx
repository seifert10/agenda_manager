import React, { createContext, useContext, useState, useEffect, useSyncExternalStore } from 'react';
import { User, UserRole } from '../types';
import { api } from '../services/api';
import { getSession, subscribeSession, setStoredToken, validateSession } from '../services/session';

interface AuthContextType {
  user: User | null; token: string | null; sessionVersion: number;
  isLoading: boolean; isAuthenticated: boolean;
  isAdmin: boolean; isManager: boolean; isViewer: boolean;
  role: UserRole | null; departments: { id: number; name: string }[]; departmentScopeText: string;
  login: (companyCode: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>; refreshUser: () => Promise<void>;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const [validated, setValidated] = useState<{ revision: number; user: User } | null>(null);
  const user = session.ready && validated?.revision === session.revision ? validated.user : null;
  const loadUser = async (revision: number) => {
    const response = await api.getMe();
    if (!response.user.company?.id || response.user.companyId !== response.user.company.id) throw new Error('Servidor incompatível com sessões multiempresa.');
    if (revision !== getSession().revision) return;
    setValidated({ revision, user: response.user });
    validateSession(revision);
  };
  useEffect(() => {
    let alive = true;
    localStorage.removeItem('folga_manager_user');
    setValidated(null);
    if (session.token) void loadUser(session.revision).catch(() => {
      if (alive && session.revision === getSession().revision) setStoredToken(null);
    });
    return () => { alive = false; };
  }, [session.revision, session.token]);
  const login = async (companyCode: string, email: string, password: string) => {
    const response = await api.login(companyCode, email, password);
    if (!response.user.company?.id) throw new Error('Servidor incompatível com sessões multiempresa.');
    setStoredToken(response.token);
  };
  const logout = async () => { try { await api.logout(); } catch { /* Local state already cleared. */ } };
  const departments = user?.departments ?? [];
  return <AuthContext.Provider value={{
    user, token: session.token, sessionVersion: session.revision,
    isLoading: !!session.token && !user, isAuthenticated: !!user && !!session.token,
    isAdmin: user?.role === 'ADMIN', isManager: user?.role === 'MANAGER', isViewer: user?.role === 'VIEWER',
    role: user?.role ?? null, departments,
    departmentScopeText: user?.role === 'ADMIN' ? 'Todos os setores da empresa' : departments.map(d => d.name).join(' · ') || 'Sem setor',
    login, logout, refreshUser: () => loadUser(getSession().revision),
  }}>{children}</AuthContext.Provider>;
};
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser utilizado dentro de um AuthProvider');
  return context;
};
