import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApi, useAuth } from '../core/auth';
import { Account, AccountStatus, AccountType, Balance, Transaction, isApiProblem } from '../core/models';
import { useAsync, useTitle } from '../core/useAsync';
import { formatDate, formatMoney } from '../shared/format';
import { Field, Pager, SortHeader, SortState, StateView, StatusChip, TransactionTable, sortExpression, viewStateOf } from '../shared/components';

const STATUSES: AccountStatus[] = ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'CLOSED'];
const TYPES: AccountType[] = ['BROKERAGE', 'RETIREMENT', 'MONEY_MARKET'];

interface AccountFilters {
  q: string;
  status: AccountStatus | '';
  type: AccountType | '';
}
const NO_FILTERS: AccountFilters = { q: '', status: '', type: '' };

/** Paginated, filterable, sortable account search (server-side paging; customers only ever receive their own). */
export function Accounts() {
  useTitle('Accounts');
  const api = useApi();
  const [params] = useSearchParams();
  const customerId = params.get('customerId') ?? undefined; // set by the customer directory link

  const [draft, setDraft] = useState<AccountFilters>(NO_FILTERS);
  const [applied, setApplied] = useState<AccountFilters>(NO_FILTERS);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [sort, setSort] = useState<SortState>({ active: 'openedAt', direction: 'desc' });
  const sortExpr = sortExpression(sort, 'openedAt,desc');

  const result = useAsync(
    () => api.accounts({ ...applied, customerId, page, size, sort: sortExpr }),
    [api, applied, customerId, page, size, sortExpr],
    'Accounts could not be loaded.',
  );
  const rows = result.data?.items ?? [];

  function search(e?: FormEvent) {
    e?.preventDefault();
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
      <h1>Accounts</h1>
      <p className="subtitle">Search by account number prefix, status or type.</p>

      <form className="filters" onSubmit={search} role="search" aria-label="Account filters">
        <Field id="q" label="Account number starts with">
          <input id="q" name="q" maxLength={20} value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        </Field>
        <Field id="status" label="Status">
          <select id="status" name="status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as AccountStatus | '' })}>
            <option value="">Any</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field id="type" label="Type">
          <select id="type" name="type" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as AccountType | '' })}>
            <option value="">Any</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <button type="submit" className="btn flat">Search</button>
        <button type="button" className="btn text" onClick={reset}>Clear</button>
      </form>

      <StateView state={viewStateOf(result.loading && !result.data, result.error, rows.length === 0 && !result.loading)} message={result.error}
                 onRetry={result.reload} emptyText="No accounts match these filters.">
        <div className="table-wrap">
          <table className="data" aria-label="Accounts">
            <thead>
              <tr>
                <SortHeader id="accountNumber" label="Account" sort={sort} onSort={setSort} />
                <SortHeader id="accountType" label="Type" sort={sort} onSort={setSort} />
                <SortHeader id="status" label="Status" sort={sort} onSort={setSort} />
                <SortHeader id="balance" label="Balance" sort={sort} onSort={setSort} className="amount" />
                <th scope="col" className="amount">Available</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td><Link className="mono" to={`/accounts/${a.id}`}>{a.accountNumber}</Link></td>
                  <td>{a.accountType}</td>
                  <td><StatusChip status={a.status} /></td>
                  <td className="amount">{formatMoney(a.balance, a.currency)}</td>
                  <td className="amount">{formatMoney(a.availableBalance, a.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} size={size} total={result.data?.totalElements ?? 0} label="Account pages" onChange={(p, s) => { setPage(p); setSize(s); }} />
      </StateView>
    </section>
  );
}

