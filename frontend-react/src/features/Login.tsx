import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../core/auth';
import { isApiProblem } from '../core/models';
import { useTitle } from '../core/useAsync';
import { Field } from '../shared/components';

const DEMO_USERS = [
  { username: 'alice.customer', hint: 'customer' },
  { username: 'bob.customer', hint: 'customer' },
  { username: 'sam.support', hint: 'support agent' },
  { username: 'omar.ops', hint: 'operations' },
  { username: 'olivia.ops', hint: 'operations (second approver)' },
  { username: 'adam.admin', hint: 'admin' },
];

/** Only in-app relative paths are followed (prevents an open redirect through a crafted returnUrl). */
export function safeReturnUrl(returnUrl: string | null): string {
  return returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//') && !returnUrl.startsWith('/\\') ? returnUrl : '/';
}

export function Login() {
  useTitle('Sign in');
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameError = touched && username.trim() === '' ? 'Username is required' : '';
  const passwordError = touched && password === '' ? 'Password is required' : '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (username.trim() === '' || password === '' || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await auth.login(username.trim(), password);
      void navigate(safeReturnUrl(params.get('returnUrl')), { replace: true });
    } catch (err) {
      setBusy(false);
      const problem = isApiProblem(err) ? err : null;
      setError(
        problem?.status === 401 ? 'Invalid username or password.'
          : problem?.status === 429 ? 'Too many attempts. Please wait a moment and try again.'
          : (problem?.message ?? 'Sign-in failed.'),
      );
    }
  }

  return (
    <main className="login-wrap">
      <form className="card stack" onSubmit={submit} noValidate aria-labelledby="login-title">
        <h1 id="login-title">Sign in</h1>
        <p className="muted">Synthetic demo environment. Users and balances are fictional; no real money moves.</p>

        <Field id="username" label="Username" error={usernameError}>
          <input id="username" name="username" value={username} maxLength={64} autoComplete="username" required
                 aria-invalid={!!usernameError} aria-describedby={usernameError ? 'username-error' : undefined}
                 onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field id="password" label="Password" error={passwordError}>
          <input id="password" name="password" type="password" value={password} maxLength={128} autoComplete="current-password" required
                 aria-invalid={!!passwordError} aria-describedby={passwordError ? 'password-error' : undefined}
                 onChange={(e) => setPassword(e.target.value)} />
        </Field>

        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="submit" className="btn flat" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>

        <details>
          <summary>Demo users (local profile)</summary>
          <p className="muted">The shared password is configured with LOCAL_DEMO_PASSWORD (see README).</p>
          <ul>
            {DEMO_USERS.map((u) => (
              <li key={u.username}>
                <button type="button" className="link" onClick={() => setUsername(u.username)}>{u.username}</button>{' '}
                <span className="muted">{u.hint}</span>
              </li>
            ))}
          </ul>
        </details>
      </form>
    </main>
  );
}
