import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../core/auth';
import { ALL_TRANSACTION_STATUSES, TransactionStatus, TransactionType } from '../core/models';
import { useAsync, useTitle } from '../core/useAsync';
import { Field, Pager, SortState, StateView, TransactionTable, sortExpression, viewStateOf } from '../shared/components';

export const FILTER_AMOUNT = /^\d{1,15}(\.\d{1,4})?$/;

interface TxFilters {
  status: TransactionStatus[];
  type: TransactionType | '';
  reference: string;
  from: string;
  to: string;
  minAmount: string;
  maxAmount: string;
}
const NO_FILTERS: TxFilters = { status: [], type: '', reference: '', from: '', to: '', minAmount: '', maxAmount: '' };

const amountError = (v: string) => (v === '' || FILTER_AMOUNT.test(v) ? '' : 'Enter a decimal such as 100.50');

/** Transaction search with status/type/reference/date/amount filters, server-side paging and sorting. */
export function Transactions() {
  useTitle('Transactions');
  const api = useApi();
  const [params] = useSearchParams();
  const initialStatus = params.get('status'); // dashboard links: ?status=COMPLETED
  const initial: TxFilters = {
    ...NO_FILTERS,
    status: initialStatus && (ALL_TRANSACTION_STATUSES as string[]).includes(initialStatus) ? [initialStatus as TransactionStatus] : [],
  };

  const [draft, setDraft] = useState<TxFilters>(initial);
  const [applied, setApplied] = useState<TxFilters>(initial);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [sort, setSort] = useState<SortState>({ active: 'createdAt', direction: 'desc' });
  const sortExpr = sortExpression(sort, 'createdAt,desc');

  const result = useAsync(
    () => api.transactions({
      status: applied.status, type: applied.type, reference: applied.reference.trim(),
      from: applied.from ? `${applied.from}T00:00:00Z` : '', to: applied.to ? `${applied.to}T23:59:59Z` : '',
      minAmount: applied.minAmount, maxAmount: applied.maxAmount,
      page, size, sort: sortExpr,
    }),
    [api, applied, page, size, sortExpr],
    'Transactions could not be loaded.',
  );
  const rows = result.data?.items ?? [];
  const minError = amountError(draft.minAmount);
  const maxError = amountError(draft.maxAmount);

  function search(e?: FormEvent) {
    e?.preventDefault();
    if (amountError(draft.minAmount) || amountError(draft.maxAmount)) {
      return; // invalid input never reaches the server
    }
    setPage(0);
    setApplied(draft);
  }

  function reset() {
    setDraft(NO_FILTERS);
    setPage(0);
    setApplied(NO_FILTERS);
  }

  return (
    <section className="page">
      <div className="head">
        <div><h1>Transactions</h1><p className="subtitle">Search and track transaction requests.</p></div>
        <Link className="btn stroked" to="/transactions/new">New transaction</Link>
      </div>

      <form className="filters" onSubmit={search} role="search" aria-label="Transaction filters" noValidate>
        <Field id="tx-status" label="Status">
          <select id="tx-status" name="status" multiple size={4} value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: Array.from(e.target.selectedOptions, (o) => o.value as TransactionStatus) })}>
            {ALL_TRANSACTION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field id="tx-type" label="Type">
          <select id="tx-type" name="type" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as TransactionType | '' })}>
            <option value="">Any</option>
            <option value="DEPOSIT">DEPOSIT</option>
            <option value="WITHDRAWAL">WITHDRAWAL</option>
            <option value="TRANSFER">TRANSFER</option>
          </select>
        </Field>
        <Field id="tx-reference" label="Reference">
          <input id="tx-reference" name="reference" placeholder="TXN-…" maxLength={30} value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} />
        </Field>
        <Field id="tx-from" label="From (date)">
          <input id="tx-from" name="from" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </Field>
        <Field id="tx-to" label="To (date)">
          <input id="tx-to" name="to" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </Field>
        <Field id="tx-min" label="Min amount" error={minError}>
          <input id="tx-min" name="minAmount" inputMode="decimal" value={draft.minAmount} aria-invalid={!!minError}
                 onChange={(e) => setDraft({ ...draft, minAmount: e.target.value })} />
        </Field>
        <Field id="tx-max" label="Max amount" error={maxError}>
          <input id="tx-max" name="maxAmount" inputMode="decimal" value={draft.maxAmount} aria-invalid={!!maxError}
                 onChange={(e) => setDraft({ ...draft, maxAmount: e.target.value })} />
        </Field>
        <button type="submit" className="btn flat">Search</button>
        <button type="button" className="btn text" onClick={reset}>Clear</button>
      </form>

      <StateView state={viewStateOf(result.loading && !result.data, result.error, rows.length === 0 && !result.loading)} message={result.error}
                 onRetry={result.reload} emptyText="No transactions match these filters.">
        <TransactionTable rows={rows} showSubmitter sort={sort} onSort={setSort} />
        <Pager page={page} size={size} total={result.data?.totalElements ?? 0} label="Transaction pages" onChange={(p, s) => { setPage(p); setSize(s); }} />
      </StateView>
    </section>
  );
}
