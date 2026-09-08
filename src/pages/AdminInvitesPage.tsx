import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, UserPlus } from 'lucide-react';
import toast from '../utils/anchoredToast';
import { dataClient } from '../lib/dataClient';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import type { UserInvite } from '../lib/dataClient/types';

/**
 * Admin-only page for generating invite links so new accounts can join. Self-host has no open
 * self-registration — this is the only way to bring new users in besides a direct API call.
 * Mirrors `server/routes/invites.ts`'s `adminInvitesRouter`, which rejects non-admins with 403.
 */
export default function AdminInvitesPage() {
  useDocumentTitle('Invites (admin)');

  const [invites, setInvites] = useState<UserInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [busyCreate, setBusyCreate] = useState(false);
  const [busyRevokeId, setBusyRevokeId] = useState<string | null>(null);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);

  const refreshInvites = useCallback(async () => {
    setLoading(true);
    try {
      setInvites(await dataClient.adminInvites.list());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load invites.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshInvites();
  }, [refreshInvites]);

  const handleCreateInvite = async (e: FormEvent) => {
    e.preventDefault();
    setBusyCreate(true);
    try {
      const result = await dataClient.adminInvites.create({
        email: email.trim() || undefined,
      });
      setLastInviteLink(result.inviteUrl);
      setEmail('');
      await refreshInvites();
      try {
        await navigator.clipboard.writeText(result.inviteUrl);
        toast.success('Invite link created and copied to clipboard.');
      } catch {
        toast.success('Invite link created. Copy it from the field below.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create invite.';
      toast.error(message);
    } finally {
      setBusyCreate(false);
    }
  };

  const handleCopyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Invite link copied to clipboard.');
    } catch {
      toast.error('Could not copy the link. Select and copy it manually.');
    }
  };

  const handleRevoke = async (invite: UserInvite) => {
    setBusyRevokeId(invite.id);
    try {
      await dataClient.adminInvites.revoke(invite.id);
      setInvites((prev) => prev.filter((entry) => entry.id !== invite.id));
      toast.success('Invite revoked.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revoke invite.';
      toast.error(message);
    } finally {
      setBusyRevokeId(null);
    }
  };

  const inviteLinkFor = (invite: UserInvite) => `${window.location.origin}/invite/${invite.id}`;

  return (
    <section className="profile-invites-page">
      <header className="profile-invites-header">
        <h1>Invites</h1>
        <p>Generate invite links so new users can create an account. Self-host has no open registration.</p>
      </header>

      <nav className="admin-tabs">
        <Link to="/admin/invites" className="active" aria-current="page">Invites</Link>
        <Link to="/admin/users">Users</Link>
      </nav>

      <section className="profile-invites-section">
        <h2>Create an invite</h2>
        <form className="bands-invite-form" onSubmit={(e) => void handleCreateInvite(e)}>
          <label className="share-menu-field">
            <span>Email (optional — leave blank for a link anyone can use)</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              disabled={busyCreate}
            />
          </label>
          <button type="submit" className="btn btn--primary" disabled={busyCreate}>
            <UserPlus size={15} /> {busyCreate ? 'Creating link…' : 'Create invite link'}
          </button>
        </form>

        {lastInviteLink ? (
          <label className="share-menu-field" style={{ marginTop: '0.75rem' }}>
            <span>Invite link (expires in 7 days)</span>
            <div className="share-menu-input-wrap">
              <input type="text" value={lastInviteLink} readOnly />
              <button
                type="button"
                className="share-menu-input-action"
                onClick={() => void handleCopyLink(lastInviteLink)}
                title="Copy invite link"
                aria-label="Copy invite link"
              >
                <Copy size={15} />
              </button>
            </div>
          </label>
        ) : null}
      </section>

      <section className="profile-invites-section">
        <h2>Pending invites</h2>
        {loading ? (
          <p className="profile-invites-status">Loading invites…</p>
        ) : invites.length === 0 ? (
          <p className="profile-invites-status">No pending invites.</p>
        ) : (
          <ul className="profile-invites-list">
            {invites.map((invite) => {
              const busy = busyRevokeId === invite.id;
              return (
                <li key={invite.id} className="profile-invite-card">
                  <div className="profile-invite-main">
                    <strong>{invite.email ?? 'Any email'}</strong>
                    <span>
                      {invite.role === 'admin' ? 'Admin' : 'Member'} · expires{' '}
                      {new Date(invite.expiresAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="profile-invite-actions">
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => void handleCopyLink(inviteLinkFor(invite))}
                      title="Copy invite link"
                    >
                      <Copy size={15} /> Copy link
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={busy}
                      onClick={() => void handleRevoke(invite)}
                    >
                      {busy ? 'Working…' : 'Revoke'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
