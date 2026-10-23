import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi, useAuth } from '../core/auth';
import { Attempt, AuditRow, Transaction, isApiProblem } from '../core/models';
import { useAsync, useTitle } from '../core/useAsync';
import { formatDate, formatMoney } from '../shared/format';
import { Field, StateView, StatusChip } from '../shared/components';

const CANCELLABLE = ['RECEIVED', 'VALIDATED', 'PENDING_REVIEW'];

const short = (id: string) => id.slice(0, 8) + '…';

export function TransactionDetail() {
  useTitle('Transaction');
  const { id = '' } = useParams();
  const api = useApi();
  const auth = useAuth();

  const [override, setOverride] = useState<Transaction | null>(null);
  const [acting, setActing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const staff = auth.isStaff;
  const loaded = useAsync<{ tx: Transaction; attempts: Attempt[]; audit: AuditRow[] }>(
    async () => {
      const [tx, attempts, audit] = await Promise.all([
        api.transaction(id),
        staff ? api.attempts(id).catch(() => [] as Attempt[]) : Promise.resolve([] as Attempt[]),
        staff ? api.transactionAudit(id).catch(() => [] as AuditRow[]) : Promise.resolve([] as AuditRow[]),
      ]);
      setOverride(null);
      return { tx, attempts, audit };
    },
    [api, id, staff],
    'The transaction could not be loaded.',
  );

  const t = override ?? loaded.data?.tx ?? null;
  const attempts = loaded.data?.attempts ?? [];
  const audit = loaded.data?.audit ?? [];
  const username = auth.user?.username;
  const canCancel = !!t && CANCELLABLE.includes(t.status) && (auth.isOperator || (auth.isCustomer && username === t.submittedBy));
  const canReview = !!t && t.status === 'PENDING_REVIEW' && auth.isOperator && username !== t.submittedBy;
  const state = t ? 'ready' : loaded.loading ? 'loading' : 'error';
  const error = loaded.errorStatus === 404 ? 'This transaction does not exist or you cannot access it.' : loaded.error;

  async function run(call: () => Promise<Transaction>, done: string) {
    setActing(true);
    setMessage('');
    try {
      const updated = await call();
      setRejecting(false);
      setOverride(updated);
      setIsError(false);
      setMessage(done);
      loaded.reload();
    } catch (e) {
      setIsError(true);
      setMessage(isApiProblem(e) ? `${e.message} (${e.code})` : 'The action failed.');
    } finally {
      setActing(false);
    }
  }

  function confirmReject(e: FormEvent) {
    e.preventDefault();
    setReasonTouched(true);
    if (reason.trim()) {
      void run(() => api.reject(id, reason.trim()), 'Transaction rejected.');
    }
  }

  return (
    <section className="page">
      <p><Link to="/transactions">&larr; All transactions</Link></p>
      <StateView state={state} message={error} onRetry={loaded.reload}>
        {t && (
          <>
            <div className="head">
              <h1 className="with-chip"><span className="mono">{t.reference}</span> <StatusChip status={t.status} /></h1>
              <div className="row-actions">
                {canCancel && <button type="button" className="btn stroked" disabled={acting} onClick={() => void run(() => api.cancel(id), 'Transaction cancelled.')}>Cancel transaction</button>}
                {canReview && (
                  <>
                    <button type="button" className="btn flat" disabled={acting} onClick={() => void run(() => api.approve(id), 'Approved - the transaction will now be processed.')}>Approve</button>
                    <button type="button" className="btn stroked" aria-expanded={rejecting} onClick={() => setRejecting((r) => !r)}>Reject…</button>
                  </>
                )}
                {t.status === 'RECONCILIATION_REQUIRED' && auth.isStaff && <Link className="btn stroked" to="/investigations?tab=reconciliation">Open reconciliation</Link>}
              </div>
            </div>

            {message && <p className={`notice${isError ? ' err' : ' info'}`} role={isError ? 'alert' : 'status'}>{message}</p>}
            {t.status === 'PENDING_REVIEW' && auth.isOperator && !canReview && (
              <p className="notice info">You submitted this transaction, so a different operator must review it (maker-checker).</p>
            )}
            {rejecting && (
              <form className="card inline" onSubmit={confirmReject} noValidate>
                <Field id="reject-reason" label="Reason for rejection" error={reasonTouched && !reason.trim() ? 'A reason is required' : ''}>
                  <input id="reject-reason" name="reason" maxLength={255} required value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <button type="submit" className="btn flat" disabled={acting}>Confirm rejection</button>
              </form>
            )}

            <div className="grid cols-2">
              <section className="card" aria-labelledby="d-details">
                <h2 id="d-details">Details</h2>
                <dl className="facts">
                  <dt>Type</dt><dd>{t.type}</dd>
                  <dt>Amount</dt><dd><strong>{formatMoney(t.amount, t.currency)}</strong></dd>
                  {t.sourceAccountId && <><dt>From</dt><dd><Link to={`/accounts/${t.sourceAccountId}`} className="mono">{short(t.sourceAccountId)}</Link></dd></>}
                  {t.targetAccountId && <><dt>To</dt><dd><Link to={`/accounts/${t.targetAccountId}`} className="mono">{short(t.targetAccountId)}</Link></dd></>}
                  {t.memo && <><dt>Memo</dt><dd>{t.memo}</dd></>}
                  <dt>Submitted by</dt><dd>{t.submittedBy}</dd>
                  {t.reviewedBy && <><dt>Reviewed by</dt><dd>{t.reviewedBy}</dd></>}
                  <dt>Created</dt><dd>{formatDate(t.createdAt)}</dd>
                  {t.completedAt && <><dt>Finished</dt><dd>{formatDate(t.completedAt)}</dd></>}
                </dl>
                {t.failureCode && (
                  <div className="failure" role="note">
                    <strong className="mono">{t.failureCode}</strong>
                    {t.failureDetail && <span>{t.failureDetail}</span>}
                  </div>
                )}
              </section>

              {auth.isStaff && (
                <section className="card" aria-labelledby="d-attempts">
                  <h2 id="d-attempts">Processing attempts</h2>
                  {attempts.length === 0 ? <p className="muted">No processing attempts recorded.</p> : (
                    <table className="plain">
                      <caption className="sr-only">Processing attempts</caption>
                      <thead><tr><th scope="col">#</th><th scope="col">Stage</th><th scope="col">Outcome</th><th scope="col">Detail</th></tr></thead>
                      <tbody>
                        {attempts.map((a) => (
                          <tr key={a.attemptNo}><td>{a.attemptNo}</td><td>{a.stage}</td><td><StatusChip status={a.outcome} /></td><td className="muted">{a.detail}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              )}
            </div>

            {auth.isStaff && (
              <section className="card timeline" aria-labelledby="d-audit">
                <h2 id="d-audit">Audit trail</h2>
                {audit.length === 0 ? <p className="muted">No audit events.</p> : (
                  <ol>
                    {audit.map((e) => (
                      <li key={e.id}>
                        <time dateTime={e.occurredAt}>{formatDate(e.occurredAt, 'time-ms')}</time>{' '}
                        <span className="mono">{e.action}</span> <span className="muted">by {e.actor}</span>
                        {e.details && <span className="muted"> — {e.details}</span>}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}
          </>
        )}
      </StateView>
    </section>
  );
}
