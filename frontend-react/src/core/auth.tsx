import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Api, createApi } from './api';
import { createHttp, LOGIN_URL } from './http';
import { Role, TokenResponse } from './models';

export interface Session {
  username: string;
  roles: Role[];
  customerId: string | null;
  token: string;
  expiresAt: number;
}

export interface AuthState {
  user: Session | null;
  isAuthenticated: boolean;
  roles: Role[];
  isStaff: boolean;
  isOperator: boolean;
  isAdmin: boolean;
  isCustomer: boolean;
  hasAny: (...roles: Role[]) => boolean;
  login: (username: string, password: string) => Promise<TokenResponse>;
  logout: (returnUrl?: string) => void;
}

const AuthContext = createContext<AuthState | null>(null);
const ApiContext = createContext<Api | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}

export function useApi(): Api {
  const ctx = useContext(ApiContext);
  if (!ctx) {
    throw new Error('useApi must be used inside <AuthProvider>');
  }
  return ctx;
}

/**
 * Holds the access token IN MEMORY ONLY (React state + a ref). It is never written to localStorage/sessionStorage, so an
 * XSS payload cannot read it from storage and it disappears when the tab closes. Trade-off: a page reload requires
 * signing in again; a production deployment would use OIDC authorization-code + PKCE (ideally through a
 * backend-for-frontend) for silent renewal. Roles only shape the navigation - the server enforces every decision.
 */
export function AuthProvider({ children, fetchImpl }: { children: ReactNode; fetchImpl?: typeof fetch }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const locationRef = useRef(location);
  locationRef.current = location;

  const logout = useCallback(
    (returnUrl?: string) => {
      sessionRef.current = null;
      setSession(null);
      void navigate(returnUrl ? `/login?returnUrl=${encodeURIComponent(returnUrl)}` : '/login');
    },
    [navigate],
  );

  const http = useMemo(
    () =>
      createHttp({
        fetchImpl,
        getToken: () => {
          const s = sessionRef.current;
          return s && s.expiresAt > Date.now() ? s.token : null;
        },
        onUnauthorized: () => logout(locationRef.current.pathname + locationRef.current.search),
      }),
    [fetchImpl, logout],
  );
  const api = useMemo(() => createApi(http), [http]);

  const login = useCallback(
    async (username: string, password: string) => {
      const { data } = await http.post<TokenResponse>(LOGIN_URL, { username, password });
      const next: Session = {
        username: data.username,
        roles: data.roles,
        customerId: data.customerId,
        token: data.accessToken,
        expiresAt: Date.now() + data.expiresInSeconds * 1000,
      };
      sessionRef.current = next;
      setSession(next);
      return data;
    },
    [http],
  );

  // an expired token ends the session at its expiry instant (and at once if it arrives already expired)
  useEffect(() => {
    if (!session) {
      return undefined;
    }
    const t = setTimeout(() => logout(), Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(t);
  }, [session, logout]);

  const value = useMemo<AuthState>(() => {
    const user = session && session.expiresAt > Date.now() ? session : null;
    const roles = user?.roles ?? [];
    const hasAny = (...wanted: Role[]) => wanted.some((r) => roles.includes(r));
    return {
      user,
      isAuthenticated: user !== null,
      roles,
      isStaff: hasAny('SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'ADMIN'),
      isOperator: hasAny('OPERATIONS_ANALYST', 'ADMIN'),
      isAdmin: hasAny('ADMIN'),
      isCustomer: hasAny('CUSTOMER'),
      hasAny,
      login,
      logout,
    };
  }, [session, login, logout]);

  return (
    <AuthContext.Provider value={value}>
      <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
    </AuthContext.Provider>
  );
}

/** Requires a signed-in user; otherwise redirects to the login page remembering where the user wanted to go. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (!auth.isAuthenticated) {
    return <Navigate to={`/login?returnUrl=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <>{children}</>;
}

/** Route-level role check. UI convenience only - the API enforces the same rules. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const auth = useAuth();
  if (roles.length > 0 && !auth.hasAny(...roles)) {
    return <Navigate to="/forbidden" replace />;
  }
  return <>{children}</>;
}
