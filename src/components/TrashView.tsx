import { useMemo, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import toast from '../utils/anchoredToast';
import { showConfirmToast } from '../utils/toastDialogs';

export interface TrashListItem {
  trashId: string;
  itemType: 'song' | 'songlist' | 'setlist' | 'stageplot' | 'technicalRider' | 'pressKit' | 'pressKitImage' | 'bandLogo' | 'attachment';
  name: string;
  deletedAt: string;
  purgeAt: string;
}

interface Props {
  title: string;
  emptyMessage: string;
  items: TrashListItem[];
  onRestore?: (trashId: string) => Promise<string | null>;
  onDeletePermanently?: (trashId: string) => Promise<string | null>;
  onEmptyTrash?: () => Promise<string | null>;
  headerVariant?: 'default' | 'bands';
}

function formatDate(iso: string) {
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return 'Unknown date';
  return new Date(value).toLocaleString();
}

function labelForType(itemType: TrashListItem['itemType']) {
  if (itemType === 'song') return 'Song';
  if (itemType === 'songlist') return 'Songlist';
  if (itemType === 'stageplot') return 'Stageplot';
  if (itemType === 'technicalRider') return 'Input list';
  if (itemType === 'pressKit') return 'Press kit';
  if (itemType === 'pressKitImage') return 'Press kit image';
  if (itemType === 'bandLogo') return 'Band logo';
  if (itemType === 'attachment') return 'Attachment';
  return 'Setlist';
}

export default function TrashView({
  title,
  emptyMessage,
  items,
  onRestore,
  onDeletePermanently,
  onEmptyTrash,
  headerVariant = 'default',
}: Props) {
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [isEmptyingTrash, setIsEmptyingTrash] = useState(false);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)),
    [items]
  );

  const isBusy = busyItemId !== null || isEmptyingTrash;

  const handleRestore = async (trashId: string) => {
    if (!onRestore) return;
    setBusyItemId(trashId);
    const error = await onRestore(trashId);
    setBusyItemId(null);

    if (error) {
      toast.error(error);
      return;
    }

    toast.success('Item restored.');
  };

  const handleDeletePermanently = async (trashId: string) => {
    if (!onDeletePermanently) return;
    const confirmed = await showConfirmToast('Delete permanently? This cannot be undone.', {
      confirmLabel: 'Delete forever',
    });
    if (!confirmed) return;

    setBusyItemId(trashId);
    const error = await onDeletePermanently(trashId);
    setBusyItemId(null);

    if (error) {
      toast.error(error);
      return;
    }

    toast.success('Item permanently deleted.');
  };

  const handleEmptyTrash = async () => {
    if (!onEmptyTrash || sortedItems.length === 0) return;

    const confirmed = await showConfirmToast(
      `Empty trash and permanently delete ${sortedItems.length} item${sortedItems.length === 1 ? '' : 's'}? This cannot be undone.`,
      {
        confirmLabel: 'Empty trash',
      }
    );
    if (!confirmed) return;

    setIsEmptyingTrash(true);
    const error = await onEmptyTrash();
    setIsEmptyingTrash(false);

    if (error) {
      toast.error(error);
      return;
    }

    toast.success('Trash emptied.');
  };

  return (
    <section className="bands-page bands-page--library trash-page">
      <div className={`${headerVariant === 'bands' ? 'bands-header' : 'page-section-header'} resource-header`}>
        <div className="setlist-title-block">
          <h1 className="resource-title">{title}</h1>
          <p className="song-list-summary">Deleted items are automatically removed after 30 days.</p>
        </div>
        {onEmptyTrash && sortedItems.length > 0 ? (
          <div className="resource-header-actions">
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => void handleEmptyTrash()}
              disabled={isBusy}
            >
              <Trash2 size={14} />
              Empty trash
            </button>
          </div>
        ) : null}
      </div>

      {sortedItems.length === 0 ? (
        <p className="bands-status">{emptyMessage}</p>
      ) : (
        <ul className="trash-list" aria-label="Deleted items">
          {sortedItems.map((item) => (
            <li key={item.trashId} className="trash-list-item">
              <div className="trash-item-copy">
                <p className="trash-item-title">{item.name}</p>
                <p className="trash-item-meta">
                  {labelForType(item.itemType)}
                  {' · '}
                  Deleted {formatDate(item.deletedAt)}
                  {' · '}
                  Expires {formatDate(item.purgeAt)}
                </p>
              </div>
              {onRestore || onDeletePermanently ? (
                <div className="trash-item-actions">
                  {onRestore ? (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => void handleRestore(item.trashId)}
                      disabled={isBusy}
                    >
                      <RotateCcw size={14} />
                      Restore
                    </button>
                  ) : null}
                  {onDeletePermanently ? (
                    <button
                      type="button"
                      className="btn btn--danger"
                      onClick={() => void handleDeletePermanently(item.trashId)}
                      disabled={isBusy}
                    >
                      <Trash2 size={14} />
                      Delete forever
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
