import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isFirebaseConfigured, useEmulators } from '../lib/firebase';
import ErrorNotice from '../components/ErrorNotice';

export default function Login() {
  const { user, loading, signIn, signUp, signInGoogle } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Signed-in users never see the sign-in form: send them to the
  // dashboard. (Previously the form rendered for signed-in users
  // alongside a stale "Access denied" box from an earlier failure.)
  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
  }, [loading, user, navigate]);

  // A stale error from an earlier attempt must not survive a fresh
  // visit to this page or a mode switch.
  useEffect(() => {
    setError(null);
  }, [mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        await signUp(email, password, displayName);
      }
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInGoogle();
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <h1>{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
      <div className="gold-rule" />
      {mode === 'signin' ? (
        <p className="muted">
          Accounts are created by invitation from your organisation. Sign
          in with the email your organisation invited.
        </p>
      ) : (
        <p className="muted">
          Enter the email your organisation invited. If no invitation
          matches that email, signup is refused — ask your organisation
          to invite you.
        </p>
      )}
      {!isFirebaseConfigured && !useEmulators && (
        <div className="notice">
          <strong>Firebase Project Setup Pending:</strong> Set your project's web config in <code>web/.env</code> or start local emulators with <code>VITE_USE_EMULATORS=true</code> to begin authenticating.
        </div>
      )}
      <ErrorNotice error={error} />
      <form onSubmit={submit}>
        {mode === 'signup' && (
          <div className="field">
            <label htmlFor="displayName">Display name</label>
            <input
              id="displayName"
              data-testid="login-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            data-testid="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            data-testid="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="row">
          <button type="submit" data-testid="login-submit" disabled={busy}>
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <button
            type="button"
            className="secondary"
            data-testid="login-toggle-signup"
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          >
            {mode === 'signin' ? 'Have an invitation?' : 'Have an account?'}
          </button>
        </div>
      </form>
      <p className="center muted">— or —</p>
      <button type="button" className="secondary" onClick={google} disabled={busy}>
        Continue with Google
      </button>
    </div>
  );
}
