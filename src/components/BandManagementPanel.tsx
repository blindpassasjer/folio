import { useState } from 'react';
import { Copy, Share2, UserPlus } from 'lucide-react';
import toast from '../utils/anchoredToast';
import { useAuth } from '../context/AuthContext';
import { useBands } from '../context/BandsContext';
import UserAvatar from './UserAvatar';
import { dataClient } from '../lib/dataClient';
import type { Band } from '../types';

interface BandManagementPanelProps {
  band: Band;
  canEditBand: boolean;
  isOwner: boolean;
  showLeaveCurrentUser?: boolean;
  onLeaveCurrentUser?: () => Promise<string | null>;
  onLeaveSuccess?: () => void;
}

export default function BandManagementPanel({
  band,
  canEditBand,
  isOwner,
  showLeaveCurrentUser = false,
  onLeaveCurrentUser,
  onLeaveSuccess,
}: BandManagementPanelProps) {
  const { user } = useAuth();
  const { removeMember } = useBands();

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [busyInviteLink, setBusyInviteLink] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [lastInviteLinkExpiresAt, setLastInviteLinkExpiresAt] = useState<string | null>(null);

  const handleRemoveMember = async (memberId: string) => {
    setBusyMemberId(memberId);
    const error = await removeMember(band.id, memberId);
    setBusyMemberId(null);

    if (error) {
      toast.error(error);
      return;
    }

    toast.success('Member removed.');
  };

  const handleCreateInviteLink = async () => {
    if (!user?.id || !user.email) {
      toast.error('You need to be signed in to create invite links.');
      return;
    }

    setBusyInviteLink(true);
    try {
      const result = await dataClient.bands.createInviteLink(band.id);

      setLastInviteLink(result.inviteUrl);
      setLastInviteLinkExpiresAt(result.expiresAt ?? null);
      try {
        await navigator.clipboard.writeText(result.inviteUrl);
        toast.success('Invite link copied to clipboard.');
      } catch {
        toast.success('Invite link created. Copy it from the field below.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create invite link.';
      toast.error(message);
    } finally {
      setBusyInviteLink(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!lastInviteLink) return;
    try {
      await navigator.clipboard.writeText(lastInviteLink);
      toast.success('Invite link copied to clipboard.');
    } catch {
      toast.error('Could not copy the link. Select and copy it manually.');
    }
  };

  const handleShareInviteLink = async () => {
    if (!lastInviteLink) return;
    try {
      await navigator.share({
        title: `Join ${band.name} on Gigboy`,
        text: `You're invited to join ${band.name} on Gigboy.`,
        url: lastInviteLink,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      toast.error('Could not open sharing options.');
    }
  };

  const handleLeaveBand = async () => {
    if (!onLeaveCurrentUser) return;

    setBusyMemberId(user?.id ?? 'self');
    const error = await onLeaveCurrentUser();
    setBusyMemberId(null);

    if (error) {
      toast.error(error);
      return;
    }

    toast.success('You left the band.');
    onLeaveSuccess?.();
  };

  return (
    <section className="bands-panel">
      <h3>Band management</h3>
      <div className="bands-invite-form">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canEditBand || busyInviteLink}
          onClick={() => { void handleCreateInviteLink(); }}
        >
          <UserPlus size={15} /> {busyInviteLink ? 'Creating link...' : 'Create invite link'}
        </button>
      </div>
      {lastInviteLink ? (
        <label className="share-menu-field" style={{ marginTop: '0.75rem' }}>
          <span>Invite link (share with as many bandmates as you like)</span>
          <div className="share-menu-input-wrap">
            <input type="text" value={lastInviteLink} readOnly />
            <button
              type="button"
              className="share-menu-input-action"
              onClick={() => void handleCopyInviteLink()}
              title="Copy invite link"
              aria-label="Copy invite link"
            >
              <Copy size={15} />
            </button>
            {canNativeShare ? (
              <button
                type="button"
                className="share-menu-input-action"
                onClick={() => void handleShareInviteLink()}
                title="Share invite link"
                aria-label="Share invite link"
              >
                <Share2 size={15} />
              </button>
            ) : null}
          </div>
          {lastInviteLinkExpiresAt ? (
            <span style={{ fontSize: '0.8em', color: 'var(--color-text-muted, #888)', marginTop: '0.25rem' }}>
              Expires {new Date(lastInviteLinkExpiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
          ) : null}
        </label>
      ) : null}

      <h3 style={{ marginTop: '1rem' }}>Members</h3>
      <ul className="bands-members-list">
        {band.memberIds.map((memberId) => {
          const roleLabel = band.ownerId === memberId ? 'owner' : 'member';
          const username = band.memberUsernames[memberId] ?? null;
          const email = band.memberEmails[memberId] ?? 'No email saved';
          const fullName = band.memberFullNames[memberId] ?? null;
          const canRemove = isOwner && memberId !== band.ownerId;
          const isCurrentUser = memberId === user?.id;

          return (
            <li key={memberId} className="bands-member-card">
              <UserAvatar label={fullName || username || email} size="md" />
              <div className="bands-member-copy">
                <strong>{username ?? email}</strong>
                <span>{username ? email : ''}</span>
                <span>{roleLabel}</span>
              </div>
              <div className="bands-member-actions">
                {canRemove ? (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={busyMemberId === memberId}
                    onClick={() => void handleRemoveMember(memberId)}
                  >
                    {busyMemberId === memberId ? 'Working...' : 'Remove'}
                  </button>
                ) : null}
                {showLeaveCurrentUser && !isOwner && isCurrentUser ? (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={busyMemberId === memberId}
                    onClick={() => { void handleLeaveBand(); }}
                  >
                    {busyMemberId === memberId ? 'Working...' : 'Leave band'}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}