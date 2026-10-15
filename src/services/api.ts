import { DashboardData, Employee, DayOff, WorkSchedule, AuditLog, AppNotification, SettingsMap, User, Department, AuthResponse } from '../types';
import { OffRecurrence } from '../../shared/recurrence';
export interface OffSaveResult {id?: number; message:string; warning?:string; insertedCount?:number; insertedDates?:string[]; skippedDates?:string[];}

const API_BASE = '/api';

import { sessionRequest, getSession, setStoredToken } from './session';
export { getStoredToken, setStoredToken } from './session';

async function authorizedResult<T>(endpoint: string, options: RequestInit, parse: (response: Response) => Promise<T>): Promise<T> {
  const auth = endpoint.startsWith('/auth/');
  const session = sessionRequest(auth);
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options, signal: session.signal,
      headers: { 'Content-Type': 'application/json', ...(session.token && endpoint !== '/auth/login' ? { Authorization: `Bearer ${session.token}` } : {}), ...options.headers },
    });
    session.assertCurrent();
    if (!res.ok) {
      let message = `Erro ${res.status}: ${res.statusText}`;
      try { const data = await res.json(); if (data.error) message = data.error; } catch { /* Empty error response. */ }
      session.assertCurrent();
      if (res.status === 401 && endpoint !== '/auth/login') session.unauthorized();
      throw new Error(message);
    }
    const result = await parse(res);
    session.assertCurrent();
    return result;
  } finally { session.finish(); }
}
function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  return authorizedResult(endpoint, options, res => res.json());
}

