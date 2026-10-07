import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { SignedInState, SignInFailure } from '../../shared/bridge';
import { describeRuntime } from './versions';
import './signin.css';

const messages: Record<SignInFailure, string> = {
  credentials: 'Email or password is incorrect.',
  unavailable: 'Cannot reach the Sifer identity service. Is it running?',
  invalid: 'Enter your email and password.',
  cancelled: 'Google sign-in was cancelled or timed out.',
  'account-exists': 'This email already has a Sifer password. Sign in with your password.',
  refused: 'Google could not complete the sign-in. Try again.',
};

export function SignIn() {
  const [state, setState] = useState<SignedInState | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitingForGoogle, setWaitingForGoogle] = useState(false);

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

  const continueWithGoogle = useCallback(async () => {
    setBusy(true);
    setWaitingForGoogle(true);
    setError(null);
    const result = await window.sifer.auth.signInWithGoogle();
    setBusy(false);
    setWaitingForGoogle(false);
    if (result.ok) {
      setState(result.state);
      return;
    }
    setError(messages[result.reason]);
  }, []);

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
      <button
        type="button"
        className="google"
        onClick={() => void continueWithGoogle()}
        disabled={busy}
      >
        <GoogleMark />
        {waitingForGoogle ? 'Finish signing in in your browser...' : 'Continue with Google'}
      </button>
      <div className="divider" role="separator">
        <span>or</span>
      </div>
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
        <button type="submit" disabled={busy}>
          {busy && !waitingForGoogle ? 'Signing in...' : 'Sign in'}
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      <p className="runtime">{describeRuntime(window.sifer.versions)}</p>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg className="mark" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
