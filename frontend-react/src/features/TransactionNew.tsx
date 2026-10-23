import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../core/auth';
import { IdempotencyKeys } from '../core/idempotency';
import { Account, ApiProblem, SubmitTransactionRequest, Transaction, TransactionType, isApiProblem } from '../core/models';
import { useTitle } from '../core/useAsync';
import { formatMoney } from '../shared/format';
import { Field, StatusChip } from '../shared/components';

export const AMOUNT_PATTERN = /^\d{1,15}(\.\d{1,2})?$/;
const MEMO_PATTERN = /^[\p{L}\p{N} .,:;'()/#_-]*$/u;

export interface ShapeInput {
  type: TransactionType;
  sourceAccountId: string;
  targetAccountId: string;
}

/** Cross-field rules mirroring the server's structural validation (the server remains the authority). */
export function transactionShapeErrors({ type, sourceAccountId: source, targetAccountId: target }: ShapeInput): Record<string, true> | null {
  const errors: Record<string, true> = {};
  if (type === 'DEPOSIT' && !target) {
    errors['targetRequired'] = true;
  }
  if (type === 'WITHDRAWAL' && !source) {
    errors['sourceRequired'] = true;
  }
  if (type === 'TRANSFER') {
    if (!source || !target) {
      errors['bothRequired'] = true;
    } else if (source === target) {
      errors['sameAccount'] = true;
    }
  }
  return Object.keys(errors).length ? errors : null;
}

export function amountErrorFor(amount: string): string {
  if (amount === '') {
    return 'Amount is required';
  }
  if (!AMOUNT_PATTERN.test(amount)) {
    return 'Enter a positive amount with at most 2 decimals';
  }
  return Number(amount) === 0 ? 'Amount must be greater than zero' : '';
}

const SHAPE_MESSAGES: Record<string, string> = {
  targetRequired: 'Choose the account to deposit into.',
  sourceRequired: 'Choose the account to withdraw from.',
  bothRequired: 'Choose both the source and the target account.',
  sameAccount: 'The source and target accounts must be different.',
};

type Outcome =
  | { kind: 'none' }
  | { kind: 'accepted'; tx?: Transaction; replayed: boolean }
  | { kind: 'rejected'; problem: ApiProblem }
  | { kind: 'error'; problem: ApiProblem };

export function TransactionNew() {
  useTitle('New transaction');
  const api = useApi();
  const [params] = useSearchParams();
  const keys = useRef(new IdempotencyKeys());
  const inFlight = useRef(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [type, setType] = useState<TransactionType>('DEPOSIT');
  const [sourceAccountId, setSource] = useState('');
  const [targetAccountId, setTarget] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'none' });

  useEffect(() => {
    let cancelled = false;
    api.accounts({ size: 100, sort: 'openedAt,asc' }).then(
      (r) => {
        if (cancelled) {
          return;
        }
        setAccounts(r.items);
        const preset = params.get('account'); // set by the "New transaction" button on an account page
        if (preset && r.items.some((a) => a.id === preset)) {
          setTarget(preset);
          setSource(preset);
        }
      },
      () => {
        if (!cancelled) {
          setOutcome({ kind: 'error', problem: { status: 0, code: 'ACCOUNTS_UNAVAILABLE', message: 'Your accounts could not be loaded, so a transaction cannot be created right now.', violations: [], details: {} } });
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // the preset is read once, when the accounts arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const usable = accounts.filter((a) => a.status === 'ACTIVE');
  const currencyAccountId = type === 'DEPOSIT' ? targetAccountId : sourceAccountId;
  const currency = accounts.find((a) => a.id === currencyAccountId)?.currency ?? '';

  const shape = transactionShapeErrors({ type, sourceAccountId, targetAccountId });
  const shapeMessage = touched && shape ? (SHAPE_MESSAGES[Object.keys(shape)[0]] ?? '') : '';
  const amountError = touched ? amountErrorFor(amount) : '';
  const memoError = memo.length > 140 || !MEMO_PATTERN.test(memo) ? 'Letters, digits and basic punctuation only' : '';

  function changeType(next: TransactionType) {
    setType(next);
    if (next === 'DEPOSIT') {
      setSource('');
    } else if (next === 'WITHDRAWAL') {
      setTarget('');
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (shape || amountErrorFor(amount) || memoError || busy || inFlight.current) {
      return;
    }
    const body: SubmitTransactionRequest = {
      type,
      sourceAccountId: type === 'DEPOSIT' ? undefined : sourceAccountId,
      targetAccountId: type === 'WITHDRAWAL' ? undefined : targetAccountId,
      amount,
      currency,
      memo: memo.trim() || undefined,
    };
    const key = keys.current.keyFor(body);
    inFlight.current = true;
    setBusy(true);
    setOutcome({ kind: 'none' });
    try {
      const res = await api.submit(body, key);
      keys.current.reset();
      setOutcome({ kind: 'accepted', tx: res.transaction, replayed: res.replayed });
      setAmount('');
      setMemo('');
      setTouched(false);
    } catch (err) {
      const problem: ApiProblem = isApiProblem(err) ? err : { status: -1, code: 'UNEXPECTED', message: 'Unexpected error', violations: [], details: {} };
      if (problem.status === 422 && problem.code === 'TRANSACTION_REJECTED') {
        keys.current.reset(); // definitive outcome: a corrected request is a new logical request
        setOutcome({ kind: 'rejected', problem });
      } else {
        // network/5xx/409: outcome unknown or retryable - keep the key so a retry is idempotent
        setOutcome({ kind: 'error', problem });
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const rejection = outcome.kind === 'rejected' ? outcome.problem.details : {};
  const rejectedId = typeof rejection['transactionId'] === 'string' ? rejection['transactionId'] : '';

  return (
    <section className="page">
      <h1>New transaction</h1>
      <p className="subtitle">Deposits, withdrawals and transfers between accounts. Synthetic money only.</p>

      <div className="layout">
        <form className="card stack" onSubmit={submit} noValidate aria-labelledby="form-title">
          <h2 id="form-title" className="sr-only">Transaction details</h2>

          <Field id="type" label="Type">
            <select id="type" name="type" value={type} onChange={(e) => changeType(e.target.value as TransactionType)}>
              <option value="DEPOSIT">Deposit</option>
              <option value="WITHDRAWAL">Withdrawal</option>
              <option value="TRANSFER">Transfer between accounts</option>
            </select>
          </Field>

          {type !== 'DEPOSIT' && (
            <Field id="sourceAccountId" label="From account">
              <select id="sourceAccountId" name="sourceAccountId" required value={sourceAccountId} onChange={(e) => setSource(e.target.value)}>
                <option value="">Select an account</option>
                {usable.map((a) => <option key={a.id} value={a.id}>{a.accountNumber} · {a.currency} · {formatMoney(a.availableBalance, a.currency)} available</option>)}
              </select>
            </Field>
          )}
          {type !== 'WITHDRAWAL' && (
            <Field id="targetAccountId" label="To account">
              <select id="targetAccountId" name="targetAccountId" required value={targetAccountId} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Select an account</option>
                {usable.map((a) => <option key={a.id} value={a.id}>{a.accountNumber} · {a.currency}</option>)}
              </select>
            </Field>
          )}

          <Field id="amount" label={`Amount (${currency || 'currency'})`} error={amountError} hint="Up to 2 decimal places, e.g. 125.50">
            <input id="amount" name="amount" inputMode="decimal" autoComplete="off" required value={amount} aria-invalid={!!amountError}
                   aria-describedby={amountError ? 'amount-error' : 'amount-hint'} onChange={(e) => setAmount(e.target.value)} />
          </Field>

          <Field id="memo" label="Memo (optional)" error={memoError}>
            <input id="memo" name="memo" maxLength={140} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </Field>

          {shapeMessage && <p className="error-text" role="alert">{shapeMessage}</p>}

          <button type="submit" className="btn flat" disabled={busy}>{busy ? 'Submitting…' : 'Submit transaction'}</button>
          <p className="muted small">Retrying after an error is safe: the same request reuses one idempotency key, so it can never be applied twice.</p>
        </form>

        <div aria-live="polite" className="result">
          {outcome.kind === 'accepted' && (
            <div className="card ok" role="status">
              <h2 className="result-title">Accepted</h2>
              {outcome.tx && (
                <>
                  <p><Link to={`/transactions/${outcome.tx.id}`} className="mono">{outcome.tx.reference}</Link> <StatusChip status={outcome.tx.status} /></p>
                  <p>{formatMoney(outcome.tx.amount, outcome.tx.currency)} · {outcome.tx.type}</p>
                  {outcome.tx.status === 'PENDING_REVIEW'
                    ? <p>This amount needs approval by a second operator before it is processed.</p>
                    : <p className="muted">Processing is asynchronous: open the transaction to follow its status.</p>}
                </>
              )}
              {outcome.replayed && <p className="muted">This was a repeat of an earlier identical submission - no second transaction was created.</p>}
            </div>
          )}
          {outcome.kind === 'rejected' && (
            <div className="card bad" role="alert">
              <h2 className="result-title">Rejected by business rules</h2>
              <p className="mono">{String(rejection['failureCode'] ?? '')}</p>
              <p>{String(rejection['failureDetail'] ?? '')}</p>
              {rejectedId && <p><Link to={`/transactions/${rejectedId}`}>View the recorded transaction</Link></p>}
            </div>
          )}
          {outcome.kind === 'error' && (
            <div className="card bad" role="alert">
              <h2 className="result-title">Could not submit</h2>
              <p>{outcome.problem.message}</p>
              {outcome.problem.violations.map((v) => <p key={v.field} className="small">{v.field}: {v.message}</p>)}
              {outcome.problem.correlationId && <p className="muted small">Reference for support: <span className="mono">{outcome.problem.correlationId}</span></p>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
