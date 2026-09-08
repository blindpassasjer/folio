import { useEffect, useState, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Search,
  Music,
  LayoutGrid,
  Rows3,
  ArrowUpDown,
  Plus,
  X,
  SquarePen,
  PenLine,
  Trash2,
  ListMinus,
  Folder,
} from 'lucide-react';
import type { Song } from '../types';
import LanguageBadge from './LanguageBadge';
import SongMetaBadges from './SongMetaBadges';
import { languageName } from '../utils/languages';
import { parseChordPro } from '../utils/chordParser';
import { SONGLIST_ICON_OPTIONS } from '../lib/iconOptions';
import { useSongListBadges } from '../hooks/useSongListBadges';
import { useAuth } from '../context/AuthContext';
import { readStoredString, writeStoredString } from '../lib/safeStorage';

type SortBy =
  | 'name-asc'
  | 'name-desc'
  | 'artist-asc'
  | 'artist-desc'
  | 'language'
  | 'date-asc'
  | 'date-desc';

const SORT_OPTIONS: SortBy[] = ['name-asc', 'name-desc', 'artist-asc', 'artist-desc', 'language', 'date-asc', 'date-desc'];

function getInitialSortBy(): SortBy {
  const stored = readStoredString('gigboy-sort-by');
  if (!stored) {
    return 'name-asc';
  }

  return SORT_OPTIONS.includes(stored as SortBy) ? (stored as SortBy) : 'name-asc';
}

function getSongPreview(song: Song): string {
  const lyricLines = parseChordPro(song.chordpro)
    .filter((line) => line.type === 'chord-lyric')
    .map((line) => line.segments?.map((segment) => segment.lyric).join('').trim() ?? '')
    .filter(Boolean);

  if (lyricLines.length === 0) {
    return 'No lyric preview available yet.';
  }

  const preview = lyricLines.slice(0, 2).join(' ');
  return preview.length > 150 ? `${preview.slice(0, 147).trimEnd()}...` : preview;
}

function normalizeEmojiIcon(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return [...trimmed].slice(0, 2).join('');
}

interface Props {
  songs: Song[];
  listName?: string;
  listEntityLabel?: 'songlist' | 'band';
  headerMeta?: string;
  headerVariant?: 'songlist' | 'bands';
  headerActions?: ReactNode;
  onDeleteList?: () => void | Promise<void>;
  deleteListLabel?: string;
  listIcon?: string;
  allSongs?: Song[];
  onDeleteSong: (song: Song) => void | Promise<void>;
  canDeleteSong?: (song: Song) => boolean;
  onRenameList?: (name: string) => void | Promise<void>;
  onUpdateListAppearance?: (appearance: { icon?: string }) => void;
  onRemoveSong?: (song: Song) => void;
  onAddSong?: (songId: string) => void;
  onAddSongsClick?: () => void;
  pickerSourceNote?: string;
  /** When songs belong to a band, pass the bandId so SongView can use band recordings */
  bandId?: string;
  autoStartRenameToken?: string | number | null;
}

