import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { Role, TokenResponse } from './models';

export interface Session {
  username: string;
  roles: Role[];
  customerId: string | null;
  token: string;
  expiresAt: number;
}

/**
 * Holds the access token IN MEMORY ONLY. It is never written to localStorage/sessionStorage, so an XSS payload cannot
 * read it from storage and it disappears when the tab closes. Trade-off: a page reload requires signing in again; a
 * production deployment would use OIDC authorization-code + PKCE (ideally through a backend-for-frontend) for silent
 * renewal. The UI uses roles only to shape navigation - the server enforces every authorization decision.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly session = signal<Session | null>(null);

  readonly user = computed(() => {
    const s = this.session();
    return s && s.expiresAt > Date.now() ? s : null;
  });
  readonly isAuthenticated = computed(() => this.user() !== null);
  readonly roles = computed<Role[]>(() => this.user()?.roles ?? []);
  readonly isStaff = computed(() => this.hasAny('SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'ADMIN'));
  readonly isOperator = computed(() => this.hasAny('OPERATIONS_ANALYST', 'ADMIN'));
  readonly isAdmin = computed(() => this.hasAny('ADMIN'));
  readonly isCustomer = computed(() => this.hasAny('CUSTOMER'));

  hasAny(...roles: Role[]): boolean {
    const mine = this.roles();
    return roles.some((r) => mine.includes(r));
  }

  token(): string | null {
    return this.user()?.token ?? null;
  }

  login(username: string, password: string): Observable<TokenResponse> {
    return this.http.post<TokenResponse>('/api/v1/auth/token', { username, password }).pipe(
      tap((t) =>
        this.session.set({
          username: t.username,
          roles: t.roles,
          customerId: t.customerId,
          token: t.accessToken,
          expiresAt: Date.now() + t.expiresInSeconds * 1000,
        }),
      ),
    );
  }

  logout(returnUrl?: string): void {
    this.session.set(null);
    void this.router.navigate(['/login'], returnUrl ? { queryParams: { returnUrl } } : {});
  }
}
