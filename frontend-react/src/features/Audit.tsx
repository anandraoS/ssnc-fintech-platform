import { FormEvent, useState } from 'react';
import { useApi } from '../core/auth';
import { useAsync, useTitle } from '../core/useAsync';
import { formatDate } from '../shared/format';
import { Field, Pager, StateView, viewStateOf } from '../shared/components';

const ENTITY_TYPES = ['CUSTOMER', 'ACCOUNT', 'TRANSACTION', 'USER', 'SYSTEM'];

interface AuditFilters {
  action: string;
  entityType: string;
  entityId: string;
  actor: string;
}
const NO_FILTERS: AuditFilters = { action: '', entityType: '', entityId: '', actor: '' };

/** Append-only audit trail viewer with filters and paging. */
export function Audit() {
  useTitle('Audit trail');
  const api = useApi();
  const [draft, setDraft] = useState<AuditFilters>(NO_FILTERS);
  const [applied, setApplied] = useState<AuditFilters>(NO_FILTERS);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const result = useAsync(
    () => api.auditEvents({ ...applied, page, size, sort: 'occurredAt,desc' }),
    [api, applied, page, size],
    'Audit events could not be loaded.',
  );
  const rows = result.data?.items ?? [];

  function search(e: FormEvent) {
    e.preventDefault();
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
      <h1>Audit trail</h1>
      <p className="subtitle">Immutable record of account, transaction and access events.</p>

      <form className="filters" onSubmit={search} role="search" aria-label="Audit filters">
        <Field id="audit-action" label="Action">
          <input id="audit-action" name="action" placeholder="TRANSACTION_COMPLETED" maxLength={60} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} />
        </Field>
        <Field id="audit-entity-type" label="Entity type">
          <select id="audit-entity-type" name="entityType" value={draft.entityType} onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}>
            <option value="">Any</option>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field id="audit-entity-id" label="Entity id">
          <input id="audit-entity-id" name="entityId" maxLength={64} value={draft.entityId} onChange={(e) => setDraft({ ...draft, entityId: e.target.value })} />
        </Field>
        <Field id="audit-actor" label="Actor">
          <input id="audit-actor" name="actor" maxLength={100} value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })} />
        </Field>
        <button type="submit" className="btn flat">Search</button>
        <button type="button" className="btn text" onClick={reset}>Clear</button>
      </form>

      <StateView state={viewStateOf(result.loading && !result.data, result.error, rows.length === 0 && !result.loading)} message={result.error}
                 onRetry={result.reload} emptyText="No audit events match these filters.">
        <div className="table-wrap">
          <table className="data" aria-label="Audit events">
            <thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">Details</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.occurredAt)}</td>
                  <td>{e.actor}</td>
                  <td><span className="mono">{e.action}</span></td>
                  <td>{e.entityType} <span className="mono muted">{e.entityId.slice(0, 13)}</span></td>
                  <td className="muted">{e.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} size={size} total={result.data?.totalElements ?? 0} sizes={[20, 50, 100]} label="Audit pages" onChange={(p, s) => { setPage(p); setSize(s); }} />
      </StateView>
    </section>
  );
}
