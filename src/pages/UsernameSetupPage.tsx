import { FormEvent, useState } from 'react';
import BrandMark from '../components/BrandMark';
import { Button } from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';
import { normalizeUsername, validateUsername } from '../lib/userProfiles';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function UsernameSetupPage() {
  useDocumentTitle('Choose your username');
  const { completeUsername, user, logout } = useAuth();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');

    const usernameError = validateUsername(username);
    if (usernameError) {
      setError(usernameError);
      return;
    }

    setBusy(true);
    const saveError = await completeUsername(normalizeUsername(username));
    if (saveError) {
      setError(saveError);
      setBusy(false);
      return;
    }

    setBusy(false);
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <BrandMark size={28} />
        </div>
        <h1 className="login-title">Choose your username</h1>
        <p className="login-subtitle">
          {user?.email ? `Signed in as ${user.email}. ` : ''}
          You need a username before you can use bands and invites.
        </p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="form-field">
            <label htmlFor="setup-username">Username</label>
            <input
              id="setup-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => { setUsername(event.target.value); setError(''); }}
              required
            />
          </div>
          {error ? <p className="login-error">{error}</p> : null}
          <Button type="submit" variant="primary" className="login-submit" disabled={busy}>
            {busy ? 'Saving username…' : 'Continue'}
          </Button>
          <Button className="login-submit" onClick={() => { void logout(); }} disabled={busy}>
            Sign out
          </Button>
        </form>
        <footer className="footer">From Norway {'<3'} with chords</footer>
      </div>
    </div>
  );
}