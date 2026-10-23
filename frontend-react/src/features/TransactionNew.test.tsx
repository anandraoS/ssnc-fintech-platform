import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ACCOUNT, FakeApi, Reply, page, renderApp } from '../testing/helpers';
import { AMOUNT_PATTERN, transactionShapeErrors } from './TransactionNew';

const SECOND = { ...ACCOUNT, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', accountNumber: 'ACC-1000000002' };
const ACCEPTED = { id: 't1', reference: 'TXN-1', type: 'DEPOSIT', status: 'VALIDATED', amount: '25.00', currency: 'USD' };
const accepted = (extra: Partial<Reply> = {}): Reply => ({ status: 202, body: ACCEPTED, ...extra });

async function open(api = new FakeApi()) {
  api.on('GET /api/v1/accounts', { body: page([ACCOUNT, SECOND]) });
  renderApp('/transactions/new', { roles: ['CUSTOMER'], username: 'alice.customer', customerId: 'c1', api });
  await screen.findByRole('heading', { name: 'New transaction' });
  await screen.findByRole('option', { name: /ACC-1000000001/ }); // accounts loaded
  return api;
}

async function fillDeposit(amount = '25.00') {
  await userEvent.selectOptions(screen.getByLabelText('To account'), ACCOUNT.id);
  const field = screen.getByLabelText(/^Amount/);
  await userEvent.clear(field);
  await userEvent.type(field, amount);
}

const submit = () => userEvent.click(screen.getByRole('button', { name: /Submit transaction|Submitting/ }));

describe('TransactionNew', () => {
  it('does not call the API when the form is invalid (required fields, shape rules)', async () => {
    const api = await open();
    await submit();
    expect(screen.getByText('Choose the account to deposit into.')).toBeInTheDocument();
    expect(screen.getByText('Amount is required')).toBeInTheDocument();
    expect(api.callsTo('POST /api/v1/transactions')).toHaveLength(0);
  });

  it('derives the currency from the selected account and sends amounts as strings', async () => {
    const api = await open(new FakeApi().on('POST /api/v1/transactions', accepted()));
    await fillDeposit('25.50');
    await submit();
    expect(await screen.findByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText('TXN-1')).toBeInTheDocument();
    const [call] = api.callsTo('POST /api/v1/transactions');
    expect(call.body).toEqual({ type: 'DEPOSIT', targetAccountId: ACCOUNT.id, amount: '25.50', currency: 'USD' });
    expect(call.headers.get('Idempotency-Key')).toMatch(/^ui-.{8,}/);
  });

  it('disables the button while a request is in flight so a double click cannot submit twice', async () => {
    let release!: (r: Reply) => void;
    const pending = new Promise<Reply>((resolve) => { release = resolve; });
    const api = await open(new FakeApi().on('POST /api/v1/transactions', () => pending));
    await fillDeposit();
    await submit();
    const button = await screen.findByRole('button', { name: 'Submitting…' });
    expect(button).toBeDisabled();
    await userEvent.click(button); // ignored
    release(accepted());
    expect(await screen.findByText('Accepted')).toBeInTheDocument();
    expect(api.callsTo('POST /api/v1/transactions')).toHaveLength(1);
  });

  it('shows the business rejection (422) with its failure code and a link to the recorded transaction', async () => {
    await open(new FakeApi().on('POST /api/v1/transactions', {
      status: 422,
      body: { code: 'TRANSACTION_REJECTED', message: 'rejected', details: { failureCode: 'INSUFFICIENT_FUNDS', failureDetail: 'INSUFFICIENT_FUNDS: Available balance is insufficient', transactionId: 'abc' } },
    }));
    await fillDeposit();
    await submit();
    const alert = await screen.findByText('Rejected by business rules');
    expect(alert.closest('[role="alert"]')).toHaveTextContent('INSUFFICIENT_FUNDS');
    expect(screen.getByRole('link', { name: 'View the recorded transaction' })).toHaveAttribute('href', '/transactions/abc');
  });

  it('reuses the SAME idempotency key when retrying an unchanged payload after a server error', async () => {
    let attempt = 0;
    const api = await open(new FakeApi().on('POST /api/v1/transactions', () =>
      (++attempt === 1 ? { status: 500, body: { code: 'INTERNAL_ERROR', message: 'boom', correlationId: 'c-1' } } : accepted())));
    await fillDeposit();
    await submit();
    expect(await screen.findByText('Could not submit')).toBeInTheDocument();
    expect(screen.getByText('c-1')).toBeInTheDocument();
    await submit();
    expect(await screen.findByText('Accepted')).toBeInTheDocument();
    const [first, retry] = api.callsTo('POST /api/v1/transactions');
    expect(retry.headers.get('Idempotency-Key')).toBe(first.headers.get('Idempotency-Key'));
  });

  it('uses a NEW key when the user edits the payload', async () => {
    let attempt = 0;
    const api = await open(new FakeApi().on('POST /api/v1/transactions', () =>
      (++attempt === 1 ? { status: 500, body: { code: 'INTERNAL_ERROR', message: 'x' } } : accepted())));
    await fillDeposit('10.00');
    await submit();
    await screen.findByText('Could not submit');
    await fillDeposit('11.00');
    await submit();
    await screen.findByText('Accepted');
    const [first, second] = api.callsTo('POST /api/v1/transactions');
    expect(second.headers.get('Idempotency-Key')).not.toBe(first.headers.get('Idempotency-Key'));
  });

  it('flags a replayed submission', async () => {
    await open(new FakeApi().on('POST /api/v1/transactions', accepted({ headers: { 'Idempotent-Replayed': 'true' } })));
    await fillDeposit();
    await submit();
    expect(await screen.findByText(/no second transaction was created/)).toBeInTheDocument();
  });

  it('blocks an amount with 3 decimals client-side, even after a successful submission', async () => {
    const api = await open(new FakeApi().on('POST /api/v1/transactions', accepted()));
    await fillDeposit();
    await submit();
    await screen.findByText('Accepted');
    await userEvent.type(screen.getByLabelText(/^Amount/), '1.005');
    await submit();
    expect(await screen.findByText(/at most 2 decimals/)).toBeInTheDocument();
    expect(api.callsTo('POST /api/v1/transactions')).toHaveLength(1);
  });

  it('hides the source account for deposits and the target account for withdrawals', async () => {
    await open();
    expect(screen.queryByLabelText('From account')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'WITHDRAWAL');
    expect(screen.getByLabelText('From account')).toBeInTheDocument();
    expect(screen.queryByLabelText('To account')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'TRANSFER');
    expect(screen.getByLabelText('From account')).toBeInTheDocument();
    expect(screen.getByLabelText('To account')).toBeInTheDocument();
  });

  it('rejects a transfer to the same account', async () => {
    const api = await open();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'TRANSFER');
    await userEvent.selectOptions(screen.getByLabelText('From account'), ACCOUNT.id);
    await userEvent.selectOptions(screen.getByLabelText('To account'), ACCOUNT.id);
    await userEvent.type(screen.getByLabelText(/^Amount/), '5.00');
    await submit();
    expect(await screen.findByText('The source and target accounts must be different.')).toBeInTheDocument();
    await waitFor(() => expect(api.callsTo('POST /api/v1/transactions')).toHaveLength(0));
  });
});

describe('amount and shape validation rules', () => {
  it('accepts positive decimals with at most 2 fraction digits', () => {
    for (const ok of ['1', '0.5', '125.50', '999999999999999.99']) {
      expect(AMOUNT_PATTERN.test(ok), ok).toBe(true);
    }
    for (const bad of ['', '-1', '1.005', '1e3', ' 5', '5 ', '1,000', 'abc', '.5']) {
      expect(AMOUNT_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it('requires the right accounts for each type', () => {
    const shape = (type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER', sourceAccountId: string, targetAccountId: string) =>
      transactionShapeErrors({ type, sourceAccountId, targetAccountId });
    expect(shape('DEPOSIT', '', '')).toEqual({ targetRequired: true });
    expect(shape('DEPOSIT', '', 'a')).toBeNull();
    expect(shape('WITHDRAWAL', '', 'a')).toEqual({ sourceRequired: true });
    expect(shape('WITHDRAWAL', 'a', '')).toBeNull();
    expect(shape('TRANSFER', 'a', '')).toEqual({ bothRequired: true });
    expect(shape('TRANSFER', 'a', 'a')).toEqual({ sameAccount: true });
    expect(shape('TRANSFER', 'a', 'b')).toBeNull();
  });
});
