import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Song } from '../types';
import { loadSongRevisions, restoreSongRevision, type SongRevision } from '../lib/songRevisions';
import { diffLines, fieldChanges } from '../utils/textDiff';
import { showConfirmToast } from '../utils/toastDialogs';
import toast from '../utils/anchoredToast';

interface Props {
  bandId: string;
  song: Song;
  canRestore: boolean;
  /** Called after a successful restore with the updated song. */
  onRestored: (song: Song) => void;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SongHistoryPanel({ bandId, song, canRestore, onRestored }: Props) {
  const [revisions, setRevisions] = useState<SongRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    loadSongRevisions(bandId, song.id)
      .then((rows) => setRevisions(rows))
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load history.'))
      .finally(() => setLoading(false));
  }, [bandId, song.id]);

  useEffect(refresh, [refresh]);

  const selectedIndex = useMemo(
    () => revisions.findIndex((r) => r.id === selectedId),
    [revisions, selectedId],
  );
  const selected = selectedIndex >= 0 ? revisions[selectedIndex] : null;
  // Revisions are newest-first, so the "previous" version is the next index.
  const previous = selectedIndex >= 0 ? revisions[selectedIndex + 1] ?? null : null;

  const lyricDiff = useMemo(() => {
    if (!selected) return null;
    const before = String(previous?.snapshot.chordpro ?? '');
    const after = String(selected.snapshot.chordpro ?? '');
    if (before === after) return null;
    return diffLines(before, after);
  }, [selected, previous]);

  const metaChanges = useMemo(() => {
    if (!selected) return [];
    return fieldChanges(previous?.snapshot ?? {}, selected.snapshot);
  }, [selected, previous]);

  const handleRestore = useCallback(
    async (revision: SongRevision) => {
      const ok = await showConfirmToast(
        `Restore this version from ${relativeTime(revision.createdAt)}? The current version is kept in history.`,
        { confirmLabel: 'Restore' },
      );
      if (!ok) return;
      setRestoringId(revision.id);
      try {
        const updated = await restoreSongRevision(bandId, song.id, revision.id);
        onRestored(updated);
        toast.success('Version restored.');
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to restore.');
      } finally {
        setRestoringId(null);
      }
    },
    [bandId, song.id, onRestored, refresh],
  );

  if (loading) return <p className="song-history-empty">Loading history…</p>;
  if (revisions.length === 0) return <p className="song-history-empty">No edit history yet.</p>;

  return (
    <div className="song-history">
      <ol className="song-history-list">
        {revisions.map((revision, i) => (
          <li key={revision.id}>
            <button
              type="button"
              className={`song-history-item${revision.id === selectedId ? ' song-history-item--active' : ''}`}
              onClick={() => setSelectedId((cur) => (cur === revision.id ? null : revision.id))}
            >
              <span className="song-history-item-main">
                <strong>{revision.editorDisplayName || 'Someone'}</strong>
                <span className="song-history-item-changed">
                  {i === revisions.length - 1 && revision.changed[0] === 'Created'
                    ? 'created the song'
                    : revision.changed.length
                      ? `changed ${revision.changed.join(', ')}`
                      : 'saved (no changes)'}
                </span>
              </span>
              <span className="song-history-item-time">{relativeTime(revision.createdAt)}</span>
            </button>
            {revision.id === selectedId && (
              <div className="song-history-detail">
                {metaChanges.length > 0 && (
                  <table className="song-history-fields">
                    <tbody>
                      {metaChanges.map((change) => (
                        <tr key={change.label}>
                          <th>{change.label}</th>
                          <td className="song-history-before">{change.before}</td>
                          <td className="song-history-after">{change.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {lyricDiff && (
                  <pre className="song-history-diff">
                    {lyricDiff.map((op, idx) => (
                      <span key={idx} className={`song-history-diff-line song-history-diff-line--${op.type}`}>
                        {op.type === 'add' ? '+ ' : op.type === 'del' ? '- ' : '  '}
                        {op.text || ' '}
                        {'\n'}
                      </span>
                    ))}
                  </pre>
                )}
                {!lyricDiff && metaChanges.length === 0 && (
                  <p className="song-history-empty">No field-level differences from the previous version.</p>
                )}
                {canRestore && i !== 0 && (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => { void handleRestore(revision); }}
                    disabled={restoringId === revision.id}
                  >
                    <RotateCcw size={13} /> {restoringId === revision.id ? 'Restoring…' : 'Restore this version'}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
