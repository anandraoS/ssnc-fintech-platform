import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Account, AccountStatus, AccountType, Attempt, AuditRow, Balance, Customer, PageResponse, PlatformHealth,
  Reconciliation, SubmitTransactionRequest, Summary, Transaction, TransactionStatus, TransactionType,
} from './models';

const BASE = '/api/v1';

export type Query = Record<string, string | number | boolean | string[] | null | undefined>;

/** Builds HttpParams, dropping empty values so filters that are not set never reach the server. */
export function toParams(query: Query): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') {
      continue;
    }
    if (Array.isArray(value)) {
      value.filter((v) => v !== '').forEach((v) => (params = params.append(key, v)));
    } else {
      params = params.set(key, String(value));
    }
  }
  return params;
}

export interface TransactionQuery extends Query {
  status?: TransactionStatus[];
  type?: TransactionType | '';
  accountId?: string;
  reference?: string;
  from?: string;
  to?: string;
  minAmount?: string;
  maxAmount?: string;
  page?: number;
  size?: number;
  sort?: string;
}

/** Typed facade over the REST API. No business rules here - the server owns them. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  // dashboard / ops
  summary(): Observable<Summary> {
    return this.http.get<Summary>(`${BASE}/ops/summary`);
  }
  health(): Observable<PlatformHealth> {
    return this.http.get<PlatformHealth>(`${BASE}/ops/health`);
  }
  auditEvents(query: Query): Observable<PageResponse<AuditRow>> {
    return this.http.get<PageResponse<AuditRow>>(`${BASE}/ops/audit-events`, { params: toParams(query) });
  }
  reconciliations(query: Query = {}): Observable<PageResponse<Reconciliation>> {
    return this.http.get<PageResponse<Reconciliation>>(`${BASE}/ops/reconciliations`, { params: toParams(query) });
  }
  resolveReconciliation(id: string, resolution: 'CONFIRMED_EXECUTED' | 'CONFIRMED_NOT_EXECUTED', note: string): Observable<Reconciliation> {
    return this.http.post<Reconciliation>(`${BASE}/ops/reconciliations/${id}/resolve`, { resolution, note });
  }
  drain(): Observable<{ dispatched: number; reconciled: number; recoveredStuck: number }> {
    return this.http.post<{ dispatched: number; reconciled: number; recoveredStuck: number }>(`${BASE}/ops/processing/drain`, {});
  }

  // customers
  customers(query: Query): Observable<PageResponse<Customer>> {
    return this.http.get<PageResponse<Customer>>(`${BASE}/customers`, { params: toParams(query) });
  }
  createCustomer(body: { legalName: string; email: string; phone?: string }): Observable<Customer> {
    return this.http.post<Customer>(`${BASE}/customers`, body);
  }

  // accounts
  accounts(query: { customerId?: string; status?: AccountStatus | ''; type?: AccountType | ''; q?: string; page?: number; size?: number; sort?: string }): Observable<PageResponse<Account>> {
    return this.http.get<PageResponse<Account>>(`${BASE}/accounts`, { params: toParams(query) });
  }
  account(id: string): Observable<Account> {
    return this.http.get<Account>(`${BASE}/accounts/${id}`);
  }
  balance(id: string): Observable<Balance> {
    return this.http.get<Balance>(`${BASE}/accounts/${id}/balance`);
  }
  accountTransactions(id: string, query: Query): Observable<PageResponse<Transaction>> {
    return this.http.get<PageResponse<Transaction>>(`${BASE}/accounts/${id}/transactions`, { params: toParams(query) });
  }
  openAccount(customerId: string, body: { accountType: AccountType; currency: string; dailyWithdrawalLimit?: string }): Observable<Account> {
    return this.http.post<Account>(`${BASE}/customers/${customerId}/accounts`, body);
  }
  accountAction(id: string, action: 'activate' | 'suspend' | 'close', reason?: string): Observable<Account> {
    return this.http.post<Account>(`${BASE}/accounts/${id}/${action}`, action === 'suspend' ? { reason } : {});
  }

  // transactions
  transactions(query: TransactionQuery): Observable<PageResponse<Transaction>> {
    return this.http.get<PageResponse<Transaction>>(`${BASE}/transactions`, { params: toParams(query) });
  }
  transaction(id: string): Observable<Transaction> {
    return this.http.get<Transaction>(`${BASE}/transactions/${id}`);
  }
  attempts(id: string): Observable<Attempt[]> {
    return this.http.get<Attempt[]>(`${BASE}/transactions/${id}/attempts`);
  }
  transactionAudit(id: string): Observable<AuditRow[]> {
    return this.http.get<AuditRow[]>(`${BASE}/transactions/${id}/audit`);
  }

  /** Full response is returned so callers can see 202 vs replay header; 422 arrives as an ApiProblem error. */
  submit(body: SubmitTransactionRequest, idempotencyKey: string): Observable<HttpResponse<Transaction>> {
    return this.http.post<Transaction>(`${BASE}/transactions`, body, {
      headers: { 'Idempotency-Key': idempotencyKey },
      observe: 'response',
    });
  }
  cancel(id: string): Observable<Transaction> {
    return this.http.post<Transaction>(`${BASE}/transactions/${id}/cancel`, {});
  }
  approve(id: string): Observable<Transaction> {
    return this.http.post<Transaction>(`${BASE}/transactions/${id}/approve`, {});
  }
  reject(id: string, reason: string): Observable<Transaction> {
    return this.http.post<Transaction>(`${BASE}/transactions/${id}/reject`, { reason });
  }
}
