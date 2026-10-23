import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { ApiProblem } from './models';

const API_PREFIX = '/api/';
const LOGIN_URL = '/api/v1/auth/token';

export function newCorrelationId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Adds the bearer token to API calls only (never to third-party URLs). */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).token();
  if (token && req.url.startsWith(API_PREFIX) && req.url !== LOGIN_URL) {
    return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
  }
  return next(req);
};

/** Tags every API call with a correlation id so a UI action can be followed through logs and traces. */
export const correlationInterceptor: HttpInterceptorFn = (req, next) =>
  req.url.startsWith(API_PREFIX) && !req.headers.has('X-Correlation-Id')
    ? next(req.clone({ setHeaders: { 'X-Correlation-Id': newCorrelationId() } }))
    : next(req);

/** Normalises every failure into an {@link ApiProblem}; a 401 on a protected call ends the session. */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: unknown) => {
      const problem = toProblem(err);
      if (problem.status === 401 && req.url !== LOGIN_URL) {
        auth.logout(router.url);
      }
      return throwError(() => problem);
    }),
  );
};

export function toProblem(err: unknown): ApiProblem {
  if (err instanceof HttpErrorResponse) {
    const body = (err.error ?? {}) as Partial<{
      code: string; message: string; violations: { field: string; message: string }[];
      details: Record<string, unknown>; correlationId: string;
    }>;
    if (err.status === 0) {
      return { status: 0, code: 'NETWORK_ERROR', message: 'The server could not be reached. Check your connection and retry.', violations: [], details: {} };
    }
    return {
      status: err.status,
      code: body.code ?? `HTTP_${err.status}`,
      message: body.message ?? err.statusText ?? 'Request failed',
      violations: body.violations ?? [],
      details: body.details ?? {},
      correlationId: body.correlationId ?? err.headers?.get('X-Correlation-Id') ?? undefined,
    };
  }
  return { status: -1, code: 'UNEXPECTED', message: 'An unexpected error occurred.', violations: [], details: {} };
}
