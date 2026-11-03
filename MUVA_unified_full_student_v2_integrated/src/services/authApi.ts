import { httpClient } from './http/client';
import type { LoginCredentials, LoginResponse, UserRole } from '../types/auth';

export interface AuthApi {
  login(credentials: LoginCredentials): Promise<LoginResponse>;
  getCurrentUser(): Promise<LoginResponse['user']>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}

export const demoAccounts: Record<UserRole, { username: string; password: string; displayName: string }> = {
  admin: { username: 'admin01', password: 'admin123', displayName: '系统管理员' },
  teacher: { username: 'teacher01', password: 'teacher123', displayName: '张老师' },
  student: { username: 'student01', password: 'student123', displayName: '张三' },
};

const mockPermissions: Record<UserRole, string[]> = {
  admin: ['user:manage', 'course:manage', 'experiment:definition', 'resource:manage', 'audit:view'],
  teacher: ['course:view', 'experiment:manage', 'student:records', 'grade:manage', 'simulation:demo'],
  student: ['course:view', 'experiment:execute', 'record:self', 'report:self', 'grade:self'],
};

interface MockAccount {
  id: string;
  username: string;
  password: string;
  displayName: string;
  role: UserRole;
  status: 'active' | 'disabled';
}
const mockAccounts = new Map<string, MockAccount>(Object.entries(demoAccounts).map(([role, account]) => [account.username, {
  id: `mock-${role}-001`, username: account.username, password: account.password,
  displayName: account.displayName, role: role as UserRole, status: 'active',
}]));
export function registerMockAccount(account: MockAccount) { mockAccounts.set(account.username, account); }
export function updateMockAccount(username: string, changes: Partial<MockAccount>) {
  const previous = mockAccounts.get(username);
  if (previous) mockAccounts.set(username, { ...previous, ...changes });
}

const mockAuthApi: AuthApi = {
  async login(credentials) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 160));
    const account = mockAccounts.get(credentials.username.trim());
    if (!account || account.role !== credentials.role || account.status !== 'active' || credentials.password !== account.password) {
      throw new Error('账号、密码或所选角色不匹配，请检查后重试。');
    }
    return {
      token: `mock-token-${credentials.role}`,
      user: {
        id: account.id,
        username: account.username,
        displayName: account.displayName,
        role: credentials.role,
        permissions: mockPermissions[credentials.role],
      },
    };
  },
  async getCurrentUser() {
    throw new Error('Mock 模式下用户信息由会话状态恢复');
  },
  async logout() {},
  async changePassword() { throw new Error('演示模式不能修改数据库密码'); },
};

const apiAuthApi: AuthApi = {
  async login(credentials) {
    const { data } = await httpClient.post<LoginResponse>('/auth/login', credentials);
    return data;
  },
  async getCurrentUser() {
    const { data } = await httpClient.get<LoginResponse['user']>('/auth/me');
    return data;
  },
  async logout() {
    await httpClient.post('/auth/logout');
  },
  async changePassword(currentPassword, newPassword) {
    await httpClient.post('/auth/change-password', { currentPassword, newPassword });
  },
};

export const authPresentation = import.meta.env.VITE_AUTH_DATA_SOURCE === 'api'
  ? { demo: false, label: '数据库账号', help: '使用管理员分配的数据库账号登录；密码不会在此页面展示。', footer: '数据库认证 · /api/auth/login' }
  : { demo: true, label: '演示模式', help: '当前为本地演示账号，不连接数据库。', footer: '本地演示认证' };

export const authApi: AuthApi = import.meta.env.VITE_AUTH_DATA_SOURCE === 'api' ? apiAuthApi : mockAuthApi;
