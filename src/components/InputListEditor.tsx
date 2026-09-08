import { useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Trash2, PenLine, ClipboardList } from 'lucide-react';
import type { InputList } from '../types';
import { showConfirmToast } from '../utils/toastDialogs';
import { TECH_RIDER_ICON_OPTIONS } from '../lib/iconOptions';

interface Props {
  rider: InputList;
  canEdit: boolean;
  showHeader?: boolean;
  onRename: (name: string) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  onUpdateIcon: (icon?: string) => Promise<void> | void;
  onSaveContent: (params: {
    hospitalityNotes: string;
    logisticsNotes: string;
  }) => Promise<void> | void;
  onCopyPublicLink: () => Promise<void> | void;
}

function normalizeEmojiIcon(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return [...trimmed].slice(0, 2).join('');
}

export default function InputListEditor({
  rider,
  canEdit,
  showHeader = true,
  onRename,
  onDelete,
  onUpdateIcon,
  onSaveContent,
  onCopyPublicLink,
}: Props) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(rider.name);
  const [hospitalityNotes, setHospitalityNotes] = useState(rider.hospitalityNotes ?? '');
  const [logisticsNotes, setLogisticsNotes] = useState(rider.logisticsNotes ?? '');
  const [showIconEditor, setShowIconEditor] = useState(false);
  const [iconDraft, setIconDraft] = useState(rider.icon ?? '🎤');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveStateResetTimerRef = useRef<number | null>(null);
  const saveRequestIdRef = useRef(0);
  const iconPickerRef = useRef<HTMLDivElement | null>(null);
  const iconTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Reset ALL local state when the active rider changes (different id).
  const prevRiderIdRef = useRef(rider.id);
  useEffect(() => {
    if (prevRiderIdRef.current === rider.id) return;
    prevRiderIdRef.current = rider.id;
    setRenameValue(rider.name);
    setHospitalityNotes(rider.hospitalityNotes ?? '');
    setLogisticsNotes(rider.logisticsNotes ?? '');
    setIconDraft(rider.icon ?? '🎤');
    setSaveState('idle');
    setShowIconEditor(false);
  }, [rider.id, rider.icon, rider.name, rider.hospitalityNotes, rider.logisticsNotes]);

  useEffect(() => {
    return () => {
      if (saveStateResetTimerRef.current !== null) {
        window.clearTimeout(saveStateResetTimerRef.current);
      }
    };
  }, []);

  // Keep the rename input in sync when a rename is committed externally.
  useEffect(() => {
    if (!isRenaming) setRenameValue(rider.name);
  }, [isRenaming, rider.name]);

  useEffect(() => {
    if (!showIconEditor) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (iconPickerRef.current?.contains(target)) return;
      if (iconTriggerRef.current?.contains(target)) return;
      setShowIconEditor(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowIconEditor(false);
      iconTriggerRef.current?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showIconEditor]);

  useEffect(() => {
    setIconDraft(rider.icon ?? '🎤');
  }, [rider.icon]);

  const hasChanges = useMemo(() => {
    return hospitalityNotes !== (rider.hospitalityNotes ?? '') || logisticsNotes !== (rider.logisticsNotes ?? '');
  }, [hospitalityNotes, logisticsNotes, rider.hospitalityNotes, rider.logisticsNotes]);

  const handleRenameCommit = async () => {
    const trimmed = renameValue.trim().slice(0, 150);
    if (!trimmed) {
      setRenameValue(rider.name);
      setIsRenaming(false);
      return;
    }

    if (trimmed !== rider.name) {
      await onRename(trimmed);
    }
    setIsRenaming(false);
  };

  // Autosave with debounce whenever content changes.
  useEffect(() => {
    if (!canEdit || !hasChanges) return;

    setSaveState('saving');
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;

    const timer = setTimeout(() => {
      void Promise.resolve(onSaveContent({ hospitalityNotes, logisticsNotes }))
        .then(() => {
          if (requestId !== saveRequestIdRef.current) return;
          setSaveState('saved');
          if (saveStateResetTimerRef.current !== null) {
            window.clearTimeout(saveStateResetTimerRef.current);
          }
          saveStateResetTimerRef.current = window.setTimeout(() => {
            setSaveState((current) => (current === 'saved' ? 'idle' : current));
          }, 1800);
        })
        .catch(() => {
          if (requestId !== saveRequestIdRef.current) return;
          setSaveState('error');
        });
    }, 1000);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalityNotes, logisticsNotes]);

  // Warn before leaving the page while an edit hasn't been autosaved yet.
  useEffect(() => {
    if (!canEdit) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasChanges && saveState !== 'saving') return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [canEdit, hasChanges, saveState]);

  const saveStatusLabel = saveState === 'saving'
    ? 'Autosaving…'
    : saveState === 'saved'
      ? 'All changes saved'
      : saveState === 'error'
        ? 'Autosave failed'
        : 'Autosave on';

  const saveStatusClassName = saveState === 'saving'
    ? 'notes-save-status notes-save-status--saving'
    : saveState === 'saved'
      ? 'notes-save-status notes-save-status--saved'
      : saveState === 'error'
        ? 'notes-save-status notes-save-status--error'
        : 'notes-save-status notes-save-status--idle';

  const handleDeleteRider = async () => {
    if (!onDelete) return;
    const confirmed = await showConfirmToast(`Move rider "${rider.name}" to trash?`, {
      confirmLabel: 'Move to trash',
    });
    if (!confirmed) return;
    await onDelete();
  };

  return (
    <>
      {showHeader ? (
        <div className="list-sticky-header">
          <div className="page-section-header resource-header">
            <div className="setlist-title-block">
              {isRenaming ? (
                <input
                  type="text"
                  value={renameValue}
                  maxLength={150}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleRenameCommit();
                    if (event.key === 'Escape') {
                      setRenameValue(rider.name);
                      setIsRenaming(false);
                    }
                  }}
                  onBlur={() => void handleRenameCommit()}
                  className="setlist-name-input"
                />
              ) : (
                <div className="song-list-title-row">
                  <h1 className="resource-title setlist-title resource-title--setlist">
                    {canEdit ? (
                      <div className="icon-picker-wrapper" ref={iconPickerRef}>
                        <button
                          ref={iconTriggerRef}
                          type="button"
                          className={`icon-picker-trigger${showIconEditor ? ' is-open' : ''}`}
                          aria-haspopup="dialog"
                          aria-expanded={showIconEditor}
                          onClick={(e) => { e.stopPropagation(); setShowIconEditor((v) => !v); }}
                          title="Change rider icon"
                          aria-label="Change rider icon"
                        >
                          <span className="resource-title-icon" aria-hidden="true">{rider.icon ?? '🎤'}</span>
                        </button>
                        {showIconEditor && (
                          <div className="icon-picker-popover" role="dialog" aria-label="Choose rider icon">
                            <div className="emoji-choice-grid" role="radiogroup" aria-label="Rider icon options">
                              <button
                                type="button"
                                className={`emoji-choice-btn${!rider.icon ? ' active' : ''}`}
                                onClick={() => { void onUpdateIcon(undefined); setIconDraft('🎤'); setShowIconEditor(false); }}
                                aria-pressed={!rider.icon}
                              >
                                <ClipboardList size={16} />
                              </button>
                              {TECH_RIDER_ICON_OPTIONS.map((emoji) => {
                                const selected = iconDraft === emoji;
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    className={`emoji-choice-btn${selected ? ' active' : ''}`}
                                    onClick={() => { void onUpdateIcon(normalizeEmojiIcon(emoji)); setIconDraft(emoji); setShowIconEditor(false); }}
                                    aria-pressed={selected}
                                  >
                                    {emoji}
                                  </button>
                                );
                              })}
                            </div>
                            <button
                              type="button"
                              className="icon-picker-reset-btn"
                              onClick={() => { void onUpdateIcon(undefined); setIconDraft('🎤'); setShowIconEditor(false); }}
                            >
                              Reset to default
                            </button>
                          </div>
                        )}
                      </div>
                    ) : rider.icon ? (
                      <span className="resource-title-icon" aria-hidden="true">{rider.icon}</span>
                    ) : null}
                    {rider.name}
                  </h1>
                  {canEdit ? (
                    <button type="button" className="title-rename-btn" onClick={() => setIsRenaming(true)} title="Rename rider">
                      <PenLine size={14} />
                    </button>
                  ) : null}
                </div>
              )}
              <div className="autosave-status-row">
                {canEdit ? (
                  <span className={saveStatusClassName} aria-live="polite">{saveStatusLabel}</span>
                ) : null}
              </div>
            </div>
            <div className="resource-header-actions">
              <button
                type="button"
                className="btn btn--accent"
                onClick={() => void onCopyPublicLink()}
                title={rider.publicShareEnabled ? 'Copy public link' : 'Create & copy public link'}
              >
                <Link2 size={14} />
              </button>
              {canEdit ? (
                <>
                  {onDelete ? (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => void handleDeleteRider()}
                      title={`Delete rider ${rider.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>


        </div>
      ) : null}

      <section className="technical-rider-section">
        <div className="technical-rider-section-header">
          <h2>Logistics</h2>
        </div>
        {canEdit ? (
          <textarea
            className="technical-rider-notes-input"
            value={logisticsNotes}
            onChange={(event) => setLogisticsNotes(event.target.value)}
            placeholder="Load-in time, parking, on-site contact, power requirements, etc."
            rows={5}
          />
        ) : (
          <p className="technical-rider-notes-view">{logisticsNotes || 'No logistics notes provided.'}</p>
        )}
      </section>

      <section className="technical-rider-section">
        <div className="technical-rider-section-header">
          <h2>Hospitality</h2>
        </div>
        {canEdit ? (
          <textarea
            className="technical-rider-notes-input"
            value={hospitalityNotes}
            onChange={(event) => setHospitalityNotes(event.target.value)}
            placeholder="Catering, green room, drink/rider requests, etc."
            rows={5}
          />
        ) : (
          <p className="technical-rider-notes-view">{hospitalityNotes || 'No hospitality notes provided.'}</p>
        )}
      </section>
    </>
  );
}