export default function SongList({
  songs,
  listName,
  listEntityLabel = 'songlist',
  headerMeta,
  headerVariant = 'songlist',
  headerActions,
  onDeleteList,
  deleteListLabel,
  listIcon,
  allSongs,
  onDeleteSong,
  canDeleteSong,
  onRenameList,
  onUpdateListAppearance,
  onRemoveSong,
  onAddSong,
  onAddSongsClick,
  pickerSourceNote,
  bandId,
  autoStartRenameToken = null,
}: Props) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'cards'>(
    () => (readStoredString('gigboy-view-mode') === 'cards' ? 'cards' : 'list')
  );
  const [sortBy, setSortBy] = useState<SortBy>(() => getInitialSortBy());

  function handleSetViewMode(mode: 'list' | 'cards') {
    writeStoredString('gigboy-view-mode', mode);
    setViewMode(mode);
  }

  function handleSetSortBy(sort: SortBy) {
    writeStoredString('gigboy-sort-by', sort);
    setSortBy(sort);
  }
  const [showSongPicker, setShowSongPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [showListAppearanceEditor, setShowListAppearanceEditor] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(listName ?? '');
  const [listIconDraft, setListIconDraft] = useState(listIcon ?? '');

  useEffect(() => {
    if (!isRenaming) {
      setRenameValue(listName ?? '');
    }
  }, [listName, isRenaming]);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const iconPickerRef = useRef<HTMLDivElement | null>(null);
  const iconTriggerRef = useRef<HTMLButtonElement | null>(null);
  const songPageStateBase = listName
    ? { backTo: pathname, backLabel: listName, bandId: bandId ?? undefined }
    : undefined;

  const canAddSongsToList = Boolean(allSongs && onAddSong);
  const canTriggerAddSongs = canAddSongsToList || Boolean(onAddSongsClick);

  const availableSongs = useMemo(() => {
    if (!allSongs) return [];

    const songIdsInList = new Set(songs.map((song) => song.id));
    return allSongs
      .filter((song) => !songIdsInList.has(song.id))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [allSongs, songs]);

  const filteredAvailableSongs = useMemo(() => {
    const normalizedQuery = pickerQuery.trim().toLowerCase();
    if (!normalizedQuery) return availableSongs;

    return availableSongs.filter((song) => {
      const inTitle = song.title.toLowerCase().includes(normalizedQuery);
      const inArtist = (song.artist ?? '').toLowerCase().includes(normalizedQuery);
      const inTags = (song.tags ?? []).some((tag) => tag.toLowerCase().includes(normalizedQuery));
      return inTitle || inArtist || inTags;
    });
  }, [availableSongs, pickerQuery]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = songs.filter((s) => {
      const matchesQuery =
        !q ||
        s.title.toLowerCase().includes(q) ||
        (s.artist ?? '').toLowerCase().includes(q) ||
        (s.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
        languageName(s.language).toLowerCase().includes(q);
      return matchesQuery;
    });

    const sorted = [...base];
    if (sortBy === 'name-asc') {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'name-desc') {
      sorted.sort((a, b) => b.title.localeCompare(a.title));
    } else if (sortBy === 'artist-asc') {
      sorted.sort((a, b) => {
        const artistA = (a.artist ?? '').trim().toLowerCase();
        const artistB = (b.artist ?? '').trim().toLowerCase();
        return artistA.localeCompare(artistB) || a.title.localeCompare(b.title);
      });
    } else if (sortBy === 'artist-desc') {
      sorted.sort((a, b) => {
        const artistA = (a.artist ?? '').trim().toLowerCase();
        const artistB = (b.artist ?? '').trim().toLowerCase();
        return artistB.localeCompare(artistA) || a.title.localeCompare(b.title);
      });
    } else if (sortBy === 'language') {
      sorted.sort((a, b) => languageName(a.language).localeCompare(languageName(b.language)) || a.title.localeCompare(b.title));
    } else if (sortBy === 'date-asc') {
      sorted.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.title.localeCompare(b.title));
    } else if (sortBy === 'date-desc') {
      sorted.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.title.localeCompare(b.title));
    }
    return sorted;
  }, [songs, query, sortBy]);

  const songPreviews = useMemo(
    () => Object.fromEntries(filtered.map((song) => [song.id, getSongPreview(song)])),
    [filtered]
  );

  const songBadgeCounts = useSongListBadges(filtered, bandId, user?.id);

  useEffect(() => {
    setListIconDraft(listIcon ?? '');
  }, [listIcon]);

  useEffect(() => {
    if (!isRenaming) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [isRenaming]);

  useEffect(() => {
    if (!onRenameList || !listName || autoStartRenameToken == null) return;
    setRenameValue(listName);
    setIsRenaming(true);
  }, [autoStartRenameToken, listName, onRenameList]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (showSongPicker) {
        setShowSongPicker(false);
        setPickerQuery('');
      }

      if (showListAppearanceEditor) {
        setShowListAppearanceEditor(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showSongPicker, showListAppearanceEditor]);

  useEffect(() => {
    if (!showListAppearanceEditor) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (iconPickerRef.current?.contains(target)) return;
      if (iconTriggerRef.current?.contains(target)) return;
      setShowListAppearanceEditor(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowListAppearanceEditor(false);
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
  }, [showListAppearanceEditor]);

  const openSongPicker = () => {
    setPickerQuery('');
    setShowSongPicker(true);
  };

  const closeSongPicker = () => {
    setShowSongPicker(false);
    setPickerQuery('');
  };

  const commitRename = ({ keepEditing = false }: { keepEditing?: boolean } = {}) => {
    if (!onRenameList || !listName) {
      if (!keepEditing) {
        setIsRenaming(false);
      }
      return;
    }

    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== listName) {
      void onRenameList(trimmed);
    }

    if (keepEditing) {
      setRenameValue(trimmed || listName);
      requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
      return;
    }

    setRenameValue(listName);
    setIsRenaming(false);
  };

  return (
    <div className="song-list-page">
      <div className="list-sticky-header">
      <div className={`${headerVariant === 'bands' ? 'bands-header' : 'page-section-header'} resource-header`}>
        <div className="setlist-title-block">
          {listName && (
            isRenaming ? (
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitRename({ keepEditing: true });
                  }
                  if (event.key === 'Escape') {
                    setRenameValue(listName);
                    setIsRenaming(false);
                  }
                }}
                onBlur={() => commitRename()}
                className="setlist-name-input"
              />
            ) : (
              <div className="song-list-title-row">
                <h2 className="resource-title setlist-title resource-title--setlist">
                  {onUpdateListAppearance ? (
                    <div className="icon-picker-wrapper" ref={iconPickerRef}>
                      <button
                        ref={iconTriggerRef}
                        type="button"
                        className={`icon-picker-trigger${showListAppearanceEditor ? ' is-open' : ''}`}
                        aria-haspopup="dialog"
                        aria-expanded={showListAppearanceEditor}
                        onClick={(e) => { e.stopPropagation(); setShowListAppearanceEditor((v) => !v); }}
                        title={`Change ${listEntityLabel} icon`}
                        aria-label={`Change ${listEntityLabel} icon`}
                      >
                        {listIcon
                          ? <span className="resource-title-icon" aria-hidden="true">{listIcon}</span>
                          : <Folder size={16} aria-hidden="true" />}
                      </button>
                      {showListAppearanceEditor && (
                        <div className="icon-picker-popover" role="dialog" aria-label={`Choose ${listEntityLabel} icon`}>
                          <div className="emoji-choice-grid" role="radiogroup" aria-label={`${listEntityLabel} icon options`}>
                            <button
                              type="button"
                              className={`emoji-choice-btn${!listIcon ? ' active' : ''}`}
                              onClick={() => {
                                setListIconDraft('');
                                void onUpdateListAppearance({ icon: undefined });
                                setShowListAppearanceEditor(false);
                              }}
                              aria-label="Choose default icon"
                              aria-pressed={!listIcon}
                            >
                              <Folder size={16} />
                            </button>
                            {SONGLIST_ICON_OPTIONS.map((emoji) => {
                              const selected = listIconDraft === emoji;
                              return (
                                <button
                                  key={emoji}
                                  type="button"
                                  className={`emoji-choice-btn${selected ? ' active' : ''}`}
                                  onClick={() => {
                                    setListIconDraft(emoji);
                                    void onUpdateListAppearance({ icon: normalizeEmojiIcon(emoji) });
                                    setShowListAppearanceEditor(false);
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
                              void onUpdateListAppearance({ icon: undefined });
                              setListIconDraft('🎵');
                              setShowListAppearanceEditor(false);
                            }}
                          >
                            Reset to default
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    listIcon && <span className="resource-title-icon" aria-hidden="true">{listIcon}</span>
                  )}
                  <span>{listName}</span>
                </h2>
                {onRenameList && (
                  <button
                    type="button"
                    className="title-rename-btn"
                    onClick={() => setIsRenaming(true)}
                    title={`Rename ${listEntityLabel}`}
                    aria-label={`Rename ${listEntityLabel}`}
                  >
                    <PenLine size={14} />
                  </button>
                )}
              </div>
            )
          )}
          <p className="song-list-summary setlist-song-count">{filtered.length} song{filtered.length === 1 ? '' : 's'}</p>
          {headerMeta ? <p className="song-list-summary setlist-song-count">{headerMeta}</p> : null}
        </div>
        <div className="resource-header-actions">
          {canTriggerAddSongs && (
            <button
              type="button"
              className="btn btn--secondary btn--accent"
              onClick={canAddSongsToList ? openSongPicker : onAddSongsClick}
              title="Add songs"
            >
              <Plus size={14} />
            </button>
          )}
          {headerActions}
          {onDeleteList && (
            <button
              type="button"
              className="btn btn--secondary btn--ghost"
              onClick={() => void onDeleteList()}
              title={deleteListLabel ?? `Delete ${listEntityLabel}`}
              aria-label={deleteListLabel ?? `Delete ${listEntityLabel}`}
            >
              <Trash2 size={14} />
            </button>
          )}
          <div className="view-toggle" role="tablist" aria-label="Song view mode">
            <button
              type="button"
              className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`}
              onClick={() => handleSetViewMode('list')}
              aria-pressed={viewMode === 'list'}
            >
              <Rows3 size={15} />
            </button>
            <button
              type="button"
              className={`view-toggle-btn${viewMode === 'cards' ? ' active' : ''}`}
              onClick={() => handleSetViewMode('cards')}
              aria-pressed={viewMode === 'cards'}
            >
              <LayoutGrid size={15} />
            </button>
          </div>
        </div>
      </div>
      <div className="song-list-controls">
        <div className="search-box">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Search songs, artists, tags, language…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="sort-select-wrapper">
          <ArrowUpDown size={14} className="sort-select-icon" />
          <select
            value={sortBy}
            onChange={(e) => handleSetSortBy(e.target.value as SortBy)}
            className="lang-select sort-select"
            aria-label="Sort songs"
          >
            <option value="name-asc">Song name A → Z</option>
            <option value="name-desc">Song name Z → A</option>
            <option value="artist-asc">Artist A → Z</option>
            <option value="artist-desc">Artist Z → A</option>
            <option value="language">Language</option>
            <option value="date-desc">Date added (newest first)</option>
            <option value="date-asc">Date added (oldest first)</option>
          </select>
        </div>
      </div>
      </div>{/* end song-list-sticky */}

      <div className="song-list-results">
        {filtered.length === 0 ? (
          songs.length === 0 && !query.trim() ? (
            <div className="empty-state">
              <Music size={48} />
              <p>No songs yet.</p>
              <p className="empty-state-hint">
                Songs use ChordPro format — write chords inline like{' '}
                <span className="chordpro-example">[G]Amazing [C]grace</span>.
              </p>
              {bandId && (
                <Link
                  to="/songs/new"
                  state={{ addSongScope: { kind: 'band', bandId } }}
                  className="btn btn--primary"
                >
                  Add your first song
                </Link>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <Music size={48} />
              <p>No songs found.</p>
            </div>
          )
        ) : viewMode === 'cards' ? (
          <div className="song-card-grid">
            {filtered.map((song) => {
              const songPageState = songPageStateBase
                ? { ...songPageStateBase }
                : undefined;

              return (
              <article
                key={song.id}
                className="song-preview-card"
              >
                <Link to={`/songs/${song.id}`} state={songPageState} className="song-preview-card-link">
                  <div className="song-preview-card-main">
                    <span className="song-card-title">{song.title}</span>
                    {song.artist && <span className="song-card-artist">{song.artist}</span>}
                  </div>
                  <p className="song-preview-text">{songPreviews[song.id]}</p>
                  <div className="song-card-meta">
                    <LanguageBadge code={song.language} size="sm" flagOnly />
                    {song.tags?.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                    <SongMetaBadges song={song} counts={songBadgeCounts[song.id]} />
                  </div>
                </Link>
                <div className="song-actions song-actions--stacked">
                  <Link
                    to={`/songs/${song.id}/edit`}
                    state={songPageState}
                    className="song-action-btn song-action-btn--edit"
                    title={`Edit ${song.title}`}
                    aria-label={`Edit ${song.title}`}
                  >
                    <SquarePen size={14} />
                  </Link>
                  {onRemoveSong && (
                    <button
                      className="song-action-btn song-action-btn--remove"
                      onClick={() => onRemoveSong(song)}
                      title={`Remove ${song.title}`}
                      aria-label={`Remove ${song.title}`}
                    >
                      <ListMinus size={14} />
                    </button>
                  )}
                  {(canDeleteSong?.(song) ?? true) ? (
                    <button
                      className="song-action-btn song-action-btn--delete"
                      onClick={() => onDeleteSong(song)}
                      title={`Delete ${song.title}`}
                      aria-label={`Delete ${song.title}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              </article>
              );
            })}
          </div>
        ) : (
          <ul className="song-list">
            {filtered.map((song) => {
              const songPageState = songPageStateBase
                ? { ...songPageStateBase }
                : undefined;

              return (
              <li
                key={song.id}
              >
                <div className="song-card">
                  <Link to={`/songs/${song.id}`} state={songPageState} className="song-card-link">
                    <div className="song-card-main">
                      <span className="song-card-title">{song.title}</span>
                      {song.artist && <span className="song-card-artist">{song.artist}</span>}
                    </div>
                    <div className="song-card-meta">
                      <LanguageBadge code={song.language} size="sm" flagOnly />
                      {song.tags?.map((tag) => (
                        <span key={tag} className="tag">
                          {tag}
                        </span>
                      ))}
                      <SongMetaBadges song={song} counts={songBadgeCounts[song.id]} />
                    </div>
                  </Link>
                  <div className="song-actions">
                    <Link
                      to={`/songs/${song.id}/edit`}
                      state={songPageState}
                      className="song-action-btn song-action-btn--edit"
                      title={`Edit ${song.title}`}
                      aria-label={`Edit ${song.title}`}
                    >
                      <SquarePen size={14} />
                    </Link>
                    {onRemoveSong && (
                      <button
                        className="song-action-btn song-action-btn--remove"
                        onClick={() => onRemoveSong(song)}
                        title={`Remove ${song.title}`}
                        aria-label={`Remove ${song.title}`}
                      >
                        <ListMinus size={14} />
                      </button>
                    )}
                    {(canDeleteSong?.(song) ?? true) ? (
                      <button
                        className="song-action-btn song-action-btn--delete"
                        onClick={() => onDeleteSong(song)}
                        title={`Delete ${song.title}`}
                        aria-label={`Delete ${song.title}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </div>

      {showSongPicker && canAddSongsToList && (
        <div className="song-picker-overlay" role="dialog" aria-modal="true" aria-label="Add songs to songlist">
          <div className="song-picker-panel">
            <div className="song-picker-header">
              <h2>Add songs to {listName ?? 'songlist'}</h2>
              <button className="song-picker-close" onClick={closeSongPicker} aria-label="Close song picker">
                <X size={16} />
              </button>
            </div>
            {headerVariant === 'bands' && pickerSourceNote && (
              <p className="song-picker-source-note">{pickerSourceNote}</p>
            )}

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
                      onClick={() => onAddSong?.(song.id)}
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