/** Account page: balances, history and (for operators) lifecycle actions. */
export function AccountDetail() {
  useTitle('Account');
  const { id = '' } = useParams();
  const api = useApi();
  const auth = useAuth();

  const [account, setAccount] = useState<Account | null>(null);
  const [suspending, setSuspending] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);

  const head = useAsync<{ account: Account; balance: Balance }>(
    async () => {
      const [a, balance] = await Promise.all([api.account(id), api.balance(id)]);
      return { account: a, balance };
    },
    [api, id],
    'The account could not be loaded.',
  );
  // an action result replaces the loaded account until the next (re)load
  useEffect(() => setAccount(null), [head.data]);
  const [historyPage, setHistoryPage] = useState(0);
  const [historySize, setHistorySize] = useState(10);
  const history = useAsync(
    () => api.accountTransactions(id, { page: historyPage, size: historySize, sort: 'createdAt,desc' }),
    [api, id, historyPage, historySize],
    'History could not be loaded.',
  );

  const canTransact = auth.hasAny('CUSTOMER', 'OPERATIONS_ANALYST', 'ADMIN');
  const a = account ?? head.data?.account ?? null;
  const balance = head.data?.balance;
  const headState = a ? 'ready' : head.loading ? 'loading' : 'error';
  const headError = head.errorStatus === 404 ? 'This account does not exist or you cannot access it.' : head.error;
  const txs: Transaction[] = history.data?.items ?? [];

  async function act(action: 'activate' | 'suspend' | 'close', why?: string) {
    setActing(true);
    setMessage('');
    try {
      const updated = await api.accountAction(id, action, why);
      setAccount(updated);
      setSuspending(false);
      setReason('');
      setReasonTouched(false);
      setMessageIsError(false);
      setMessage(`Account is now ${updated.status.replace(/_/g, ' ').toLowerCase()}.`);
    } catch (e) {
      setMessageIsError(true);
      setMessage(isApiProblem(e) ? `${e.message}${e.code ? ' (' + e.code + ')' : ''}` : 'The action failed.');
    } finally {
      setActing(false);
    }
  }

  function confirmSuspend(e: FormEvent) {
    e.preventDefault();
    setReasonTouched(true);
    if (reason.trim()) {
      void act('suspend', reason.trim());
    }
  }

  return (
    <section className="page">
      <p><Link to="/accounts">&larr; All accounts</Link></p>
      <StateView state={headState} message={headError} onRetry={head.reload}>
        {a && (
          <>
            <div className="head">
              <div>
                <h1 className="with-chip"><span className="mono">{a.accountNumber}</span> <StatusChip status={a.status} /></h1>
                <p className="subtitle">
                  {a.accountType} · {a.currency} · opened {formatDate(a.openedAt, 'date')}
                  {a.statusReason && <> · <em>{a.statusReason}</em></>}
                </p>
              </div>
              <div className="row-actions">
                {a.status === 'ACTIVE' && canTransact && <Link className="btn flat" to={`/transactions/new?account=${a.id}`}>New transaction</Link>}
                {auth.isOperator && (a.status === 'PENDING_ACTIVATION' || a.status === 'SUSPENDED') && (
                  <button type="button" className="btn stroked" disabled={acting} onClick={() => void act('activate')}>
                    {a.status === 'SUSPENDED' ? 'Reactivate' : 'Activate'}
                  </button>
                )}
                {auth.isOperator && a.status === 'ACTIVE' && (
                  <button type="button" className="btn stroked" aria-expanded={suspending} onClick={() => setSuspending((s) => !s)}>Suspend…</button>
                )}
                {auth.isOperator && auth.isAdmin && a.status !== 'CLOSED' && (
                  <button type="button" className="btn stroked" disabled={acting} onClick={() => void act('close')}>Close</button>
                )}
              </div>
            </div>

            {message && <p className={`notice${messageIsError ? ' err' : ''}`} role={messageIsError ? 'alert' : 'status'}>{message}</p>}

            {suspending && (
              <form className="card inline" onSubmit={confirmSuspend} noValidate>
                <Field id="reason" label="Reason for suspension" error={reasonTouched && !reason.trim() ? 'A reason is required' : ''}>
                  <input id="reason" name="reason" maxLength={255} required value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <button type="submit" className="btn flat" disabled={acting}>Confirm suspension</button>
              </form>
            )}

            <div className="grid cols-4">
              <div className="card stat"><span className="label">Ledger balance</span><strong>{formatMoney(balance?.ledgerBalance ?? a.balance, a.currency)}</strong></div>
              <div className="card stat">
                <span className="label">Available</span><strong>{formatMoney(balance?.availableBalance ?? a.availableBalance, a.currency)}</strong>
                <span className="muted">after minimum balance {formatMoney(a.minimumBalance, a.currency)}</span>
              </div>
              <div className="card stat"><span className="label">Daily withdrawal limit</span><strong>{formatMoney(a.dailyWithdrawalLimit, a.currency)}</strong></div>
            </div>

            <h2 className="section">Transaction history</h2>
            <StateView state={viewStateOf(history.loading && !history.data, history.error, txs.length === 0 && !history.loading)} message={history.error}
                       onRetry={history.reload} emptyText="No transactions on this account yet.">
              <TransactionTable rows={txs} caption="Account transactions" />
              <Pager page={historyPage} size={historySize} total={history.data?.totalElements ?? 0} label="History pages"
                     onChange={(p, s) => { setHistoryPage(p); setHistorySize(s); }} />
            </StateView>
          </>
        )}
      </StateView>
    </section>
  );
}
