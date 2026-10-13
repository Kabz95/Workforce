import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isFirebaseConfigured, useEmulators } from '../lib/firebase';
import ErrorNotice from '../components/ErrorNotice';

export default function Login() {
  const { signIn, signUp, signInGoogle } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

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
      <p className="muted">
        New accounts start as <strong>worker</strong> in the demo hub. Roles and
        hub membership come from your organisation in production.
      </p>
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
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="row">
          <button type="submit" disabled={busy}>
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          >
            {mode === 'signin' ? 'Need an account?' : 'Have an account?'}
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
