import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, LogOut, Sparkles, Trash2 } from 'lucide-react';
import toast from '../utils/anchoredToast';
import { useAuth } from '../context/AuthContext';
import { useBands } from '../context/BandsContext';
import UserAvatar from '../components/UserAvatar';
import { normalizeUsername, validateUsername } from '../lib/userProfiles';
import { dataClient } from '../lib/dataClient';
import { loadSongRecordings, type SongRecording } from '../lib/songRecordings';
import { buildSongbookExportZip, triggerSongbookExportDownload, type PressKitImageAsset } from '../lib/songbookExport';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { writeStoredString } from '../lib/safeStorage';

export default function ProfilePage() {
  useDocumentTitle('Profile');
  const { user, updateEmailAddress, updateUsername, updateFullName, updatePassword, deleteAccount, logout } = useAuth();
  const {
    bands,
    loading: bandsLoading,
    createBand,
    bandSongsByBandId,
    bandSongListsByBandId,
    bandSetlistsByBandId,
    bandInputListsByBandId,
    bandPressKitsByBandId,
  } = useBands();
  const navigate = useNavigate();
  const [newBandName, setNewBandName] = useState('');
  const [busyCreateBand, setBusyCreateBand] = useState(false);
  const [busyExport, setBusyExport] = useState(false);
  const [email, setEmail] = useState(user?.email ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [busyEmail, setBusyEmail] = useState(false);
  const [busyUsername, setBusyUsername] = useState(false);
  const [busyFullName, setBusyFullName] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busyPassword, setBusyPassword] = useState(false);
  const [busyLogout, setBusyLogout] = useState(false);
  const [busyDeleteAccount, setBusyDeleteAccount] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteStepOneConfirmed, setDeleteStepOneConfirmed] = useState(false);
  const [deleteStepTwoPhrase, setDeleteStepTwoPhrase] = useState('');

  const displayName = useMemo(() => user?.fullName || user?.username || user?.email || 'User', [user?.email, user?.fullName, user?.username]);
  const deletePhraseMatches = deleteStepTwoPhrase.trim().toUpperCase() === 'DELETE MY ACCOUNT';

  if (!user) {
    return <p className="profile-settings-status">You must be signed in to manage your profile.</p>;
  }

  const onEmailSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextEmail = email.trim();
    if (!nextEmail) {
      toast.error('Email is required.');
      return;
    }

    setBusyEmail(true);
    const error = await updateEmailAddress(nextEmail);
    setBusyEmail(false);
    if (error) {
      toast.error(error);
      return;
    }

    toast.success('Email updated.');
  };

  const onUsernameSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = normalizeUsername(username);
    const validationError = validateUsername(candidate);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setBusyUsername(true);
    const error = await updateUsername(candidate);
    setBusyUsername(false);
    if (error) {
      toast.error(error);
      return;
    }

    setUsername(candidate);
    toast.success('Username updated.');
  };

  const onFullNameSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = fullName.trim();
    if (!candidate) {
      toast.error('Full name is required.');
      return;
    }

    setBusyFullName(true);
    const error = await updateFullName(candidate);
    setBusyFullName(false);
    if (error) {
      toast.error(error);
      return;
    }

    setFullName(candidate);
    toast.success('Full name updated.');
  };

  const onPasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters.');
      return;
    }

    setBusyPassword(true);
    const error = await updatePassword(currentPassword, newPassword);
    setBusyPassword(false);
    if (error) {
      toast.error(error);
      return;
    }

    setCurrentPassword('');
    setNewPassword('');
    toast.success('Password updated.');
  };

  const onLogout = async () => {
    setBusyLogout(true);
    try {
      await logout();
    } finally {
      setBusyLogout(false);
    }
  };

  const onStartDeleteAccount = () => {
    setDeleteConfirmOpen(true);
    setDeleteStepOneConfirmed(false);
    setDeleteStepTwoPhrase('');
  };

  const onCancelDeleteAccount = () => {
    setDeleteConfirmOpen(false);
    setDeleteStepOneConfirmed(false);
    setDeleteStepTwoPhrase('');
  };

  const onDeleteAccount = async () => {
    if (!deleteStepOneConfirmed || !deletePhraseMatches) {
      return;
    }

    setBusyDeleteAccount(true);
    const error = await deleteAccount();
    setBusyDeleteAccount(false);

    if (error) {
      toast.error(error);
      return;
    }

    toast.success('Account deleted.');
  };

  const handleExportData = async () => {
    setBusyExport(true);
    try {
      const bandRecordingsBySongId: Record<string, Record<string, SongRecording[]>> = {};
      const bandPressKitImagesByBandId: Record<string, PressKitImageAsset[]> = {};
      await Promise.all(bands.map(async (band) => {
        const bandSongs = bandSongsByBandId[band.id] ?? [];
        const recordingsBySongId: Record<string, SongRecording[]> = {};
        await Promise.all(bandSongs.map(async (song) => {
          try {
            recordingsBySongId[song.id] = await loadSongRecordings(band.id, song.id);
          } catch {
            recordingsBySongId[song.id] = [];
          }
        }));
        bandRecordingsBySongId[band.id] = recordingsBySongId;

        try {
          const images = await dataClient.bandPressKitImages.list(band.id);
          bandPressKitImagesByBandId[band.id] = images
            .map((image) => ({ id: image.id, title: image.title, url: image.url, mimeType: image.mimeType }))
            .filter((image) => image.url.length > 0);
        } catch {
          bandPressKitImagesByBandId[band.id] = [];
        }
      }));

      const blob = await buildSongbookExportZip({
        bands,
        bandSongsByBandId,
        bandSongListsByBandId,
        bandSetlistsByBandId,
        bandInputListsByBandId,
        bandPressKitsByBandId,
        bandPressKitImagesByBandId,
        bandRecordingsBySongId,
      });
      triggerSongbookExportDownload(blob);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export your data.';
      toast.error(message);
    } finally {
      setBusyExport(false);
    }
  };

  const handleCreateFirstBand = async (e: FormEvent) => {
    e.preventDefault();
    const name = newBandName.trim();
    if (!name || busyCreateBand) return;
    setBusyCreateBand(true);
    const result = await createBand(name, undefined, undefined);
    setBusyCreateBand(false);
    if (result.bandId) {
      writeStoredString('gigboy-active-band-id', result.bandId);
      navigate(`/bands/${result.bandId}/library`, { state: { bandId: result.bandId } });
    } else if (result.error) {
      toast.error(result.error);
    }
  };

  return (
    <section className="profile-settings-page profile-settings-page--account">
      {!bandsLoading && bands.length === 0 && (
        <div className="profile-welcome-card profile-welcome-card--highlight">
          <div className="profile-welcome-card-icon">
            <Sparkles size={22} />
          </div>
          <h2>Welcome to Gigboy!</h2>
          <p>
            Gigboy is your digital songbook for musicians. Add songs in ChordPro format,
            organize them into setlists, and use concert mode on stage.
          </p>
          <p className="profile-welcome-card-cta">
            👉 Start by naming your first workspace — solo artist or full band, either works.
          </p>
          <form className="profile-welcome-card-form" onSubmit={handleCreateFirstBand}>
            <input
              type="text"
              value={newBandName}
              onChange={(e) => setNewBandName(e.target.value)}
              placeholder="Band or artist name..."
              aria-label="Band or artist name"
              disabled={busyCreateBand}
              autoFocus
            />
            <button type="submit" disabled={busyCreateBand || !newBandName.trim()}>
              {busyCreateBand ? 'Creating…' : 'Create workspace'}
            </button>
          </form>
        </div>
      )}
      <header className="profile-account-hero">
        <div className="profile-account-hero-main">
          <UserAvatar label={displayName} size="lg" />
          <div className="profile-account-hero-copy">
            <h1>{displayName}</h1>
            <p>@{user.username ?? 'setup'} · {user.email}</p>
            <button
              type="button"
              className="setlist-action-btn setlist-action-btn--ghost profile-logout-btn"
              disabled={busyLogout}
              onClick={() => { void onLogout(); }}
            >
              <LogOut size={16} /> {busyLogout ? 'Signing out…' : 'Log out'}
            </button>
          </div>
        </div>
      </header>

      <div className="profile-account-grid">
        <section className="profile-settings-card profile-settings-card--wide">
          <div className="profile-section-heading">
            <div>
              <h2>Account information</h2>
              <p className="profile-settings-muted">Keep your public profile and login details current.</p>
            </div>
          </div>
          <form className="profile-settings-form profile-settings-form--inline" onSubmit={onFullNameSubmit}>
            <label className="form-field">
              <span>Full name</span>
              <input
                type="text"
                value={fullName}
                autoComplete="name"
                onChange={(event) => setFullName(event.target.value)}
                required
                maxLength={80}
              />
            </label>
            <button type="submit" className="setlist-action-btn profile-settings-save-btn" disabled={busyFullName}>
              {busyFullName ? 'Saving…' : 'Save'}
            </button>
          </form>
          <form className="profile-settings-form profile-settings-form--inline" onSubmit={onUsernameSubmit}>
            <label className="form-field">
              <span>Username</span>
              <input
                type="text"
                value={username}
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>
            <button type="submit" className="setlist-action-btn profile-settings-save-btn" disabled={busyUsername}>
              {busyUsername ? 'Saving…' : 'Save'}
            </button>
          </form>
          <form className="profile-settings-form profile-settings-form--inline" onSubmit={onEmailSubmit}>
            <label className="form-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <button type="submit" className="setlist-action-btn profile-settings-save-btn" disabled={busyEmail}>
              {busyEmail ? 'Saving…' : 'Save'}
            </button>
          </form>
          <form className="profile-settings-form profile-settings-form--inline" onSubmit={onPasswordSubmit}>
            <label className="form-field">
              <span>Current password</span>
              <input
                type="password"
                value={currentPassword}
                autoComplete="current-password"
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>New password</span>
              <input
                type="password"
                value={newPassword}
                autoComplete="new-password"
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={8}
                required
              />
            </label>
            <button type="submit" className="setlist-action-btn profile-settings-save-btn" disabled={busyPassword}>
              {busyPassword ? 'Saving…' : 'Change password'}
            </button>
          </form>
        </section>

        <section className="profile-settings-card">
          <div className="profile-section-heading">
            <div>
              <h2>Export your data</h2>
              <p className="profile-settings-muted">Download your whole songbook — every band you belong to — as plain ChordPro files. Yours to keep, no matter what.</p>
            </div>
          </div>
          <button
            type="button"
            className="setlist-action-btn"
            disabled={busyExport}
            onClick={() => { void handleExportData(); }}
          >
            <Download size={16} /> {busyExport ? 'Preparing export…' : 'Export as ZIP'}
          </button>
        </section>

        <section className="profile-settings-card profile-danger-card">
          <div className="profile-section-heading">
            <div>
              <h2>Danger zone</h2>
              <p className="profile-settings-muted">Permanently delete your account and all bands you own.</p>
            </div>
          </div>

          <div className="profile-account-danger-zone" aria-label="Account danger zone">
            <p className="profile-settings-muted">Deleting your account permanently removes owned bands and profile data.</p>

            {!deleteConfirmOpen ? (
              <button
                type="button"
                className="setlist-action-btn setlist-action-btn--danger"
                onClick={onStartDeleteAccount}
              >
                <Trash2 size={16} /> Delete account
              </button>
            ) : (
              <div className="profile-account-delete-confirm">
                <label className="profile-account-delete-check">
                  <input
                    type="checkbox"
                    checked={deleteStepOneConfirmed}
                    onChange={(event) => setDeleteStepOneConfirmed(event.target.checked)}
                    disabled={busyDeleteAccount}
                  />
                  <span>I understand this action permanently deletes my account and all bands I own.</span>
                </label>

                <label className="form-field">
                  <span>Type <strong>DELETE MY ACCOUNT</strong> to confirm</span>
                  <input
                    type="text"
                    value={deleteStepTwoPhrase}
                    onChange={(event) => setDeleteStepTwoPhrase(event.target.value)}
                    placeholder="DELETE MY ACCOUNT"
                    autoComplete="off"
                    disabled={busyDeleteAccount}
                  />
                </label>

                <div className="profile-danger-actions">
                  <button
                    type="button"
                    className="setlist-action-btn setlist-action-btn--danger"
                    disabled={busyDeleteAccount || !deleteStepOneConfirmed || !deletePhraseMatches}
                    onClick={() => { void onDeleteAccount(); }}
                  >
                    <Trash2 size={16} /> {busyDeleteAccount ? 'Deleting…' : 'Delete account permanently'}
                  </button>
                  <button
                    type="button"
                    className="setlist-action-btn setlist-action-btn--secondary"
                    disabled={busyDeleteAccount}
                    onClick={onCancelDeleteAccount}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
