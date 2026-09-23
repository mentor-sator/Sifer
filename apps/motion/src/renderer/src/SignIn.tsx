import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { SignedInState, SignInFailure } from '../../shared/bridge';
import { describeRuntime } from './versions';
import './signin.css';

const messages: Record<SignInFailure, string> = {
  credentials: 'Email or password is incorrect.',
  unavailable: 'Cannot reach the Sifer identity service. Is it running?',
  invalid: 'Enter your email and password.',
};

export function SignIn() {
  const [state, setState] = useState<SignedInState | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.sifer.auth.state().then(setState);
    return window.sifer.auth.onChange(setState);
  }, []);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      const result = await window.sifer.auth.signIn(email, password);
      setBusy(false);
      if (result.ok) {
        setPassword('');
        setState(result.state);
        return;
      }
      setError(messages[result.reason]);
    },
    [email, password],
  );

  const signOut = useCallback(async () => {
    setBusy(true);
    setState(await window.sifer.auth.signOut());
    setBusy(false);
  }, []);

  if (state?.status === 'signed-in') {
    return (
      <main className="panel">
        <h1>Sifer</h1>
        <p className="who">Signed in as {state.email}</p>
        <button type="button" onClick={() => void signOut()} disabled={busy}>
          Sign out
        </button>
        <p className="runtime">{describeRuntime(window.sifer.versions)}</p>
      </main>
    );
  }

  return (
    <main className="panel">
      <h1>Sign in to Sifer</h1>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      <p className="runtime">{describeRuntime(window.sifer.versions)}</p>
    </main>
  );
}
