import { Fragment, useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUpDown, ChevronUp, ChevronDown, Trash2, Music, Plus, Search, X, PenLine, Play, Printer, FileText, ListMusic } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Song, SongList } from '../types';
import { useBands } from '../context/BandsContext';
import LanguageBadge from './LanguageBadge';
import SongMetaBadges from './SongMetaBadges';
import toast from '../utils/anchoredToast';
import { showConfirmToast } from '../utils/toastDialogs';
import { SETLIST_ICON_OPTIONS } from '../lib/iconOptions';
import { useSongListBadges } from '../hooks/useSongListBadges';
import { useAuth } from '../context/AuthContext';

interface Props {
  setlistId: string;
  setlistName: string;
  songs: Song[];
  songNotes?: Record<string, string>;
  allSongs: Song[];
  availableSongLists?: SongList[];
  onMoveSong: (songId: string, beforeSongId: string | null) => void;
  onRemoveSong: (songId: string) => void;
  onAddSong: (songId: string) => void | Promise<void>;
  /** Add multiple songs in a single operation (used when adding a whole songlist) */
  onAddSongs?: (songIds: string[]) => void | Promise<void>;
  onUpdateSongNote?: (songId: string, note: string) => void | Promise<void>;
  extraActions?: ReactNode;
  /** Override the concert mode URL (defaults to /bands/:bandId/setlists/:id/concert when bandId is present) */
  concertRoute?: string;
  /** Override the icon displayed for this setlist */
  setlistIconOverride?: string;
  /** Override whether the delete button is shown */
  canDeleteOverride?: boolean;
  /** Whether the current user may rename or change the icon of this setlist (defaults to true) */
  canEdit?: boolean;
  /** Override the rename handler (skips the default band-scoped rename) */
  onRenameOverride?: (name: string) => void;
  /** Override the delete handler (skips the default band-scoped delete) */
  onDeleteOverride?: () => void | Promise<void>;
  /** Override the update-icon handler (skips the default band-scoped icon update) */
  onUpdateIconOverride?: (icon: string | undefined) => void;
  /** Band that owns this setlist — song links carry it as navigation state so SongPage can find band songs */
  bandId: string;
  autoStartRenameToken?: string | number | null;
  /** Controls the header CSS variant. Use 'bands' inside the bands UI to match the songlist header style. */
  headerVariant?: 'default' | 'bands';
}

function normalizeEmojiIcon(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return [...trimmed].slice(0, 2).join('');
}

