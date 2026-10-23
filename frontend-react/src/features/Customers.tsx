import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, useAuth } from '../core/auth';
import { isApiProblem } from '../core/models';
import { useAsync, useTitle } from '../core/useAsync';
import { formatDate } from '../shared/format';
import { Field, Pager, StateView, StatusChip, viewStateOf } from '../shared/components';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+0-9() -]*$/;

/** Customer directory (staff). Support agents see masked contact details; operators can create customers. */
export function Customers() {
  useTitle('Customers');
  const api = useApi();
  const auth = useAuth();

  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const result = useAsync(() => api.customers({ q: appliedQ, page, size }), [api, appliedQ, page, size], 'Customers could not be loaded.');
  const rows = result.data?.items ?? [];

  const [legalName, setLegalName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [createTouched, setCreateTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState('');
  const [createFailed, setCreateFailed] = useState(false);

  const nameError = createTouched && !legalName.trim() ? 'Name is required' : '';
  const emailError = createTouched && !EMAIL.test(email) ? 'A valid e-mail is required' : '';
  const phoneError = !PHONE.test(phone) ? 'Digits, spaces and + ( ) - only' : '';

  function doSearch(e: FormEvent) {
    e.preventDefault();
    setPage(0);
    setAppliedQ(q);
  }

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    setCreateTouched(true);
    if (!legalName.trim() || !EMAIL.test(email) || phoneError || creating) {
      return;
    }
    setCreating(true);
    try {
      const c = await api.createCustomer({ legalName: legalName.trim(), email, phone: phone || undefined });
      setCreateFailed(false);
      setCreateMessage(`Created ${c.customerRef}.`);
      setLegalName('');
      setEmail('');
      setPhone('');
      setCreateTouched(false);
      result.reload();
    } catch (err) {
      setCreateFailed(true);
      setCreateMessage(isApiProblem(err) ? (err.violations[0]?.message ?? err.message) : 'Customer could not be created.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="page">
      <h1>Customers</h1>
      <p className="subtitle">Synthetic customer profiles. {!auth.isOperator && 'Contact details are masked for your role.'}</p>

      <form className="filters" onSubmit={doSearch} role="search" aria-label="Customer search">
        <Field id="customer-q" label="Name, e-mail or reference">
          <input id="customer-q" name="q" maxLength={100} value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <button type="submit" className="btn flat">Search</button>
      </form>

      {auth.isOperator && (
        <details className="card create">
          <summary>Create customer</summary>
          <form onSubmit={(e) => void submitCreate(e)} className="filters" noValidate>
            <Field id="legalName" label="Legal name" error={nameError}>
              <input id="legalName" name="legalName" required maxLength={200} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
            </Field>
            <Field id="email" label="E-mail" error={emailError}>
              <input id="email" name="email" type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field id="phone" label="Phone (optional)" error={phoneError}>
              <input id="phone" name="phone" maxLength={32} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <button type="submit" className="btn flat" disabled={creating}>Create</button>
          </form>
          {createMessage && <p role={createFailed ? 'alert' : 'status'} className={createFailed ? 'error-text' : undefined}>{createMessage}</p>}
        </details>
      )}

      <StateView state={viewStateOf(result.loading && !result.data, result.error, rows.length === 0 && !result.loading)} message={result.error}
                 onRetry={result.reload} emptyText="No customers match your search.">
        <div className="table-wrap">
          <table className="data" aria-label="Customers">
            <thead>
              <tr><th scope="col">Reference</th><th scope="col">Name</th><th scope="col">E-mail</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col">Accounts</th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><span className="mono">{c.customerRef}</span></td>
                  <td>{c.legalName}</td>
                  <td>{c.email}</td>
                  <td><StatusChip status={c.status} /></td>
                  <td>{formatDate(c.createdAt, 'date')}</td>
                  <td><Link to={`/accounts?customerId=${c.id}`}>view</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} size={size} total={result.data?.totalElements ?? 0} label="Customer pages" onChange={(p, s) => { setPage(p); setSize(s); }} />
      </StateView>
    </section>
  );
}
