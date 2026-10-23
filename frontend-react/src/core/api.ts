import { Http, Query } from './http';
import {
  Account, AccountStatus, AccountType, Attempt, AuditRow, Balance, Customer, PageResponse, PlatformHealth,
  Reconciliation, SubmitTransactionRequest, Summary, Transaction, TransactionStatus, TransactionType,
} from './models';

const BASE = '/api/v1';

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

export interface AccountQuery extends Query {
  customerId?: string;
  status?: AccountStatus | '';
  type?: AccountType | '';
  q?: string;
  page?: number;
  size?: number;
  sort?: string;
}

export interface SubmitResult {
  transaction: Transaction;
  status: number;
  replayed: boolean;
}

/** Typed facade over the REST API (same endpoints as the Angular ApiService). No business rules here - the server owns them. */
export function createApi(http: Http) {
  const get = async <T>(url: string, query?: Query) => (await http.get<T>(url, query)).data;
  const post = async <T>(url: string, body?: unknown) => (await http.post<T>(url, body)).data;

  return {
    // dashboard / ops
    summary: () => get<Summary>(`${BASE}/ops/summary`),
    health: () => get<PlatformHealth>(`${BASE}/ops/health`),
    auditEvents: (query: Query) => get<PageResponse<AuditRow>>(`${BASE}/ops/audit-events`, query),
    reconciliations: (query: Query = {}) => get<PageResponse<Reconciliation>>(`${BASE}/ops/reconciliations`, query),
    resolveReconciliation: (id: string, resolution: 'CONFIRMED_EXECUTED' | 'CONFIRMED_NOT_EXECUTED', note: string) =>
      post<Reconciliation>(`${BASE}/ops/reconciliations/${id}/resolve`, { resolution, note }),

    // customers
    customers: (query: Query) => get<PageResponse<Customer>>(`${BASE}/customers`, query),
    createCustomer: (body: { legalName: string; email: string; phone?: string }) => post<Customer>(`${BASE}/customers`, body),

    // accounts
    accounts: (query: AccountQuery) => get<PageResponse<Account>>(`${BASE}/accounts`, query),
    account: (id: string) => get<Account>(`${BASE}/accounts/${id}`),
    balance: (id: string) => get<Balance>(`${BASE}/accounts/${id}/balance`),
    accountTransactions: (id: string, query: Query) => get<PageResponse<Transaction>>(`${BASE}/accounts/${id}/transactions`, query),
    accountAction: (id: string, action: 'activate' | 'suspend' | 'close', reason?: string) =>
      post<Account>(`${BASE}/accounts/${id}/${action}`, action === 'suspend' ? { reason } : {}),

    // transactions
    transactions: (query: TransactionQuery) => get<PageResponse<Transaction>>(`${BASE}/transactions`, query),
    transaction: (id: string) => get<Transaction>(`${BASE}/transactions/${id}`),
    attempts: (id: string) => get<Attempt[]>(`${BASE}/transactions/${id}/attempts`),
    transactionAudit: (id: string) => get<AuditRow[]>(`${BASE}/transactions/${id}/audit`),
    /** Returns 202 vs replay header too; a 422 business rejection arrives as an ApiProblem error. */
    submit: async (body: SubmitTransactionRequest, idempotencyKey: string): Promise<SubmitResult> => {
      const r = await http.post<Transaction>(`${BASE}/transactions`, body, { 'Idempotency-Key': idempotencyKey });
      return { transaction: r.data, status: r.status, replayed: r.headers.get('Idempotent-Replayed') === 'true' };
    },
    cancel: (id: string) => post<Transaction>(`${BASE}/transactions/${id}/cancel`, {}),
    approve: (id: string) => post<Transaction>(`${BASE}/transactions/${id}/approve`, {}),
    reject: (id: string, reason: string) => post<Transaction>(`${BASE}/transactions/${id}/reject`, { reason }),
  };
}

export type Api = ReturnType<typeof createApi>;
