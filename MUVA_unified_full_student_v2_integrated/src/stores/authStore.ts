import { create } from 'zustand';

import { authApi, authPresentation, demoAccounts } from '../services/authApi';
import { useCollaborationStore } from './collaborationStore';
import type { LoginCredentials, UserRole } from '../types/auth';

export type { UserRole } from '../types/auth';

interface LoginResult {
  ok: boolean;
  message?: string;
}

interface AuthState {
  signedIn: boolean;
  checkingSession: boolean;
  restoreSession: () => Promise<void>;
  username: string;
  userId: string;
  displayName: string;
  role: UserRole;
  permissions: string[];
  token: string;
  login: (credentials: LoginCredentials) => Promise<LoginResult>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const sessionKey = 'muva-mock-user';
const roleKey = 'muva-user-role';
const usernameKey = 'muva-username';
const userIdKey = 'muva-user-id';
const displayNameKey = 'muva-display-name';
const tokenKey = 'muva-auth-token';
const permissionKey = 'muva-permissions';

const storedRole = sessionStorage.getItem(roleKey) as UserRole | null;
const initialRole: UserRole = storedRole && storedRole in demoAccounts ? storedRole : 'student';
const initialUsername = sessionStorage.getItem(usernameKey) ?? demoAccounts[initialRole].username;
const storedToken = sessionStorage.getItem(tokenKey) ?? '';
const apiAuthentication = import.meta.env.VITE_AUTH_DATA_SOURCE === 'api';
// A session created against the database must not silently become a Mock admin (or vice versa).
const matchingSession = apiAuthentication ? Boolean(storedToken) && !storedToken.startsWith('mock-token-')
  : storedToken === `mock-token-${initialRole}`;
const initialSignedIn = sessionStorage.getItem(sessionKey) === 'signed-in' && matchingSession;
const storedPermissions = (() => {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(permissionKey) ?? '[]');
    return Array.isArray(value) && value.every((permission) => typeof permission === 'string') ? value as string[] : [];
  } catch { return []; }
})();

export const getRoleHomePath = (role: UserRole) => {
  if (role === 'admin') return '/admin/dashboard';
  if (role === 'teacher') return '/teacher/dashboard';
  return '/dashboard';
};

export const getDemoAccount = (role: UserRole) => demoAccounts[role];
export const getAuthPresentation = () => authPresentation;

export const useAuthStore = create<AuthState>((set) => ({
  signedIn: initialSignedIn,
  checkingSession: apiAuthentication && initialSignedIn,
  restoreSession: async () => {
    if (import.meta.env.VITE_AUTH_DATA_SOURCE !== 'api' || !sessionStorage.getItem(tokenKey)) {
      set({ checkingSession: false });
      return;
    }
    try {
      const user = await authApi.getCurrentUser();
      sessionStorage.setItem(roleKey, user.role);
      sessionStorage.setItem(usernameKey, user.username);
      sessionStorage.setItem(userIdKey, user.id);
      sessionStorage.setItem(displayNameKey, user.displayName);
      sessionStorage.setItem(permissionKey, JSON.stringify(user.permissions));
      set({ signedIn: true, role: user.role, userId: user.id, username: user.username, displayName: user.displayName, permissions: user.permissions });
    } catch {
      for (const key of [sessionKey, roleKey, usernameKey, userIdKey, displayNameKey, tokenKey, permissionKey]) sessionStorage.removeItem(key);
      set({ signedIn: false, token: '', permissions: [] });
    } finally {
      set({ checkingSession: false });
    }
  },
  username: initialUsername,
  userId: sessionStorage.getItem(userIdKey) ?? `mock-${initialRole}-001`,
  displayName: sessionStorage.getItem(displayNameKey) ?? demoAccounts[initialRole].displayName,
  role: initialRole,
  permissions: storedPermissions,
  token: initialSignedIn ? storedToken : '',
  login: async (credentials) => {
    try {
      const response = await authApi.login(credentials);
      const previous = useAuthStore.getState();
      if (previous.signedIn && previous.username !== response.user.username) {
        // Switching accounts from /login is also a logout: never discard a flying fleet.
        await previous.logout();
      }
      sessionStorage.setItem(sessionKey, 'signed-in');
      sessionStorage.setItem(roleKey, response.user.role);
      sessionStorage.setItem(usernameKey, response.user.username);
      sessionStorage.setItem(userIdKey, response.user.id);
      sessionStorage.setItem(displayNameKey, response.user.displayName);
      sessionStorage.setItem(tokenKey, response.token);
      sessionStorage.setItem(permissionKey, JSON.stringify(response.user.permissions));
      // Re-authenticating the same account within this tab keeps its active exercise.
      if (!previous.signedIn || previous.username !== response.user.username) useCollaborationStore.getState().reset();
      set({
        signedIn: true,
        username: response.user.username,
        userId: response.user.id,
        displayName: response.user.displayName,
        role: response.user.role,
        permissions: response.user.permissions,
        token: response.token,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '登录失败' };
    }
  },
  changePassword: async (currentPassword, newPassword) => {
    await authApi.changePassword(currentPassword, newPassword);
    await useAuthStore.getState().logout();
  },
  logout: async () => {
    const collaboration = useCollaborationStore.getState();
    if (collaboration.clusterRunning || collaboration.clusterStarting) collaboration.stopCluster();
    const landed = () => {
      const state = useCollaborationStore.getState();
      return !state.clusterRunning && !state.clusterStarting && !state.stopRequested && !state.isRunning
        && !state.schedulerState.activeRuns.length
        && !state.missionState.drones.some(drone => drone.armed || drone.instanceStatus === 'RETURNING');
    };
    if (!landed()) await new Promise<void>(resolve => {
      const unsubscribe = useCollaborationStore.subscribe(() => { if (landed()) { unsubscribe(); resolve(); } });
      if (landed()) { unsubscribe(); resolve(); }
    });
    // Do not erase active leases or recordings until the Mock aircraft finish their return.
    useCollaborationStore.getState().reset();
    if (import.meta.env.VITE_AUTH_DATA_SOURCE === 'api' && sessionStorage.getItem(tokenKey)) {
      try { await authApi.logout(); } catch { /* Local logout must work when the server is unavailable. */ }
    }
    sessionStorage.removeItem(sessionKey);
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem(permissionKey);
    sessionStorage.removeItem(roleKey);
    sessionStorage.removeItem(usernameKey);
    sessionStorage.removeItem(userIdKey);
    sessionStorage.removeItem(displayNameKey);
    set({ signedIn: false, permissions: [], token: '' });
  },
}));
