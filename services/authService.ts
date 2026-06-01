export type AuthUser = {
  id: string;
  email: string;
  orgId: string;
  role: 'owner' | 'editor' | 'viewer';
};

const TOKEN_KEY = 'smartcat-auth-token';
const USER_KEY = 'smartcat-auth-user';

function resolveApiBase(): string {
  const fromEnv =
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    (import.meta.env.VITE_LOCAL_DB_URL as string | undefined);
  return (fromEnv ?? 'http://127.0.0.1:58741').replace(/\/$/, '');
}

export function getApiBaseUrl(): string {
  return resolveApiBase();
}

export function isAuthRequired(): boolean {
  const explicit = import.meta.env.VITE_REQUIRE_AUTH;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  const base = resolveApiBase();
  return !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base);
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setAuthSession(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuthSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${resolveApiBase()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : '登录失败');
  }
  setAuthSession(data.token, data.user);
  return data.user as AuthUser;
}

export async function register(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${resolveApiBase()}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : '注册失败');
  }
  setAuthSession(data.token, data.user);
  return data.user as AuthUser;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const token = getAuthToken();
  if (!token) return null;
  const res = await fetch(`${resolveApiBase()}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    clearAuthSession();
    return null;
  }
  const data = await res.json();
  const user = data.user as AuthUser;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export function logout(): void {
  clearAuthSession();
}
