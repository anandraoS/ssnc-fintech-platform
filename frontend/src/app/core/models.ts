// API contract types (mirror specs/openapi.json). Money amounts are STRINGS end to end: the backend serializes them as
// JSON strings and the UI never does arithmetic on them (display formatting only), so no IEEE-754 rounding can creep in.

export type Role = 'CUSTOMER' | 'SUPPORT_AGENT' | 'OPERATIONS_ANALYST' | 'ADMIN';
export type TransactionType = 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER';
export type TransactionStatus =
  | 'RECEIVED'
  | 'VALIDATED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'FAILED'
  | 'PENDING_REVIEW'
  | 'RECONCILIATION_REQUIRED'
  | 'CANCELLED';
export type AccountStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type AccountType = 'BROKERAGE' | 'RETIREMENT' | 'MONEY_MARKET';

export const ALL_TRANSACTION_STATUSES: TransactionStatus[] = [
  'RECEIVED', 'VALIDATED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED', 'PENDING_REVIEW',
  'RECONCILIATION_REQUIRED', 'CANCELLED',
];

export interface PageResponse<T> {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
  username: string;
  roles: Role[];
  customerId: string | null;
}

export interface Customer {
  id: string;
  customerRef: string;
  legalName: string;
  email: string;
  phone?: string;
  taxIdLast4?: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Account {
  id: string;
  accountNumber: string;
  customerId: string;
  accountType: AccountType;
  status: AccountStatus;
  statusReason?: string;
  currency: string;
  balance: string;
  availableBalance: string;
  minimumBalance: string;
  dailyWithdrawalLimit: string;
  version: number;
  openedAt: string;
  updatedAt: string;
}

export interface Balance {
  accountId: string;
  currency: string;
  ledgerBalance: string;
  minimumBalance: string;
  availableBalance: string;
  asOf: string;
}

export interface Transaction {
  id: string;
  reference: string;
  type: TransactionType;
  status: TransactionStatus;
  sourceAccountId?: string;
  targetAccountId?: string;
  amount: string;
  currency: string;
  memo?: string;
  submittedBy: string;
  reviewedBy?: string;
  failureCode?: string;
  failureDetail?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface SubmitTransactionRequest {
  type: TransactionType;
  sourceAccountId?: string;
  targetAccountId?: string;
  amount: string;
  currency: string;
  memo?: string;
}

export interface Attempt {
  attemptNo: number;
  stage: string;
  outcome: string;
  detail?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface AuditRow {
  id: number;
  occurredAt: string;
  actor: string;
  actorRoles?: string;
  action: string;
  entityType: string;
  entityId: string;
  correlationId?: string;
  details?: string;
}

export interface Reconciliation {
  id: string;
  transactionId: string;
  status: 'OPEN' | 'RESOLVED';
  reasonCode: string;
  detail?: string;
  openedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolution?: string;
  resolutionNote?: string;
}

export interface Summary {
  generatedAt: string;
  transactionsByStatus: Record<string, number>;
  completedVolumeLast24h: { type: string; currency: string; count: number; volume: string }[];
  completedLast24h: number;
  failedLast24h: number;
  pendingReview: number;
  reconciliationRequired: number;
  openReconciliationRecords: number;
  transactionFailureRateLast24h: number;
  processingLatency: { sampleSize: number; averageMs: number; p50Ms: number; p95Ms: number; p99Ms: number };
  http: { totalRequests: number; serverErrors: number; errorRate: number };
  accountsByStatus: Record<string, number>;
  totalBalances: { currency: string; total: string }[];
}

export interface PlatformHealth {
  status: 'UP' | 'DEGRADED' | 'DOWN';
  checkedAt: string;
  components: { name: string; status: string; detail: string }[];
}

/** Normalised error handed to components by the error interceptor. */
export interface ApiProblem {
  status: number;
  code: string;
  message: string;
  violations: { field: string; message: string }[];
  details: Record<string, unknown>;
  correlationId?: string;
}

export function isApiProblem(e: unknown): e is ApiProblem {
  return typeof e === 'object' && e !== null && 'code' in e && 'status' in e && 'message' in e;
}
