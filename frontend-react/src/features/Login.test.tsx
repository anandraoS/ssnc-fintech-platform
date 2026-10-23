import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../core/auth';
import { FakeApi, LocationProbe, tokenReply } from '../testing/helpers';
import { Login, safeReturnUrl } from './Login';

function setup(returnUrl: string | null = null, api = new FakeApi()) {
  const entry = returnUrl ? `/login?returnUrl=${encodeURIComponent(returnUrl)}` : '/login';
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider fetchImpl={api.fetch}>
        <Login />
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
  return api;
}

async function signIn(user: string, password: string) {
  await userEvent.type(screen.getByLabelText('Username'), user);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('Login', () => {
  it('does not call the server with empty credentials and shows field errors', async () => {
    const api = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Username is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it('shows a generic message on 401 and does not leak which field was wrong', async () => {
    setup(null, new FakeApi().on('POST /api/v1/auth/token', { status: 401, body: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } }));
    await signIn('alice.customer', 'wrong');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('explains rate limiting', async () => {
    setup(null, new FakeApi().on('POST /api/v1/auth/token', { status: 429, body: { code: 'RATE_LIMITED', message: 'x' } }));
    await signIn('a', 'b');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });

  it('navigates home after a successful sign-in', async () => {
    setup(null, new FakeApi().on('POST /api/v1/auth/token', tokenReply(['OPERATIONS_ANALYST'], 'omar.ops')));
    await signIn('omar.ops', 'secret');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
  });

  it('follows a safe in-app returnUrl', async () => {
    setup('/accounts', new FakeApi().on('POST /api/v1/auth/token', tokenReply(['CUSTOMER'])));
    await signIn('u', 'p');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/accounts'));
  });

  it('ignores external or protocol-relative returnUrls (open-redirect guard)', () => {
    expect(safeReturnUrl('/accounts?x=1')).toBe('/accounts?x=1');
    expect(safeReturnUrl('https://evil.example')).toBe('/');
    expect(safeReturnUrl('//evil.example')).toBe('/');
    expect(safeReturnUrl('/\\evil.example')).toBe('/');
    expect(safeReturnUrl('javascript:alert(1)')).toBe('/');
    expect(safeReturnUrl(null)).toBe('/');
  });

  it('fills the username from the demo user list', async () => {
    setup();
    await userEvent.click(screen.getByText('Demo users (local profile)'));
    await userEvent.click(screen.getByRole('button', { name: 'omar.ops' }));
    expect(screen.getByLabelText('Username')).toHaveValue('omar.ops');
  });
});
