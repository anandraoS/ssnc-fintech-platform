import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Role } from '../core/models';
import { ACCOUNT, FakeApi, TX, page, renderApp } from '../testing/helpers';

async function navLinks(roles: Role[]): Promise<string[]> {
  const api = new FakeApi()
    .on('GET /api/v1/accounts', { body: page([]) })
    .on('GET /api/v1/transactions', { body: page([]) })
    .on('GET /api/v1/ops/summary', { status: 503, body: { code: 'X', message: 'down' } });
  const { unmount } = renderApp('/accounts', { roles, api });
  const nav = await screen.findByRole('navigation', { name: 'Main' });
  const links = within(nav).getAllByRole('link').map((a) => a.textContent?.trim() ?? '');
  unmount();
  return links;
}

describe('Shell role-aware navigation', () => {
  it('customers see their own pages only', async () => {
    expect(await navLinks(['CUSTOMER'])).toEqual(['Overview', 'Accounts', 'Transactions', 'New transaction']);
  });

  it('support agents get look-up pages but cannot start a transaction', async () => {
    const items = await navLinks(['SUPPORT_AGENT']);
    expect(items).toContain('Customers');
    expect(items).toContain('Investigations');
    expect(items).toContain('Audit trail');
    expect(items).not.toContain('New transaction');
  });

  it('operators and admins see everything', async () => {
    expect(await navLinks(['OPERATIONS_ANALYST'])).toHaveLength(7);
    expect(await navLinks(['ADMIN'])).toHaveLength(7);
  });

  it('shows who is signed in and signs out to the login page', async () => {
    const api = new FakeApi().on('GET /api/v1/accounts', { body: page([]) }).on('GET /api/v1/transactions', { body: page([]) });
    renderApp('/accounts', { roles: ['CUSTOMER'], username: 'alice.customer', api });
    expect(await screen.findByText('alice.customer · customer')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('route guards in the app', () => {
  it('a customer is redirected from /audit to the not-permitted page', async () => {
    renderApp('/audit', { roles: ['CUSTOMER'], api: new FakeApi().on('GET /api/v1/accounts', { body: page([]) }) });
    expect(await screen.findByRole('heading', { name: 'Not permitted' })).toBeInTheDocument();
  });

  it('an unknown route shows the not-found page', async () => {
    renderApp('/nope', { roles: ['CUSTOMER'] });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('Accounts', () => {
  it('requests the first page with server-side paging and shows rows', async () => {
    const api = new FakeApi().on('GET /api/v1/accounts', { body: page([ACCOUNT], { totalElements: 1 }) });
    renderApp('/accounts', { roles: ['SUPPORT_AGENT'], api });
    expect(await screen.findByText('ACC-1000000001')).toBeInTheDocument();
    expect(screen.getAllByText('$1,000.00', { selector: 'td.amount' })).toHaveLength(2); // balance and available
    const [call] = api.callsTo('GET /api/v1/accounts');
    expect(call.query.get('page')).toBe('0');
    expect(call.query.get('size')).toBe('20');
    expect(call.query.has('status')).toBe(false); // empty filters are not sent
  });

  it('shows the empty state when nothing matches, and sends the filters on search', async () => {
    const api = new FakeApi().on('GET /api/v1/accounts', { body: page([]) });
    renderApp('/accounts', { roles: ['SUPPORT_AGENT'], api });
    expect(await screen.findByText('No accounts match these filters.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'SUSPENDED');
    await userEvent.type(screen.getByLabelText('Account number starts with'), 'ACC-10');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(api.callsTo('GET /api/v1/accounts')).toHaveLength(2));
    const last = api.callsTo('GET /api/v1/accounts')[1];
    expect(last.query.get('status')).toBe('SUSPENDED');
    expect(last.query.get('q')).toBe('ACC-10');
  });

  it('passes the customerId from the directory link and sorts server-side', async () => {
    const api = new FakeApi().on('GET /api/v1/accounts', { body: page([ACCOUNT]) });
    renderApp('/accounts?customerId=c1', { roles: ['SUPPORT_AGENT'], api });
    await screen.findByText('ACC-1000000001');
    expect(api.callsTo('GET /api/v1/accounts')[0].query.get('customerId')).toBe('c1');
    await userEvent.click(screen.getByRole('button', { name: /Balance/ }));
    await waitFor(() => expect(api.callsTo('GET /api/v1/accounts')).toHaveLength(2));
    expect(api.callsTo('GET /api/v1/accounts')[1].query.get('sort')).toBe('balance,asc');
  });

  it('shows a retryable error when the server fails', async () => {
    let fail = true;
    const api = new FakeApi().on('GET /api/v1/accounts', () => (fail ? { status: 500, body: { code: 'INTERNAL_ERROR', message: 'Backend unavailable' } } : { body: page([ACCOUNT]) }));
    renderApp('/accounts', { roles: ['SUPPORT_AGENT'], api });
    expect(await screen.findByRole('alert')).toHaveTextContent('Backend unavailable');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('ACC-1000000001')).toBeInTheDocument();
  });
});

describe('Transactions search', () => {
  it('sends the selected filters and blocks malformed amounts', async () => {
    const api = new FakeApi().on('GET /api/v1/transactions', { body: page([TX]) });
    renderApp('/transactions', { roles: ['SUPPORT_AGENT'], api });
    await screen.findByText('TXN-ABC123');

    await userEvent.selectOptions(screen.getByLabelText('Status'), ['FAILED']);
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'WITHDRAWAL');
    await userEvent.type(screen.getByLabelText('Min amount'), '10.50');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(api.callsTo('GET /api/v1/transactions')).toHaveLength(2));
    const req = api.callsTo('GET /api/v1/transactions')[1];
    expect(req.query.getAll('status')).toEqual(['FAILED']);
    expect(req.query.get('type')).toBe('WITHDRAWAL');
    expect(req.query.get('minAmount')).toBe('10.50');
    expect(req.query.get('page')).toBe('0');

    await userEvent.clear(screen.getByLabelText('Min amount'));
    await userEvent.type(screen.getByLabelText('Min amount'), '1,5');
    expect(screen.getByText('Enter a decimal such as 100.50')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(api.callsTo('GET /api/v1/transactions')).toHaveLength(2); // invalid input never reaches the server
  });

  it('pre-selects a status coming from a dashboard link', async () => {
    const api = new FakeApi().on('GET /api/v1/transactions', { body: page([TX]) });
    renderApp('/transactions?status=COMPLETED', { roles: ['SUPPORT_AGENT'], api });
    await screen.findByText('TXN-ABC123');
    expect(api.callsTo('GET /api/v1/transactions')[0].query.getAll('status')).toEqual(['COMPLETED']);
  });
});

describe('TransactionDetail permissions', () => {
  const pending = { ...TX, status: 'PENDING_REVIEW' as const, submittedBy: 'omar.ops' };

  async function openDetail(roles: Role[], username: string, tx: object) {
    const api = new FakeApi()
      .on('GET /api/v1/transactions/' + TX.id, { body: tx })
      .on('GET /api/v1/transactions/' + TX.id + '/attempts', { body: [] })
      .on('GET /api/v1/transactions/' + TX.id + '/audit', { body: [] });
    renderApp('/transactions/' + TX.id, { roles, username, api });
    await screen.findByRole('heading', { name: /TXN-ABC123/ });
    return api;
  }

  it('a DIFFERENT operator can approve or reject a pending transaction', async () => {
    await openDetail(['OPERATIONS_ANALYST'], 'olivia.ops', pending);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject…' })).toBeInTheDocument();
  });

  it('the submitting operator is told a second person must review (maker-checker)', async () => {
    await openDetail(['OPERATIONS_ANALYST'], 'omar.ops', pending);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText(/a different operator must review it/)).toBeInTheDocument();
  });

  it('a customer can cancel their own pending transaction but never approve', async () => {
    await openDetail(['CUSTOMER'], 'alice.customer', { ...pending, submittedBy: 'alice.customer' });
    expect(screen.getByRole('button', { name: 'Cancel transaction' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('a completed transaction offers no actions, and failures show their code', async () => {
    await openDetail(['OPERATIONS_ANALYST'], 'olivia.ops', { ...TX, status: 'FAILED', failureCode: 'CLEARING_DECLINED', failureDetail: 'RISK_DECLINE' });
    expect(screen.queryByRole('button', { name: 'Cancel transaction' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText('CLEARING_DECLINED', { selector: 'strong' })).toBeInTheDocument();
  });

  it('customers do not request attempts or the audit trail', async () => {
    const api = await openDetail(['CUSTOMER'], 'alice.customer', TX);
    expect(api.callsTo('GET /api/v1/transactions/' + TX.id + '/attempts')).toHaveLength(0);
    expect(screen.queryByText('Audit trail')).toBeNull();
  });

  it('approving sends the action, shows the result and reloads', async () => {
    const api = new FakeApi()
      .on('GET /api/v1/transactions/' + TX.id, { body: pending })
      .on('GET /api/v1/transactions/' + TX.id + '/attempts', { body: [] })
      .on('GET /api/v1/transactions/' + TX.id + '/audit', { body: [] })
      .on('POST /api/v1/transactions/' + TX.id + '/approve', { body: { ...pending, status: 'PROCESSING' } });
    renderApp('/transactions/' + TX.id, { roles: ['OPERATIONS_ANALYST'], username: 'olivia.ops', api });
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/Approved - the transaction will now be processed/)).toBeInTheDocument();
    await waitFor(() => expect(api.callsTo('GET /api/v1/transactions/' + TX.id).length).toBeGreaterThanOrEqual(2));
  });

  it('shows a friendly message for a transaction the user cannot see', async () => {
    const api = new FakeApi().on('GET /api/v1/transactions/' + TX.id, { status: 404, body: { code: 'NOT_FOUND', message: 'Transaction not found' } });
    renderApp('/transactions/' + TX.id, { roles: ['CUSTOMER'], api });
    expect(await screen.findByText('This transaction does not exist or you cannot access it.')).toBeInTheDocument();
  });
});

describe('Investigations', () => {
  const record = { id: 'r1', transactionId: TX.id, status: 'OPEN', reasonCode: 'CLEARING_OUTCOME_UNKNOWN', openedAt: '2026-01-01T10:00:00Z' };

  it('lets an operator resolve a reconciliation record and reloads the queue', async () => {
    let resolved = false;
    const api = new FakeApi()
      .on('GET /api/v1/ops/reconciliations', () => ({ body: page(resolved ? [] : [record]) }))
      .on('POST /api/v1/ops/reconciliations/r1/resolve', () => { resolved = true; return { body: { ...record, status: 'RESOLVED' } }; });
    renderApp('/investigations?tab=reconciliation', { roles: ['OPERATIONS_ANALYST'], username: 'omar.ops', api });
    await userEvent.click(await screen.findByRole('button', { name: /NOT executed/ }));
    expect(await screen.findByText(/funds returned to the customer/)).toBeInTheDocument();
    expect(api.callsTo('POST /api/v1/ops/reconciliations/r1/resolve')[0].body?.['resolution']).toBe('CONFIRMED_NOT_EXECUTED');
    expect(api.callsTo('GET /api/v1/ops/reconciliations')).toHaveLength(2);
  });

  it('a support agent sees the queue read-only (no resolve buttons)', async () => {
    const api = new FakeApi().on('GET /api/v1/ops/reconciliations', { body: page([record]) });
    renderApp('/investigations?tab=reconciliation', { roles: ['SUPPORT_AGENT'], api });
    expect(await screen.findByText('CLEARING_OUTCOME_UNKNOWN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /NOT executed/ })).toBeNull();
  });

  it('switches tabs and queries the matching statuses', async () => {
    const api = new FakeApi().on('GET /api/v1/transactions', { body: page([]) });
    renderApp('/investigations', { roles: ['SUPPORT_AGENT'], api });
    expect(await screen.findByText('Nothing is waiting for approval.')).toBeInTheDocument();
    expect(api.callsTo('GET /api/v1/transactions')[0].query.getAll('status')).toEqual(['PENDING_REVIEW']);
    await userEvent.click(screen.getByRole('tab', { name: 'Failed / rejected' }));
    expect(await screen.findByText('No failed or rejected transactions.')).toBeInTheDocument();
    expect(api.callsTo('GET /api/v1/transactions')[1].query.getAll('status')).toEqual(['FAILED', 'REJECTED']);
  });
});

describe('Customers and audit', () => {
  const customer = { id: 'c1', customerRef: 'CUS-100001', legalName: 'Alice Example', email: 'a***@example.test', status: 'ACTIVE', version: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };

  it('support agents see masked contact details and cannot create customers', async () => {
    renderApp('/customers', { roles: ['SUPPORT_AGENT'], api: new FakeApi().on('GET /api/v1/customers', { body: page([customer]) }) });
    expect(await screen.findByText('a***@example.test')).toBeInTheDocument();
    expect(screen.getByText(/Contact details are masked for your role/)).toBeInTheDocument();
    expect(screen.queryByText('Create customer')).toBeNull();
  });

  it('operators can create a customer and the list reloads', async () => {
    const api = new FakeApi()
      .on('GET /api/v1/customers', { body: page([customer]) })
      .on('POST /api/v1/customers', { status: 201, body: customer });
    renderApp('/customers', { roles: ['OPERATIONS_ANALYST'], api });
    await screen.findByText('CUS-100001');
    await userEvent.click(screen.getByText('Create customer'));
    await userEvent.type(screen.getByLabelText('Legal name'), 'New Person');
    await userEvent.type(screen.getByLabelText('E-mail'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('A valid e-mail is required')).toBeInTheDocument();
    expect(api.callsTo('POST /api/v1/customers')).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText('E-mail'));
    await userEvent.type(screen.getByLabelText('E-mail'), 'new@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Created CUS-100001.')).toBeInTheDocument();
    expect(api.callsTo('POST /api/v1/customers')[0].body).toEqual({ legalName: 'New Person', email: 'new@example.test' });
  });

  it('lists audit events with their filters', async () => {
    const event = { id: 1, occurredAt: '2026-01-01T10:00:00Z', actor: 'omar.ops', action: 'TRANSACTION_COMPLETED', entityType: 'TRANSACTION', entityId: '11111111-1111-4111-8111-111111111111' };
    const api = new FakeApi().on('GET /api/v1/ops/audit-events', { body: page([event]) });
    renderApp('/audit', { roles: ['SUPPORT_AGENT'], api });
    expect(await screen.findByText('TRANSACTION_COMPLETED')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Actor'), 'omar.ops');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(api.callsTo('GET /api/v1/ops/audit-events')).toHaveLength(2));
    expect(api.callsTo('GET /api/v1/ops/audit-events')[1].query.get('actor')).toBe('omar.ops');
    expect(api.callsTo('GET /api/v1/ops/audit-events')[1].query.get('sort')).toBe('occurredAt,desc');
  });
});

describe('Account detail', () => {
  const suspended = { ...ACCOUNT, status: 'SUSPENDED' as const, statusReason: 'fraud check' };
  const balance = { accountId: ACCOUNT.id, currency: 'USD', ledgerBalance: '1000.00', minimumBalance: '0.00', availableBalance: '900.00', asOf: '2026-01-01T00:00:00Z' };

  function api(account: object) {
    return new FakeApi()
      .on('GET /api/v1/accounts/' + ACCOUNT.id, { body: account })
      .on('GET /api/v1/accounts/' + ACCOUNT.id + '/balance', { body: balance })
      .on('GET /api/v1/accounts/' + ACCOUNT.id + '/transactions', { body: page([TX]) });
  }

  it('shows balances (available comes from the balance endpoint) and history', async () => {
    renderApp('/accounts/' + ACCOUNT.id, { roles: ['CUSTOMER'], api: api(ACCOUNT) });
    expect(await screen.findByText('Ledger balance')).toBeInTheDocument();
    expect(screen.getByText('$900.00')).toBeInTheDocument();
    expect(await screen.findByText('TXN-ABC123')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'New transaction' })).toHaveAttribute('href', '/transactions/new?account=' + ACCOUNT.id);
    expect(screen.queryByRole('button', { name: 'Suspend…' })).toBeNull(); // customers cannot manage accounts
  });

  it('an operator can reactivate a suspended account', async () => {
    const fake = api(suspended).on('POST /api/v1/accounts/' + ACCOUNT.id + '/activate', { body: ACCOUNT });
    renderApp('/accounts/' + ACCOUNT.id, { roles: ['OPERATIONS_ANALYST'], api: fake });
    expect(await screen.findByText('fraud check')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    expect(await screen.findByText('Account is now active.')).toBeInTheDocument();
  });

  it('suspending requires a reason', async () => {
    const fake = api(ACCOUNT).on('POST /api/v1/accounts/' + ACCOUNT.id + '/suspend', { body: suspended });
    renderApp('/accounts/' + ACCOUNT.id, { roles: ['OPERATIONS_ANALYST'], api: fake });
    await userEvent.click(await screen.findByRole('button', { name: 'Suspend…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm suspension' }));
    expect(screen.getByText('A reason is required')).toBeInTheDocument();
    expect(fake.callsTo('POST /api/v1/accounts/' + ACCOUNT.id + '/suspend')).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Reason for suspension'), 'fraud check');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm suspension' }));
    expect(await screen.findByText('Account is now suspended.')).toBeInTheDocument();
    expect(fake.callsTo('POST /api/v1/accounts/' + ACCOUNT.id + '/suspend')[0].body).toEqual({ reason: 'fraud check' });
  });

  it('only admins can close an account', async () => {
    const { unmount } = renderApp('/accounts/' + ACCOUNT.id, { roles: ['OPERATIONS_ANALYST'], api: api(ACCOUNT) });
    await screen.findByText('Ledger balance');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    unmount();
    renderApp('/accounts/' + ACCOUNT.id, { roles: ['ADMIN'], api: api(ACCOUNT) });
    expect(await screen.findByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('explains a 404', async () => {
    const fake = new FakeApi().on('GET /api/v1/accounts/' + ACCOUNT.id, { status: 404, body: { code: 'NOT_FOUND', message: 'nope' } })
      .on('GET /api/v1/accounts/' + ACCOUNT.id + '/balance', { status: 404, body: { code: 'NOT_FOUND', message: 'nope' } })
      .on('GET /api/v1/accounts/' + ACCOUNT.id + '/transactions', { status: 404, body: { code: 'NOT_FOUND', message: 'nope' } });
    renderApp('/accounts/' + ACCOUNT.id, { roles: ['CUSTOMER'], api: fake });
    expect(await screen.findByText('This account does not exist or you cannot access it.')).toBeInTheDocument();
  });
});
