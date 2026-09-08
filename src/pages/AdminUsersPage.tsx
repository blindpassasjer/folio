import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import toast from '../utils/anchoredToast';
import { dataClient } from '../lib/dataClient';
import { useAuth } from '../context/AuthContext';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import type { AdminUserListing } from '../lib/dataClient/types';

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024)).toLocaleString()} MB`;
}

/**
 * Admin-only page listing all users with their storage usage and letting an admin assign a
 * per-user storage quota override. Mirrors `server/routes/adminUsers.ts`'s `adminUsersRouter`,
 * which rejects non-admins with 403. Quota is enforced server-side (see
 * server/lib/storageQuota.ts) against the total usage of bands the user owns.
 */
export default function AdminUsersPage() {
  useDocumentTitle('Users (admin)');

  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUserListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const refreshUsers = useCallback(async () => {
    setLoading(true);
    try {
      const list = await dataClient.adminUsers.list();
      setUsers(list);
      setDrafts(Object.fromEntries(list.map((u) => [u.id, String(Math.round(u.storageQuotaBytes / (1024 * 1024)))])));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load users.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUsers();
  }, [refreshUsers]);

  const handleSaveQuota = async (user: AdminUserListing) => {
    const draft = drafts[user.id] ?? '';
    const mb = Number(draft);
    if (!Number.isFinite(mb) || mb <= 0) {
      toast.error('Enter a quota in MB greater than 0.');
      return;
    }
    setBusyId(user.id);
    try {
      const bytes = Math.round(mb * 1024 * 1024);
      await dataClient.adminUsers.setQuota(user.id, bytes);
      toast.success(`Quota updated for ${user.email}.`);
      await refreshUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update quota.';
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  };

  const handleResetQuota = async (user: AdminUserListing) => {
    setBusyId(user.id);
    try {
      await dataClient.adminUsers.setQuota(user.id, null);
      toast.success(`Quota reset to default for ${user.email}.`);
      await refreshUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset quota.';
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleRole = async (user: AdminUserListing) => {
    const nextRole = user.role === 'admin' ? 'member' : 'admin';
    setBusyId(user.id);
    try {
      await dataClient.adminUsers.setRole(user.id, nextRole);
      toast.success(nextRole === 'admin' ? `${user.email} is now an admin.` : `${user.email} is now a member.`);
      await refreshUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update role.';
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteUser = async (user: AdminUserListing) => {
    if (deleteConfirmText.trim().toLowerCase() !== user.email.toLowerCase()) return;
    setBusyId(user.id);
    try {
      await dataClient.adminUsers.remove(user.id);
      toast.success(`Deleted ${user.email} and all their files.`);
      setConfirmDeleteId(null);
      setDeleteConfirmText('');
      setUsers((prev) => prev.filter((entry) => entry.id !== user.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete user.';
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="profile-invites-page">
      <header className="profile-invites-header">
        <h1>Users</h1>
        <p>
          All accounts on this instance, with storage used across bands they own, their assigned quota, and
          site-wide admin access (unrelated to band ownership — whoever creates a band owns it, always).
        </p>
      </header>

      <nav className="admin-tabs">
        <Link to="/admin/invites">Invites</Link>
        <Link to="/admin/users" className="active" aria-current="page">Users</Link>
      </nav>

      <section className="profile-invites-section">
        <h2>All users</h2>
        {loading ? (
          <p className="profile-invites-status">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="profile-invites-status">No users found.</p>
        ) : (
          <ul className="profile-invites-list">
            {users.map((user) => {
              const busy = busyId === user.id;
              const isSelf = user.id === currentUser?.id;
              const confirming = confirmDeleteId === user.id;
              return (
                <li key={user.id} className={confirming ? 'profile-invite-card profile-invite-card--stacked' : 'profile-invite-card'}>
                  <div className="profile-invite-main">
                    <strong>{user.fullName || user.username || user.email}</strong>
                    <span>
                      {user.email} · {user.role === 'admin' ? 'Admin' : 'Member'} · owns {user.ownedBandCount}{' '}
                      {user.ownedBandCount === 1 ? 'band' : 'bands'} · using {formatMb(user.usedBytes)} of{' '}
                      {formatMb(user.storageQuotaBytes)}
                      {user.hasCustomQuota ? '' : ' (default)'}
                    </span>
                  </div>
                  {confirming ? (
                    <div className="admin-user-delete-confirm">
                      <label className="share-menu-field">
                        <span>Type <strong>{user.email}</strong> to permanently delete this user and all their files</span>
                        <input
                          type="text"
                          value={deleteConfirmText}
                          onChange={(e) => setDeleteConfirmText(e.target.value)}
                          placeholder={user.email}
                          disabled={busy}
                          autoFocus
                        />
                      </label>
                      <div className="admin-user-delete-confirm-actions">
                        <button
                          type="button"
                          className="btn btn--danger"
                          disabled={busy || deleteConfirmText.trim().toLowerCase() !== user.email.toLowerCase()}
                          onClick={() => void handleDeleteUser(user)}
                        >
                          {busy ? 'Deleting…' : 'Delete permanently'}
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary"
                          disabled={busy}
                          onClick={() => {
                            setConfirmDeleteId(null);
                            setDeleteConfirmText('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="profile-invite-actions">
                      <div className="admin-user-quota">
                        <input
                          type="number"
                          min={1}
                          value={drafts[user.id] ?? ''}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [user.id]: e.target.value }))}
                          disabled={busy}
                          aria-label={`Storage quota in MB for ${user.email}`}
                        />
                        <span>MB</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn--secondary"
                        disabled={busy}
                        onClick={() => void handleSaveQuota(user)}
                      >
                        {busy ? 'Working…' : 'Save'}
                      </button>
                      {user.hasCustomQuota ? (
                        <button
                          type="button"
                          className="btn btn--secondary"
                          disabled={busy}
                          onClick={() => void handleResetQuota(user)}
                        >
                          Reset to default
                        </button>
                      ) : null}
                      {!isSelf && (
                        <button
                          type="button"
                          className="btn btn--secondary"
                          disabled={busy}
                          onClick={() => void handleToggleRole(user)}
                        >
                          {user.role === 'admin' ? 'Remove admin' : 'Make admin'}
                        </button>
                      )}
                      {!isSelf && (
                        <button
                          type="button"
                          className="btn btn--danger"
                          disabled={busy}
                          onClick={() => {
                            setConfirmDeleteId(user.id);
                            setDeleteConfirmText('');
                          }}
                          title="Delete user and all their files"
                          aria-label="Delete user and all their files"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
