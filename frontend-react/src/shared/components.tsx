import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Transaction } from '../core/models';
import { formatDate, formatMoney, humanize } from './format';

type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'muted';

const TONES: Record<string, Tone> = {
  COMPLETED: 'ok', ACTIVE: 'ok', UP: 'ok', RESOLVED: 'ok', DISPATCHED: 'ok',
  FAILED: 'bad', REJECTED: 'bad', DOWN: 'bad', DEAD: 'bad', SUSPENDED: 'bad',
  PENDING_REVIEW: 'warn', RECONCILIATION_REQUIRED: 'warn', DEGRADED: 'warn', ATTENTION: 'warn', OPEN: 'warn',
  PENDING_ACTIVATION: 'warn',
  PROCESSING: 'info', VALIDATED: 'info', RECEIVED: 'info', NEW: 'info',
  CANCELLED: 'muted', CLOSED: 'muted',
};

/** Status label. Colour is reinforced by the text itself, so meaning never depends on colour alone (WCAG 1.4.1). */
export function StatusChip({ status }: { status: string }) {
  return <span className={`chip ${TONES[status] ?? 'muted'}`}>{humanize(status)}</span>;
}

export function Money({ value, currency }: { value: string | null | undefined; currency?: string | null }) {
  return <>{formatMoney(value, currency)}</>;
}

export type ViewState = 'loading' | 'error' | 'empty' | 'ready';

interface StateViewProps {
  state: ViewState;
  message?: string;
  emptyText?: string;
  loadingText?: string;
  onRetry?: () => void;
  children?: ReactNode;
}

/** One consistent place for loading / error (with retry) / empty / content states. Announces changes to screen readers. */
export function StateView({ state, message, emptyText = 'Nothing to show yet.', loadingText = 'Loading…', onRetry, children }: StateViewProps) {
  switch (state) {
    case 'loading':
      return (
        <div className="state-box" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span>{loadingText}</span>
        </div>
      );
    case 'error':
      return (
        <div className="state-box error" role="alert">
          <span>{message || 'Something went wrong.'}</span>
          <button type="button" className="btn stroked" onClick={onRetry}>Retry</button>
        </div>
      );
    case 'empty':
      return <div className="state-box muted" role="status">{emptyText}</div>;
    default:
      return <>{children}</>;
  }
}

/** Derives the usual four view states from a loader's flags. */
export function viewStateOf(loading: boolean, error: string, isEmpty: boolean): ViewState {
  return loading ? 'loading' : error ? 'error' : isEmpty ? 'empty' : 'ready';
}

export interface SortState {
  active: string;
  direction: 'asc' | 'desc' | '';
}

export function sortExpression(sort: SortState, fallback: string): string {
  return sort.direction ? `${sort.active},${sort.direction}` : fallback;
}

/** Sortable column header: asc -> desc -> unsorted, like the Angular Material sort header. */
export function SortHeader({ id, label, sort, onSort, className }: { id: string; label: string; sort: SortState; onSort: (s: SortState) => void; className?: string }) {
  const current = sort.active === id ? sort.direction : '';
  const next: SortState['direction'] = current === '' ? 'asc' : current === 'asc' ? 'desc' : '';
  return (
    <th scope="col" className={className} aria-sort={current === 'asc' ? 'ascending' : current === 'desc' ? 'descending' : 'none'}>
      <button type="button" className="sort-btn" onClick={() => onSort({ active: id, direction: next })}>
        {label}
        <span aria-hidden="true" className="sort-arrow">{current === 'asc' ? ' ▲' : current === 'desc' ? ' ▼' : ''}</span>
      </button>
    </th>
  );
}

interface PagerProps {
  page: number;
  size: number;
  total: number;
  sizes?: number[];
  label: string;
  onChange: (page: number, size: number) => void;
}

/** Server-side pager (zero-based page index, like the API). */
export function Pager({ page, size, total, sizes = [10, 20, 50], label, onChange }: PagerProps) {
  const from = total === 0 ? 0 : page * size + 1;
  const to = Math.min(total, (page + 1) * size);
  const last = Math.max(0, Math.ceil(total / size) - 1);
  return (
    <nav className="pager" aria-label={label}>
      <label>
        Rows per page{' '}
        <select value={size} onChange={(e) => onChange(0, Number(e.target.value))} aria-label={`${label}: rows per page`}>
          {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <span aria-live="polite">{from}–{to} of {total}</span>
      <button type="button" className="btn text" disabled={page <= 0} onClick={() => onChange(page - 1, size)} aria-label="Previous page">‹ Prev</button>
      <button type="button" className="btn text" disabled={page >= last} onClick={() => onChange(page + 1, size)} aria-label="Next page">Next ›</button>
    </nav>
  );
}

interface TransactionTableProps {
  rows: Transaction[];
  caption?: string;
  showSubmitter?: boolean;
  sort?: SortState;
  onSort?: (s: SortState) => void;
}

export function TransactionTable({ rows, caption = 'Transactions', showSubmitter = false, sort, onSort }: TransactionTableProps) {
  const sortable = !!sort && !!onSort;
  const header = (id: string, label: string, className?: string) =>
    sortable ? <SortHeader id={id} label={label} sort={sort} onSort={onSort} className={className} /> : <th scope="col" className={className}>{label}</th>;
  return (
    <div className="table-wrap">
      <table className="data" aria-label={caption}>
        <thead>
          <tr>
            {header('reference', 'Reference')}
            <th scope="col">Type</th>
            {header('amount', 'Amount', 'amount')}
            {header('status', 'Status')}
            <th scope="col">Reason</th>
            {showSubmitter && <th scope="col">Submitted by</th>}
            {header('createdAt', 'Created')}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td><Link className="mono" to={`/transactions/${t.id}`}>{t.reference}</Link></td>
              <td>{t.type}</td>
              <td className="amount">{formatMoney(t.amount, t.currency)}</td>
              <td><StatusChip status={t.status} /></td>
              <td><span className="mono">{t.failureCode ?? ''}</span></td>
              {showSubmitter && <td>{t.submittedBy}</td>}
              <td>{formatDate(t.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Labelled text field used by the forms (label, hint and error are linked for assistive technology). */
export function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && <small id={`${id}-hint`} className="hint">{hint}</small>}
      {error && <small id={`${id}-error`} className="field-error" role="alert">{error}</small>}
    </div>
  );
}
