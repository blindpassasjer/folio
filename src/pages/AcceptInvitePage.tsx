import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import { Button } from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';
import { dataClient } from '../lib/dataClient';
import type { InviteContext } from '../lib/dataClient/types';
import { normalizeUsername, validateUsername } from '../lib/userProfiles';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

type LookupState =
  | { status: 'loading' }
  | { status: 'invalid'; message: string }
  | { status: 'valid'; invite: InviteContext };

export default function AcceptInvitePage() {
  useDocumentTitle('Accept invite');
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const [lookup, setLookup] = useState<LookupState>({ status: 'loading' });
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setLookup({ status: 'invalid', message: 'This invite link is missing a token.' });
      return;
    }

    let cancelled = false;
    void dataClient.auth.getInvite(token).then(({ invite, error: lookupError }) => {
      if (cancelled) return;
      if (invite) {
        setLookup({ status: 'valid', invite });
      } else {
        setLookup({ status: 'invalid', message: lookupError ?? 'This invite is no longer valid.' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || lookup.status !== 'valid') return;

    setError('');

    const usernameError = validateUsername(username);
    if (usernameError) {
      setError(usernameError);
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (!lookup.invite.email && !email.includes('@')) {
      setError('A valid email is required.');
      return;
    }

    setBusy(true);
    const { user, error: acceptError } = await dataClient.auth.acceptInvite(token, {
      username: normalizeUsername(username),
      password,
      fullName: fullName.trim() || undefined,
      email: lookup.invite.email ? undefined : email.trim(),
    });

    if (acceptError || !user) {
      setError(acceptError ?? 'Failed to accept invite.');
      setBusy(false);
      return;
    }

    setUser(user);
    // "/" resolves to the user's last active band (or profile if they have none) via
    // RootRedirect, same destination a fresh login lands on — no deep link to preserve here.
    navigate('/', { replace: true });
  }

  if (lookup.status === 'loading') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-brand">
            <BrandMark size={28} />
          </div>
          <p>Checking your invite&hellip;</p>
        </div>
      </div>
    );
  }

  if (lookup.status === 'invalid') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-brand">
            <BrandMark size={28} />
          </div>
          <h1 className="login-title">Invite unavailable</h1>
          <p className="login-description">{lookup.message}</p>
          <footer className="footer">
            <span className="footer-links">
              <Link to="/">Go to sign in</Link>
            </span>
          </footer>
        </div>
      </div>
    );
  }

  const needsEmail = !lookup.invite.email;

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <BrandMark size={28} />
        </div>
        <h1 className="login-title">Join GIGBOY</h1>
        <p className="login-description">
          {lookup.invite.email
            ? `You've been invited as ${lookup.invite.email}. Create your account below.`
            : "You've been invited to join. Create your account below."}
        </p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="form-field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="fullName">Full name</label>
            <input
              id="fullName"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => { setFullName(e.target.value); setError(''); }}
            />
          </div>
          {needsEmail ? (
            <div className="form-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                required
              />
            </div>
          ) : null}
          <div className="form-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
              required
            />
          </div>
          {error && <p className="login-error">{error}</p>}
          <Button type="submit" variant="primary" className="login-submit" disabled={busy}>
            {busy ? 'Creating account...' : 'Create account'}
          </Button>
        </form>

        <footer className="footer">From Norway {'<3'} with chords</footer>
      </div>
    </div>
  );
}