export default function SetlistsView({
  setlistId,
  setlistName,
  songs,
  songNotes,
  allSongs,
  availableSongLists = [],
  onMoveSong,
  onRemoveSong,
  onAddSong,
  onAddSongs,
  onUpdateSongNote,
  extraActions,
  concertRoute,
  setlistIconOverride,
  canDeleteOverride,
  canEdit = true,
  onRenameOverride,
  onDeleteOverride,
  onUpdateIconOverride,
  bandId,
  autoStartRenameToken = null,
  headerVariant = 'default',
}: Props) {
  const { bandSetlistsByBandId, renameBandSetlist, updateBandSetlistIcon, deleteBandSetlist } = useBands();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const songBadgeCounts = useSongListBadges(songs, bandId, user?.id);
  const currentSetlist = (bandSetlistsByBandId[bandId] ?? []).find((l) => l.id === setlistId);
  const effectiveIcon = setlistIconOverride !== undefined ? setlistIconOverride : currentSetlist?.icon;
  const canDeleteSetlist = canDeleteOverride !== undefined ? canDeleteOverride : true;
  const effectiveConcertRoute = concertRoute
    ?? `/bands/${bandId}/setlists/${setlistId}/concert`;
  const [reorderMode, setReorderMode] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(setlistName);
  const [showSongPicker, setShowSongPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [addingSongListId, setAddingSongListId] = useState<string | null>(null);
  const [showIconEditor, setShowIconEditor] = useState(false);
  const [iconDraft, setIconDraft] = useState(effectiveIcon ?? '');
  const [editingSongNoteId, setEditingSongNoteId] = useState<string | null>(null);
  const [songNoteDraft, setSongNoteDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const iconPickerRef = useRef<HTMLDivElement | null>(null);
  const iconTriggerRef = useRef<HTMLButtonElement | null>(null);

  const startRenaming = useCallback(() => {
    setRenameValue(setlistName);
    setIsRenaming(true);
  }, [setlistName]);

  useEffect(() => {
    setIconDraft(effectiveIcon ?? '');
  }, [effectiveIcon]);

  useEffect(() => {
    setEditingSongNoteId(null);
    setSongNoteDraft('');
  }, [setlistId]);

  const availableSongs = useMemo(() => {
    const songIdsInSetlist = new Set(songs.map((song) => song.id));
    return allSongs
      .filter((song) => !songIdsInSetlist.has(song.id))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [allSongs, songs]);

  const filteredAvailableSongs = useMemo(() => {
    const query = pickerQuery.trim().toLowerCase();
    if (!query) return availableSongs;

    return availableSongs.filter((song) => {
      const inTitle = song.title.toLowerCase().includes(query);
      const inArtist = (song.artist ?? '').toLowerCase().includes(query);
      const inTags = (song.tags ?? []).some((tag) => tag.toLowerCase().includes(query));
      return inTitle || inArtist || inTags;
    });
  }, [availableSongs, pickerQuery]);

  const songListPickerEntries = useMemo(() => {
    const availableSongIds = new Set(availableSongs.map((song) => song.id));
    const query = pickerQuery.trim().toLowerCase();

    return availableSongLists
      .map((songList) => {
        const addableSongIds = songList.songIds.filter((songId) => availableSongIds.has(songId));
        return {
          songList,
          addableSongIds,
        };
      })
      .filter(({ songList, addableSongIds }) => {
        if (addableSongIds.length === 0) return false;
        if (!query) return true;
        return songList.name.toLowerCase().includes(query);
      })
      .sort((a, b) => a.songList.name.localeCompare(b.songList.name));
  }, [availableSongLists, availableSongs, pickerQuery]);

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    if (autoStartRenameToken == null) return;
    startRenaming();
  }, [autoStartRenameToken, startRenaming]);

  useEffect(() => {
    if (!showSongPicker) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSongPicker(false);
        setPickerQuery('');
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showSongPicker]);

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

  const openSongPicker = () => {
    setPickerQuery('');
    setShowSongPicker(true);
  };

  const closeSongPicker = () => {
    setShowSongPicker(false);
    setPickerQuery('');
  };

  const handleAddSongList = async (sourceSongListId: string, songIds: string[]) => {
    if (songIds.length === 0) return;

    setAddingSongListId(sourceSongListId);
    try {
      if (onAddSongs) {
        await Promise.resolve(onAddSongs(songIds));
      } else {
        for (const songId of songIds) {
          await Promise.resolve(onAddSong(songId));
        }
      }
    } finally {
      setAddingSongListId((current) => (current === sourceSongListId ? null : current));
    }
  };

  const startEditingSongNote = (songId: string) => {
    const currentNote = songNotes?.[songId] ?? '';
    setEditingSongNoteId(songId);
    setSongNoteDraft(currentNote);
  };

  const cancelEditingSongNote = () => {
    setEditingSongNoteId(null);
    setSongNoteDraft('');
  };

  const saveSongNote = async (songId: string) => {
    if (!onUpdateSongNote) return;

    try {
      await onUpdateSongNote(songId, songNoteDraft);
      cancelEditingSongNote();
    } catch {
      toast.error('Failed to save song note.');
    }
  };

  const deleteSongNote = async (songId: string) => {
    if (!onUpdateSongNote) return;

    try {
      await onUpdateSongNote(songId, '');
      cancelEditingSongNote();
    } catch {
      toast.error('Failed to delete song note.');
    }
  };

  const handleDeleteSetlist = async () => {
    if (!canDeleteSetlist) {
      toast.error('Only the setlist owner can move this setlist to trash.');
      return;
    }

    if (onDeleteOverride) {
      await onDeleteOverride();
      return;
    }

    const confirmed = await showConfirmToast(`Move setlist "${setlistName}" to trash? It will be automatically deleted after 30 days.`, {
      confirmLabel: 'Move to trash',
    });
    if (!confirmed) return;

    const error = await deleteBandSetlist(bandId, setlistId);
    if (error) toast.error(error);
  };

  const handleRenameCommit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== setlistName) {
      if (onRenameOverride) {
        onRenameOverride(trimmed);
      } else {
        void renameBandSetlist(bandId, setlistId, trimmed).then((error) => {
          if (error) toast.error(error);
        });
      }
    }
    setRenameValue(setlistName);
    setIsRenaming(false);
  };

  const moveSongUp = useCallback((index: number) => {
    if (index === 0) return;
    onMoveSong(songs[index].id, songs[index - 1].id);
  }, [songs, onMoveSong]);

  const moveSongDown = useCallback((index: number) => {
    if (index === songs.length - 1) return;
    onMoveSong(songs[index].id, songs[index + 2]?.id ?? null);
  }, [songs, onMoveSong]);

  return (
    <div className="setlist-view">
      <div className="list-sticky-header">
        <div className={`${headerVariant === 'bands' ? 'bands-header' : 'page-section-header'} resource-header`}>
          <div className="setlist-title-block">
            {isRenaming ? (
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameCommit();
                  if (e.key === 'Escape') {
                    setRenameValue(setlistName);
                    setIsRenaming(false);
                  }
                }}
                onBlur={handleRenameCommit}
                className="setlist-name-input"
              />
            ) : (
              <div className="song-list-title-row">
                <h1 className="resource-title setlist-title resource-title--setlist" onDoubleClick={canEdit ? startRenaming : undefined}>
                  <div className="icon-picker-wrapper" ref={iconPickerRef}>
                    {canEdit ? (
                    <button
                      ref={iconTriggerRef}
                      type="button"
                      className={`icon-picker-trigger${showIconEditor ? ' is-open' : ''}`}
                      aria-haspopup="dialog"
                      aria-expanded={showIconEditor}
                      onClick={(e) => { e.stopPropagation(); setShowIconEditor((v) => !v); }}
                      title="Change setlist icon"
                      aria-label="Change setlist icon"
                    >
                      {effectiveIcon
                        ? <span className="resource-title-icon" aria-hidden="true">{effectiveIcon}</span>
                        : <ListMusic size={16} aria-hidden="true" />}
                    </button>
                    ) : (
                      effectiveIcon
                        ? <span className="resource-title-icon" aria-hidden="true">{effectiveIcon}</span>
                        : <ListMusic size={16} aria-hidden="true" />
                    )}
                    {canEdit && showIconEditor && (
                      <div className="icon-picker-popover" role="dialog" aria-label="Choose setlist icon">
                        <div className="emoji-choice-grid" role="radiogroup" aria-label="Setlist icon options">
                          <button
                            type="button"
                            className={`emoji-choice-btn${!effectiveIcon ? ' active' : ''}`}
                            onClick={() => {
                              if (onUpdateIconOverride) {
                                onUpdateIconOverride(undefined);
                              } else {
                                void updateBandSetlistIcon(bandId, setlistId, undefined);
                              }
                              setIconDraft('');
                              setShowIconEditor(false);
                            }}
                            aria-label="Choose default icon"
                            aria-pressed={!effectiveIcon}
                          >
                            <ListMusic size={16} />
                          </button>
                          {SETLIST_ICON_OPTIONS.map((emoji) => {
                            const selected = iconDraft === emoji;
                            return (
                              <button
                                key={emoji}
                                type="button"
                                className={`emoji-choice-btn${selected ? ' active' : ''}`}
                                onClick={() => {
                                  const icon = normalizeEmojiIcon(emoji);
                                  if (onUpdateIconOverride) {
                                    onUpdateIconOverride(icon);
                                  } else {
                                    void updateBandSetlistIcon(bandId, setlistId, icon);
                                  }
                                  setIconDraft(emoji);
                                  setShowIconEditor(false);
                                }}
                                aria-label={`Choose icon ${emoji}`}
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
                          onClick={() => {
                            if (onUpdateIconOverride) {
                              onUpdateIconOverride(undefined);
                            } else {
                              void updateBandSetlistIcon(bandId, setlistId, undefined);
                            }
                            setIconDraft('');
                            setShowIconEditor(false);
                          }}
                        >
                          Reset to default
                        </button>
                      </div>
                    )}
                  </div>
                  {setlistName}
                </h1>
                {canEdit && (
                  <button
                    type="button"
                    className="title-rename-btn"
                    onClick={startRenaming}
                    title="Rename setlist"
                    aria-label="Rename setlist"
                  >
                    <PenLine size={14} />
                  </button>
                )}
              </div>
            )}
            <p className="song-list-summary setlist-song-count">
              {songs.length} song{songs.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="resource-header-actions">
            {songs.length > 0 ? (
              <Link
                className="btn btn--concert"
                to={effectiveConcertRoute}
                title={`Start concert for ${setlistName}`}
              >
                <Play size={14} />
              </Link>
            ) : (
              <button
                className="btn btn--concert"
                type="button"
                disabled
                title="Add songs to enable concert mode"
              >
                <Play size={14} />
              </button>
            )}
            {songs.length > 0 && (
              <Link
                className="btn btn--secondary"
                to={`/bands/${bandId}/setlists/${setlistId}/print`}
                title={`Print / export ${setlistName} as PDF`}
                aria-label={`Print ${setlistName}`}
              >
                <Printer size={14} />
              </Link>
            )}
            {extraActions}
            <button
              className="btn btn--secondary"
              onClick={openSongPicker}
              title="Add songs"
            >
              <Plus size={14} />
            </button>
            {songs.length > 1 && (
              <button
                className={`btn${reorderMode ? ' btn--accent' : ' btn--secondary'}`}
                onClick={() => setReorderMode((v) => !v)}
                title={reorderMode ? 'Done reordering' : 'Reorder songs'}
                aria-label={reorderMode ? 'Done reordering' : 'Reorder songs'}
                aria-pressed={reorderMode}
              >
                <ArrowUpDown size={14} />
              </button>
            )}
            {canDeleteSetlist ? (
              <button
                className="btn btn--secondary"
                onClick={() => void handleDeleteSetlist()}
                title={`Delete setlist ${setlistName}`}
                aria-label={`Delete setlist ${setlistName}`}
              >
                <Trash2 size={14} />
              </button>
            ) : null}
          </div>
        </div>

      </div>{/* end song-list-sticky */}

      {songs.length === 0 ? (
        <div className="empty-state">
          <Music size={48} />
          <p>No songs in this setlist yet.</p>
        </div>
      ) : (
        <ul className={`setlist-songs${reorderMode ? ' is-reordering' : ''}`}>
          {songs.map((song, index) => {
            const note = (songNotes?.[song.id] ?? '').trim();
            const isEditingNote = editingSongNoteId === song.id;

            return (
            <Fragment key={song.id}>
              <li className="setlist-song-item">
                <div className="setlist-song-card">
                  {reorderMode && (
                    <div className="setlist-reorder-btns">
                      <button
                        type="button"
                        className="setlist-reorder-btn"
                        onClick={() => moveSongUp(index)}
                        disabled={index === 0}
                        aria-label={`Move ${song.title} up`}
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        type="button"
                        className="setlist-reorder-btn"
                        onClick={() => moveSongDown(index)}
                        disabled={index === songs.length - 1}
                        aria-label={`Move ${song.title} down`}
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>
                  )}
                  <div className="setlist-song-position">{index + 1}</div>

                  <Link
                    to={`/songs/${song.id}`}
                    state={{ backTo: pathname, backLabel: setlistName, bandId }}
                    className="setlist-song-link"
                  >
                    <div className="setlist-song-info">
                      <span className="setlist-song-title">{song.title}</span>
                      {song.artist && <span className="setlist-song-artist">{song.artist}</span>}
                      {note ? <span className="setlist-song-note-preview">Note: {note}</span> : null}
                    </div>
                    <div className="setlist-song-meta">
                      <LanguageBadge code={song.language} size="sm" flagOnly />
                      {song.tags?.map((tag) => (
                        <span key={tag} className="tag">
                          {tag}
                        </span>
                      ))}
                      <SongMetaBadges song={song} counts={songBadgeCounts[song.id]} pulseTempo />
                    </div>
                  </Link>

                  {onUpdateSongNote ? (
                    <button
                      type="button"
                      className={`setlist-note-btn${note ? ' has-note' : ''}`}
                      onClick={() => {
                        if (isEditingNote) {
                          cancelEditingSongNote();
                        } else {
                          startEditingSongNote(song.id);
                        }
                      }}
                      title={note ? `Edit note for ${song.title}` : `Add note for ${song.title}`}
                      aria-label={note ? `Edit note for ${song.title}` : `Add note for ${song.title}`}
                    >
                      <FileText size={14} />
                    </button>
                  ) : null}

                  <button
                    className="setlist-remove-btn"
                    onClick={() => onRemoveSong(song.id)}
                    title={`Remove ${song.title} from setlist`}
                    aria-label={`Remove ${song.title}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                  {isEditingNote ? (
                    <div className="setlist-song-note-editor">
                      <label htmlFor={`song-note-${song.id}`} className="setlist-song-note-label">Song note</label>
                      <textarea
                        id={`song-note-${song.id}`}
                        className="setlist-song-note-input"
                        value={songNoteDraft}
                        onChange={(event) => setSongNoteDraft(event.target.value)}
                        placeholder="Example: Add trumpet in chorus / 2 extra vocal mics"
                        rows={2}
                      />
                      <div className="setlist-song-note-actions">
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() => void saveSongNote(song.id)}
                        >
                          Save note
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary"
                          onClick={() => void deleteSongNote(song.id)}
                        >
                          Delete note
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary"
                          onClick={cancelEditingSongNote}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
              </li>
            </Fragment>
            );
          })}
        </ul>
      )}

      {showSongPicker && (
        <div className="song-picker-overlay" role="dialog" aria-modal="true" aria-label="Add songs to setlist">
          <div className="song-picker-panel">
            <div className="song-picker-header">
              <h2>Add songs to {setlistName}</h2>
              <button className="song-picker-close" onClick={closeSongPicker} aria-label="Close song picker">
                <X size={16} />
              </button>
            </div>

            <div className="song-picker-search-wrap">
              <Search size={15} className="song-picker-search-icon" />
              <input
                type="text"
                className="song-picker-search"
                value={pickerQuery}
                onChange={(event) => setPickerQuery(event.target.value)}
                placeholder="Search by title, artist, or tag"
              />
            </div>

            <div className="song-picker-results" role="list">
              {songListPickerEntries.length > 0 ? (
                <>
                  <p className="song-picker-section-title">Songlists</p>
                  {songListPickerEntries.map(({ songList, addableSongIds }) => (
                    <div
                      key={songList.id}
                      className="song-picker-item"
                      role="listitem"
                    >
                      <div className="song-picker-item-main">
                        <span className="song-picker-song-title">{songList.name}</span>
                        <span className="song-picker-song-artist">
                          Add {addableSongIds.length} song{addableSongIds.length === 1 ? '' : 's'} from this list
                        </span>
                      </div>
                      <button
                        className="song-picker-add-btn"
                        onClick={() => void handleAddSongList(songList.id, addableSongIds)}
                        disabled={addingSongListId === songList.id}
                        title={`Add all available songs from ${songList.name}`}
                      >
                        <Plus size={14} /> {addingSongListId === songList.id ? 'Adding...' : 'Add list'}
                      </button>
                    </div>
                  ))}
                </>
              ) : null}

              {songListPickerEntries.length > 0 && filteredAvailableSongs.length > 0 ? (
                <p className="song-picker-section-title">Songs</p>
              ) : null}

              {filteredAvailableSongs.length === 0 ? (
                <p className="song-picker-empty">No songs available to add.</p>
              ) : (
                filteredAvailableSongs.map((song) => (
                  <div
                    key={song.id}
                    className="song-picker-item"
                    role="listitem"
                  >
                    <div className="song-picker-item-main">
                      <span className="song-picker-song-title">{song.title}</span>
                      {song.artist && <span className="song-picker-song-artist">{song.artist}</span>}
                    </div>
                    <button
                      className="song-picker-add-btn"
                      onClick={() => onAddSong(song.id)}
                      title={`Add ${song.title}`}
                    >
                      <Plus size={14} /> Add
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="song-picker-footer">
              <button className="btn btn--primary" onClick={closeSongPicker}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