import type { Holiday, HolidaySummary } from '../../shared/holidays';
export const api = {
  getHolidays: (startDate: string, endDate: string): Promise<Holiday[]> =>
    request(`/holidays?${new URLSearchParams({ startDate, endDate })}`),
  getHolidaySummary: (): Promise<HolidaySummary> => request('/holidays/summary'),
  // Autenticação
  login: (companyCode: string, email: string, password: string): Promise<AuthResponse> =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ companyCode, email, password }),
    }),

  logout: async (): Promise<void> => {
    const token = getSession().token;
    setStoredToken(null);
    if (token) await fetch(`${API_BASE}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  },

  getMe: (): Promise<{ user: User }> =>
    request<{ user: User }>('/auth/me'),

  // Usuários (Apenas ADMIN)
  getUsers: (): Promise<User[]> =>
    request<User[]>('/users'),

  createUser: (data: { name: string; email: string; password: string; role: string; departmentIds?: number[]; active?: number }): Promise<{ id: number; message: string }> =>
    request<{ id: number; message: string }>('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateUser: (id: number, data: Partial<{ name: string; email: string; password: string; role: string; departmentIds: number[]; active: number }>): Promise<{ message: string }> =>
    request<{ message: string }>(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  toggleUserStatus: (id: number, active: boolean): Promise<{ message: string }> =>
    request<{ message: string }>(`/users/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ active }),
    }),

  // Departamentos / Setores
  getDepartments: (): Promise<Department[]> =>
    request<Department[]>('/departments'),

  createDepartment: (data: { name: string; active?: number }): Promise<Department> =>
    request<Department>('/departments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateDepartment: (id: number, data: { name?: string; active?: number }): Promise<{ message: string }> =>
    request<{ message: string }>(`/departments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteDepartment: (id: number): Promise<{ message: string }> =>
    request<{ message: string }>(`/departments/${id}`, {
      method: 'DELETE',
    }),

  // Dashboard
  getDashboard: (date?: string): Promise<DashboardData> =>
    request<DashboardData>(date ? `/dashboard?date=${date}` : '/dashboard'),

  // Funcionários
  getEmployees: (params?: { search?: string; department?: string; status?: string; workSchedule?: string }): Promise<Employee[]> => {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.department) query.set('department', params.department);
    if (params?.status) query.set('status', params.status);
    if (params?.workSchedule) query.set('workSchedule', params.workSchedule);
    const qStr = query.toString();
    return request<Employee[]>(`/employees${qStr ? `?${qStr}` : ''}`);
  },

  getEmployeeById: (id: number): Promise<any> =>
    request<any>(`/employees/${id}`),

  createEmployee: (data: Partial<Employee>): Promise<{ id: number; message: string }> =>
    request<{ id: number; message: string }>('/employees', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateEmployee: (id: number, data: Partial<Employee>): Promise<{ message: string }> =>
    request<{ message: string }>(`/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteEmployee: (id: number): Promise<{ message: string }> =>
    request<{ message: string }>(`/employees/${id}`, {
      method: 'DELETE',
    }),

  // Folgas
  getDaysOff: (params?: { startDate?: string; endDate?: string; employeeId?: number; type?: string; month?: string }): Promise<DayOff[]> => {
    const query = new URLSearchParams();
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.employeeId) query.set('employeeId', String(params.employeeId));
    if (params?.type) query.set('type', params.type);
    if (params?.month) query.set('month', params.month);
    const qStr = query.toString();
    return request<DayOff[]>(`/days-off${qStr ? `?${qStr}` : ''}`);
  },

  createDayOff: (data: { employee_id: number; date: string; type?: string; status?: string; notes?: string; recurrence?: OffRecurrence | null }): Promise<OffSaveResult> =>
    request<OffSaveResult>('/days-off', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateDayOff: (id: number, data: { date?: string; type?: string; status?: string; notes?: string; recurrence?: OffRecurrence | null }): Promise<OffSaveResult> =>
    request<OffSaveResult>(`/days-off/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteDayOff: (id: number): Promise<{ message: string }> =>
    request<{ message: string }>(`/days-off/${id}`, {
      method: 'DELETE',
    }),

  batchCreateDaysOff: (items: { employee_id: number; date: string; type?: string; notes?: string }[]): Promise<{ success: boolean; insertedCount: number; errors: string[] }> =>
    request<{ success: boolean; insertedCount: number; errors: string[] }>('/days-off/batch', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  // Escalas
  getSchedules: (params?: { startDate?: string; endDate?: string; employeeId?: number }): Promise<WorkSchedule[]> => {
    const query = new URLSearchParams();
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.employeeId) query.set('employeeId', String(params.employeeId));
    const qStr = query.toString();
    return request<WorkSchedule[]>(`/schedules${qStr ? `?${qStr}` : ''}`);
  },

  saveSchedule: (data: { employee_id: number; date: string; shift?: string; status?: string; notes?: string }): Promise<{ message: string }> =>
    request<{ message: string }>('/schedules', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteSchedule: (id: number): Promise<{message:string}> => request(`/schedules/${id}`, {method:'DELETE'}),

  // Auditoria
  getAuditLogs: (params?: { employeeId?: number; action?: string; limit?: number }): Promise<AuditLog[]> => {
    const query = new URLSearchParams();
    if (params?.employeeId) query.set('employeeId', String(params.employeeId));
    if (params?.action) query.set('action', params.action);
    if (params?.limit) query.set('limit', String(params.limit));
    const qStr = query.toString();
    return request<AuditLog[]>(`/audit${qStr ? `?${qStr}` : ''}`);
  },

  // Relatórios
  getReportsSummary: (): Promise<any> =>
    request<any>('/reports/summary'),

  downloadCsv: async (type: 'folgas' | 'pendencias' | 'auditoria', department?: string, startDate?: string, endDate?: string): Promise<void> => {
    const query = new URLSearchParams({ type });
    if (department) query.set('department', department);
    if (startDate) query.set('startDate', startDate);
    if (endDate) query.set('endDate', endDate);

    const blob = await authorizedResult(`/reports/export-csv?${query.toString()}`, {}, res => res.blob());
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_${type}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  // Notificações
  getNotifications: (): Promise<{ notifications: AppNotification[]; unreadCount: number }> =>
    request<{ notifications: AppNotification[]; unreadCount: number }>('/notifications'),

  markNotificationAsRead: (id: number): Promise<{ message: string }> =>
    request<{ message: string }>(`/notifications/${id}/read`, { method: 'PUT' }),

  markAllNotificationsAsRead: (): Promise<{ message: string }> =>
    request<{ message: string }>('/notifications/read-all', { method: 'PUT' }),

  // Configurações
  getSettings: (): Promise<SettingsMap> =>
    request<SettingsMap>('/settings'),

  updateSettings: (settings: SettingsMap): Promise<{ message: string }> =>
    request<{ message: string }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
};
