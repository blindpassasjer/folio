import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import type { CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronUp,
  ChevronDown,
  RotateCcw,
  ListPlus,
  Wrench,
  SlidersHorizontal,
  Check,
  Plus,
  FileDown,
  FileUp,
  SquarePen,
  PenLine,
  Trash2,
  Play,
  Mic,
  Paperclip,
  AudioLines,
  Metronome,
  Search,
  History,
  X,
  Undo2,
  Redo2,
} from 'lucide-react';
import toast from '../utils/anchoredToast';
import type { LyricNoteStroke, Song, LyricTextNote } from '../types';
import ChordDisplay from './ChordDisplay';
import ChordDiagram, { type DiagramInstrument } from './ChordDiagram';
import LanguageBadge from './LanguageBadge';
import SongMetaBadges from './SongMetaBadges';
import VisualMetronome from './VisualMetronome';
import VisualTuner from './VisualTuner';
import { transposeChord } from '../utils/chordParser';
import type { ChordNotation } from '../utils/chordParser';
import { useBands } from '../context/BandsContext';
import { useAuth } from '../context/AuthContext';
import { useSongHandNotes } from '../hooks/useSongHandNotes';
import { useSongRecordings } from '../hooks/useSongRecordings';
import { useSongAttachments } from '../hooks/useSongAttachments';
import { useSongTranspose } from '../hooks/useSongTranspose';
import { useBandChordVoicings } from '../hooks/useBandChordVoicings';
import SongHistoryPanel from './SongHistoryPanel';
import { buildSongSurfaceStyle } from '../utils/songColorStyles';
import { showConfirmToast, showPromptToast } from '../utils/toastDialogs';
import { getUserNoteColor } from '../lib/userColors';
import { extractPinnedLineIds } from '../lib/lineAnchor';
import { saveBlob } from '../lib/download';
import LyricHandNotesOverlay from './LyricHandNotesOverlay';
import SongTextNotesOverlay from './SongTextNotesOverlay';
import SongMediaPlayer from './SongMediaPlayer';
import SongRecorder from './SongRecorder';
import SongAttachments from './SongAttachments';
import ChordFinder from './ChordFinder';
import { parseSongMedia } from '../utils/songMedia';
import { parseImportedSongFile, SONG_TEXT_IMPORT_ACCEPT } from '../utils/songImport';

interface Props {
  song: Song;
  accentColor?: string;
  /** All songs are band-owned */
  bandId: string;
}

interface ActiveChord {
  chord: string;
  rect: DOMRect;
  element: HTMLElement;
}

type SongPageState = {
  backTo?: string;
  backLabel?: string;
  bandId?: string;
};

export default function SongView({ song, accentColor, bandId }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const pageState = location.state as SongPageState | null;
  const [transpose, setTranspose] = useState(0);
  const [chordInstrument, setChordInstrument] = useState<DiagramInstrument>('guitar');
  const chordNotation: ChordNotation = 'anglo';
  const [activeChord, setActiveChord] = useState<ActiveChord | null>(null);
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [updatingFromFile, setUpdatingFromFile] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const updateFromFileInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const {
    bands,
    bandSongListsByBandId,
    updateBandSong,
    refreshBandSongs,
    addSongToBandSongList,
    removeSongFromBandSongList,
    removeSongFromBandLibrary,
  } = useBands();
  const bandSongLists = bandSongListsByBandId[bandId] ?? [];
  const { user } = useAuth();
  const availableBands = bands ?? [];

  const band = availableBands.find((b) => b.id === bandId) ?? null;
  const canEditBand = !user || !band ? true : band.memberRoles?.[user.id] !== 'viewer';

  const {
    myTranspose,
    seed: transposeSeed,
    pinForMe: pinTransposeForMe,
    clearMine: clearMyTransposePref,
    scopeOf: transposeScopeOf,
  } = useSongTranspose({ bandId, songId: song.id, bandDefault: song.preferredTranspose });

  const chordVoicings = useBandChordVoicings(bandId, canEditBand);

  // Hand notes state
  const [showNotes, setShowNotes] = useState(false);
  const [drawEnabled, setDrawEnabled] = useState(false);
  const [typeEnabled, setTypeEnabled] = useState(false);
  const [showMetronome, setShowMetronome] = useState(false);
  const [showTuner, setShowTuner] = useState(false);
  const [showMediaPlayer, setShowMediaPlayer] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [showChordFinder, setShowChordFinder] = useState(false);
  const [autoPlayMediaOnOpen, setAutoPlayMediaOnOpen] = useState(false);
  const media = song.playbackUrl ? parseSongMedia(song.playbackUrl) : null;
  const canDeleteSong = true;
  const songPageState = pageState ?? {
    backTo: `/bands/${bandId}/library`,
    backLabel: 'Band library',
    bandId,
  };

  const isBandOwner = Boolean(band && user && band.ownerId === user.id);

  const handNotes = useSongHandNotes({
    bandId,
    songId: song.id,
    user,
    enabled: Boolean(user && song.id),
    isOwner: isBandOwner,
  });

  // Line currently being drawn on, pinned to single-row layout for the duration of the
  // gesture so the anchor is captured against the same geometry it'll be replayed against
  // (mobile-narrow screens otherwise wrap the line while it's still unpinned — see
  // anchorFromClientPoint's doc comment in lib/lineAnchor.ts).
  const [drawingLineId, setDrawingLineId] = useState<number | null>(null);

  const pinnedLineIds = useMemo(() => {
    const ids = extractPinnedLineIds(handNotes.visibleNotes);
    if (drawingLineId != null) ids.add(drawingLineId);
    return ids;
  }, [handNotes.visibleNotes, drawingLineId]);

  const handleActiveLineChange = useCallback((lineId: number | null) => {
    flushSync(() => setDrawingLineId(lineId));
  }, []);

  const hasNotes = handNotes.notes.some((note) => note.strokes.length > 0 || (note.textNotes?.length ?? 0) > 0);

  const { recordings } = useSongRecordings({
    bandId,
    songId: user ? song.id : '',
  });
  const { attachments } = useSongAttachments({
    bandId,
    songId: user ? song.id : '',
  });
  const hasRecordings = recordings.length > 0;
  const hasAttachments = attachments.length > 0;

  const badgeCounts = useMemo(() => ({
    notes: handNotes.notes.filter((note) => note.strokes.length > 0 || (note.textNotes?.length ?? 0) > 0).length,
    attachments: attachments.length,
    recordings: recordings.length,
  }), [handNotes.notes, attachments.length, recordings.length]);

  const handleStrokesChange = useCallback((strokes: LyricNoteStroke[]) => {
    handNotes.saveMyNotes(strokes);
  }, [handNotes]);

  const handleClearNotes = useCallback(async () => {
    await handNotes.clearMyNotes();
  }, [handNotes]);

  const handleDeleteNotesForAuthor = useCallback(async (authorUid: string, authorName: string) => {
    const confirmed = await showConfirmToast(`Delete ${authorName}'s handwritten notes on this song?`, {
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    await handNotes.deleteNotesByAuthor(authorUid);
  }, [handNotes]);

  const handleToggleNotes = useCallback((next: boolean) => {
    setShowNotes(next);
    if (!next) {
      setDrawEnabled(false);
      setTypeEnabled(false);
    }
  }, []);

  const handleToggleDraw = useCallback((next: boolean) => {
    setDrawEnabled(next);
    if (next) setTypeEnabled(false);
    if (next && !showNotes) setShowNotes(true);
    if (next) toast('Use two fingers to scroll while drawing', { icon: '✌️' });
  }, [showNotes]);

  const handleToggleType = useCallback((next: boolean) => {
    setTypeEnabled(next);
    if (next) setDrawEnabled(false);
    if (next && !showNotes) setShowNotes(true);
  }, [showNotes]);

  const handleTextNotesChange = useCallback((textNotes: LyricTextNote[]) => {
    void handNotes.saveMyTextNotes(textNotes);
  }, [handNotes]);

  useEffect(() => {
    if (!listMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setListMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [listMenuOpen]);

  // Track toolbar visibility to show floating tools when scrolled away
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setToolbarVisible(entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Reset transient UI state when song changes
  useEffect(() => {
    setActiveChord(null);
    setShowMetronome(false);
    setShowTuner(false);
    setShowMediaPlayer(false);
    setShowRecorder(false);
    setAutoPlayMediaOnOpen(false);
    setShowNotes(false);
    setDrawEnabled(false);
    setTypeEnabled(false);
    setShowChordFinder(false);
    setShowHistory(false);
  }, [song.id]);

  // Set while the member is working the +/- controls, so the auto-save effect below only
  // persists deliberate adjustments and never the initial seed.
  const transposeInteractedRef = useRef(false);

  // Seed the live transpose from the member's saved override for this song (or the song's
  // stored fallback / original key). Also fires when they reset (clearMine bumps the token).
  useEffect(() => {
    transposeInteractedRef.current = false;
    setTranspose(transposeSeed.value);
  }, [transposeSeed]);

  // Transpose is per-member and sticky: whatever the member dials in is saved for them,
  // debounced so a run of +/- taps is one write. No explicit "save" button.
  useEffect(() => {
    if (!transposeInteractedRef.current) return;
    if (myTranspose === transpose) return;
    const id = setTimeout(() => { void pinTransposeForMe(transpose); }, 800);
    return () => clearTimeout(id);
  }, [transpose, myTranspose, pinTransposeForMe]);

  const adjustTranspose = useCallback((next: (t: number) => number) => {
    transposeInteractedRef.current = true;
    setTranspose(next);
  }, []);

  const handleChordClick = useCallback((chord: string, rect: DOMRect, element: HTMLElement) => {
    setActiveChord(prev =>
      prev?.chord === chord && prev.element === element ? null : { chord, rect, element }
    );
  }, []);

  useEffect(() => {
    if (!activeChord) return;
    const el = activeChord.element;
    const update = () => setActiveChord(prev => prev ? { ...prev, rect: el.getBoundingClientRect() } : null);
    window.addEventListener('scroll', update, { passive: true, capture: true });
    window.addEventListener('resize', update, { passive: true });
    return () => {
      window.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
    };
  }, [activeChord?.element]);

  // Close the chord diagram when transpose changes so it can't show a stale chord name
  useEffect(() => {
    setActiveChord(null);
  }, [transpose]);

  async function handleRename() {
    const nextTitle = await showPromptToast('Rename song', {
      initialValue: song.title,
      confirmLabel: 'Rename',
    });
    if (nextTitle === null) return;
    const trimmed = nextTitle.trim();
    if (!trimmed || trimmed === song.title) return;
    const nextSong = {
      ...song,
      title: trimmed,
      updatedAt: new Date().toISOString(),
    };
    const err = await updateBandSong(bandId, nextSong);
    if (err) {
      toast.error(`Could not rename song: ${err}`);
    }
  }

  async function handleDelete() {
    if (!canDeleteSong) {
      toast.error('Only the song owner can move this song to trash.');
      return;
    }

    const confirmed = await showConfirmToast(`Move "${song.title}" to trash? It will be automatically deleted after 30 days.`, {
      confirmLabel: 'Move to trash',
    });
    if (!confirmed) return;

    const error = await removeSongFromBandLibrary(bandId, song.id);
    if (error) {
      toast.error(error);
      return;
    }

    toast.success('Song moved to band trash.');
    navigate(songPageState.backTo ?? `/bands/${bandId}/library`, { state: songPageState });
  }

  async function handleResetTranspose() {
    transposeInteractedRef.current = false;
    setTranspose(0);
    try {
      await clearMyTransposePref();
    } catch (err) {
      toast.error(`Could not reset your transpose: ${err instanceof Error ? err.message : err}`);
    }
  }

  async function handleUpdateCapo(newCapo: number) {
    const nextSong: Song = {
      ...song,
      capo: newCapo,
      updatedAt: new Date().toISOString(),
    };
    const err = await updateBandSong(bandId, nextSong);
    if (err) toast.error(`Could not update capo: ${err}`);
  }

  async function handleUpdateFromFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;

    const confirmed = await showConfirmToast(
      `Replace "${song.title}"'s content with ${file.name}? This overwrites the current lyrics/chords and can't be undone.`,
      { confirmLabel: 'Update' },
    );
    if (!confirmed) {
      if (updateFromFileInputRef.current) {
        updateFromFileInputRef.current.value = '';
      }
      return;
    }

    setUpdatingFromFile(true);
    try {
      const imported = await parseImportedSongFile(file);
      const nextSong: Song = {
        ...song,
        title: imported.title || song.title,
        artist: imported.artist ?? song.artist,
        author: imported.author ?? song.author,
        language: imported.language ?? song.language,
        secondaryLanguages: imported.secondaryLanguages ?? song.secondaryLanguages,
        tags: imported.tags ?? song.tags,
        key: imported.key ?? song.key,
        capo: imported.capo ?? song.capo,
        tempo: imported.tempo ?? song.tempo,
        timeSignature: imported.timeSignature ?? song.timeSignature,
        chordpro: imported.chordpro,
        updatedAt: new Date().toISOString(),
      };

      const error = await updateBandSong(bandId, nextSong);

      if (error) {
        toast.error(`Could not update song from file: ${error}`);
        return;
      }

      if (imported.warnings.length > 0) {
        toast.success(`Updated from ${file.name} with ${imported.warnings.length} warning${imported.warnings.length === 1 ? '' : 's'}.`);
      } else {
        toast.success(`Updated from ${file.name}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import this file.';
      toast.error(message);
    } finally {
      setUpdatingFromFile(false);
      if (updateFromFileInputRef.current) {
        updateFromFileInputRef.current.value = '';
      }
    }
  }

  function handleExport() {
    const lines: string[] = [];
    if (song.title) lines.push(`{title: ${song.title}}`);
    if (song.artist) lines.push(`{artist: ${song.artist}}`);
    if (song.author) lines.push(`{author: ${song.author}}`);
    if (song.key) lines.push(`{key: ${song.key}}`);
    if (typeof song.capo === 'number') lines.push(`{capo: ${song.capo}}`);
    if (typeof song.tempo === 'number') lines.push(`{tempo: ${song.tempo}}`);
    if (song.timeSignature) lines.push(`{time: ${song.timeSignature}}`);
    lines.push('');
    lines.push(song.chordpro);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const slug = song.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song';
    void saveBlob(blob, `${slug}.chordpro`);
  }

  const headerStyle = accentColor
    ? ({
      ...buildSongSurfaceStyle(accentColor),
      '--song-header-accent': accentColor,
    } as CSSProperties)
    : undefined;
  const transposeIsSaved = transposeScopeOf(transpose) === 'personal';
  const canResetTranspose = transpose !== 0 || myTranspose !== null;

  return (
    <div className="song-view">
      <div className="song-view-header" style={headerStyle}>
        <div className="song-view-title-block">
          <div className="song-view-title-row">
            <h1 className="song-view-title">{song.title}</h1>
            <button
              className="song-action-btn song-action-btn--rename"
              onClick={handleRename}
              title={`Rename ${song.title}`}
              aria-label={`Rename ${song.title}`}
            >
              <PenLine size={14} />
            </button>
          </div>
          {song.artist && <p className="song-view-artist">{song.artist}</p>}
          {song.author && <p className="song-view-author">{song.author}</p>}
          <div className="song-view-badges">
            <LanguageBadge code={song.language} />
            {song.secondaryLanguages?.map((l) => <LanguageBadge key={l} code={l} />)}
            {song.tags?.map((t) => <span key={t} className="tag">{t}</span>)}
            <SongMetaBadges song={song} counts={badgeCounts} />
          </div>
        </div>

        <div className="song-view-toolbar" ref={toolbarRef}>
          <section className="song-toolbar-section song-toolbar-section--settings">
            <div className="song-toolbar-section-head">
              <h2 className="song-toolbar-section-title"><SlidersHorizontal size={14} /> Settings</h2>
            </div>

            <div className="song-toolbar-row song-toolbar-row--controls">
              <div className="transpose-control song-toolbar-controls-group">
                <button
                  onClick={() => adjustTranspose((t) => t - 1)}
                  aria-label="Transpose down"
                  className="transpose-btn song-toolbar-tool-btn song-toolbar-setting-btn"
                >
                  <ChevronDown size={16} />
                </button>
                <span className="transpose-label song-toolbar-tool-btn song-toolbar-setting-label">
                  {song.key
                    ? transpose === 0
                      ? `Key of ${song.key}`
                      : `Key of ${transposeChord(song.key, transpose)}`
                    : transpose === 0
                      ? 'Original key'
                      : `${transpose > 0 ? '+' : ''}${transpose} semitones`}
                  {transposeIsSaved && <span className="transpose-scope-tag"> (saved)</span>}
                </span>
                <button
                  onClick={() => adjustTranspose((t) => t + 1)}
                  aria-label="Transpose up"
                  className="transpose-btn song-toolbar-tool-btn song-toolbar-setting-btn"
                >
                  <ChevronUp size={16} />
                </button>
                {canResetTranspose && (
                  <button
                    onClick={() => { void handleResetTranspose(); }}
                    aria-label="Reset to original key"
                    className="transpose-btn transpose-btn--reset song-toolbar-tool-btn song-toolbar-setting-btn"
                    title="Reset to original key"
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>

              <div className="transpose-control song-toolbar-controls-group">
                <button
                  className="transpose-btn song-toolbar-tool-btn song-toolbar-setting-btn"
                  onClick={() => { void handleUpdateCapo(Math.max(0, (song.capo ?? 0) - 1)); }}
                  aria-label="Decrease capo"
                >
                  −
                </button>
                <span className="transpose-label song-toolbar-tool-btn song-toolbar-setting-label">
                  {(song.capo ?? 0) === 0 ? 'No capo' : `Capo ${song.capo}`}
                </span>
                <button
                  className="transpose-btn song-toolbar-tool-btn song-toolbar-setting-btn"
                  onClick={() => { void handleUpdateCapo(Math.min(12, (song.capo ?? 0) + 1)); }}
                  aria-label="Increase capo"
                >
                  +
                </button>
              </div>

              <div className="instrument-toggle song-toolbar-controls-group">
                <button
                  className={`instrument-toggle-btn${chordInstrument === 'guitar' ? ' instrument-toggle-btn--active' : ''}`}
                  onClick={() => { setChordInstrument('guitar'); setActiveChord(null); }}
                >
                  Guitar
                </button>
                <button
                  className={`instrument-toggle-btn${chordInstrument === 'ukulele' ? ' instrument-toggle-btn--active' : ''}`}
                  onClick={() => { setChordInstrument('ukulele'); setActiveChord(null); }}
                >
                  Ukulele
                </button>
                <button
                  className={`instrument-toggle-btn${chordInstrument === 'piano' ? ' instrument-toggle-btn--active' : ''}`}
                  onClick={() => { setChordInstrument('piano'); setActiveChord(null); }}
                >
                  Piano
                </button>
              </div>
            </div>


          </section>

          <section className="song-toolbar-section song-toolbar-section--tools">
            <div className="song-toolbar-section-head">
              <h2 className="song-toolbar-section-title"><Wrench size={14} /> Tools</h2>
            </div>

            <div className="song-toolbar-row song-toolbar-row--tool-switches">
              <button
                type="button"
                className="song-toolbar-tool-btn song-toolbar-tool-btn--concert"
                onClick={() => navigate(`/songs/${song.id}/concert`, { state: { backTo: location.pathname, bandId } })}
                title="Open in concert mode"
                aria-label="Open in concert mode"
              >
                <Play size={14} />
                Concert
              </button>

              <button
                type="button"
                className={`song-toolbar-tool-btn${showTuner ? ' song-toolbar-tool-btn--active' : ''}`}
                onClick={() => setShowTuner((prev) => !prev)}
                title={showTuner ? 'Hide tuner' : 'Show tuner'}
                aria-label={showTuner ? 'Hide tuner' : 'Show tuner'}
              >
                <AudioLines size={14} />
                Tuner
              </button>

              <button
                type="button"
                className={`song-toolbar-tool-btn${showMetronome ? ' song-toolbar-tool-btn--active' : ''}`}
                onClick={() => setShowMetronome((prev) => !prev)}
                title={showMetronome ? 'Hide metronome' : 'Show metronome'}
                aria-label={showMetronome ? 'Hide metronome' : 'Show metronome'}
              >
                <Metronome size={14} />
                Metronome
                {song.tempo ? (
                  <span
                    className="tempo-pulse-dot"
                    style={{ animationDuration: `${60000 / song.tempo}ms` }}
                    aria-hidden="true"
                  />
                ) : null}
              </button>

              {user && (
                <button
                  type="button"
                  className={`song-toolbar-tool-btn${showNotes ? ' song-toolbar-tool-btn--active' : ''}${hasNotes ? ' song-toolbar-tool-btn--has-content' : ''}`}
                  onClick={() => handleToggleNotes(!showNotes)}
                  title={showNotes ? 'Hide handwritten notes' : 'Show handwritten notes'}
                  aria-label={showNotes ? 'Hide handwritten notes' : 'Show handwritten notes'}
                >
                  <PenLine size={14} />
                  Notes
                </button>
              )}

              {media && (
                <button
                  type="button"
                  className={`song-toolbar-tool-btn${showMediaPlayer ? ' song-toolbar-tool-btn--active' : ''}`}
                  onClick={() => {
                    setShowMediaPlayer((prev) => {
                      const next = !prev;
                      if (next) {
                        setAutoPlayMediaOnOpen(true);
                      }
                      return next;
                    });
                  }}
                  title={showMediaPlayer ? 'Hide playback' : 'Open playback and play'}
                  aria-label={showMediaPlayer ? 'Hide playback' : 'Open playback and play'}
                >
                  <Play size={14} />
                  Playback
                </button>
              )}

              {user && (
                <button
                  type="button"
                  className={`song-toolbar-tool-btn${showRecorder ? ' song-toolbar-tool-btn--active' : ''}${hasRecordings ? ' song-toolbar-tool-btn--has-content' : ''}`}
                  onClick={() => setShowRecorder((prev) => !prev)}
                  title={showRecorder ? 'Hide recorder' : 'Show recorder'}
                  aria-label={showRecorder ? 'Hide recorder' : 'Show recorder'}
                >
                  <Mic size={14} />
                  Recorder
                </button>
              )}

              {user && (
                <button
                  type="button"
                  className={`song-toolbar-tool-btn${showAttachments ? ' song-toolbar-tool-btn--active' : ''}${hasAttachments ? ' song-toolbar-tool-btn--has-content' : ''}`}
                  onClick={() => setShowAttachments((prev) => !prev)}
                  title={showAttachments ? 'Hide attachments' : 'Show attachments'}
                  aria-label={showAttachments ? 'Hide attachments' : 'Show attachments'}
                >
                  <Paperclip size={14} />
                  Attachments
                </button>
              )}

              <button
                type="button"
                className={`song-toolbar-tool-btn${showChordFinder ? ' song-toolbar-tool-btn--active' : ''}`}
                onClick={() => setShowChordFinder((prev) => !prev)}
                title={showChordFinder ? 'Hide chord finder' : 'Show chord finder'}
                aria-label={showChordFinder ? 'Hide chord finder' : 'Show chord finder'}
              >
                <Search size={14} />
                Chord finder
              </button>

            </div>

            {(showMetronome || showTuner || (media && showMediaPlayer && song.playbackUrl) || (user && showNotes) || (user && showRecorder) || (user && showAttachments) || showChordFinder || (user && showHistory)) && (
              <div className={`song-toolbar-tools-grid${!toolbarVisible ? ' song-toolbar-tools-grid--floating' : ''}`}>
                {showTuner && (
                  <div className="song-toolbar-tool-card">
                    <div className="song-toolbar-tool-card-header">
                      <span className="song-toolbar-tool-card-title">
                        <AudioLines size={13} />
                        Tuner
                      </span>
                      <button className="floating-tool-close" onClick={() => setShowTuner(false)} aria-label="Close tuner"><X size={14} /></button>
                    </div>
                    <VisualTuner className="song-view-tuner" />
                  </div>
                )}

                {showMetronome && (
                  <div className="song-toolbar-tool-card">
                    <div className="song-toolbar-tool-card-header">
                      <span className="song-toolbar-tool-card-title">
                        <Metronome size={13} />
                        Metronome
                      </span>
                      <button className="floating-tool-close" onClick={() => setShowMetronome(false)} aria-label="Close metronome"><X size={14} /></button>
                    </div>
                    <VisualMetronome
                      tempo={song.tempo}
                      timeSignature={song.timeSignature}
                      className="song-view-metronome"
                    />
                  </div>
                )}

                {user && showNotes && (
                  <div className="song-toolbar-tool-card song-toolbar-tool-card--notes">
                    <div className="song-toolbar-tool-card-header">
                      <span className="song-toolbar-tool-card-title">Notes</span>
                      <button className="floating-tool-close" onClick={() => handleToggleNotes(false)} aria-label="Close notes"><X size={14} /></button>
                    </div>
                    <div className="song-notes-panel">
                      <label
                        className={`toggle-label toggle-label--draw song-notes-draw-toggle${drawEnabled ? ' toggle-label--draw-active' : ''}`}
                        title="Enable touch drawing"
                      >
                        <input
                          type="checkbox"
                          checked={drawEnabled}
                          onChange={(e) => handleToggleDraw(e.target.checked)}
                        />
                        Draw
                      </label>

                      <label
                        className={`toggle-label toggle-label--draw song-notes-draw-toggle${typeEnabled ? ' toggle-label--draw-active' : ''}`}
                        title="Enable keyboard typing on the song"
                      >
                        <input
                          type="checkbox"
                          checked={typeEnabled}
                          onChange={(e) => handleToggleType(e.target.checked)}
                        />
                        Type
                      </label>

                      {drawEnabled && (
                        <>
                          <button
                            className="notes-toolbar-btn"
                            onClick={handNotes.undoStroke}
                            disabled={!handNotes.canUndo}
                            title="Undo"
                            aria-label="Undo"
                          >
                            <Undo2 size={12} />
                          </button>
                          <button
                            className="notes-toolbar-btn"
                            onClick={handNotes.redoStroke}
                            disabled={!handNotes.canRedo}
                            title="Redo"
                            aria-label="Redo"
                          >
                            <Redo2 size={12} />
                          </button>
                          <button
                            className="notes-toolbar-btn notes-toolbar-btn--danger"
                            onClick={handleClearNotes}
                            disabled={handNotes.myStrokes.length === 0}
                            title="Clear my notes"
                          >
                            Clear
                          </button>
                        </>
                      )}

                      {handNotes.authors.length > 0 && (
                        <div className="notes-author-filters">
                          {handNotes.authors.length > 1 && (
                            <button
                              className={`notes-author-chip${handNotes.visibleAuthorIds.length === handNotes.authors.length ? ' notes-author-chip--active' : ''}`}
                              onClick={handNotes.showAll}
                              title="Show all users' notes"
                            >
                              All
                            </button>
                          )}
                          {handNotes.authors.map((author) => (
                            <span key={author.uid} className="notes-author-chip-group">
                              <button
                                className={`notes-author-chip${handNotes.visibleAuthorIds.includes(author.uid) ? ' notes-author-chip--on' : ''}`}
                                onClick={() => handNotes.toggleVisibleAuthor(author.uid)}
                                title={`Toggle notes by ${author.name}`}
                              >
                                {author.avatar ? (
                                  <span className="notes-author-chip-avatar">{author.avatar}</span>
                                ) : (
                                  <span className="notes-author-chip-initials">
                                    {author.name.slice(0, 1).toUpperCase()}
                                  </span>
                                )}
                                {author.uid === user.id ? 'Me' : author.name}
                              </button>
                              {isBandOwner && author.uid !== user.id && (
                                <button
                                  className="notes-author-chip-delete"
                                  onClick={() => handleDeleteNotesForAuthor(author.uid, author.name)}
                                  title={`Delete notes by ${author.name}`}
                                  aria-label={`Delete notes by ${author.name}`}
                                >
                                  <X size={10} />
                                </button>
                              )}
                            </span>
                          ))}
                        </div>
                      )}

                      {handNotes.saveState === 'saving' && (
                        <span className="notes-save-status notes-save-status--saving">Saving…</span>
                      )}
                      {handNotes.saveState === 'saved' && (
                        <span className="notes-save-status notes-save-status--saved">Saved</span>
                      )}
                      {handNotes.saveState === 'error' && (
                        <span className="notes-save-status notes-save-status--error">Failed to save</span>
                      )}
                    </div>
                  </div>
                )}

                {media && showMediaPlayer && song.playbackUrl && (
                  <div className="song-toolbar-tool-card song-toolbar-tool-card--media">
                    <div className="song-toolbar-tool-card-header">
                      <span className="song-toolbar-tool-card-title">Playback</span>
                      <button className="floating-tool-close" onClick={() => setShowMediaPlayer(false)} aria-label="Close playback"><X size={14} /></button>
                    </div>
                    <SongMediaPlayer
                      mediaUrl={song.playbackUrl}
                      autoPlay={autoPlayMediaOnOpen}
                      onAutoPlayHandled={() => setAutoPlayMediaOnOpen(false)}
                    />
                  </div>
                )}

                {user && showRecorder && (
                  <div className="song-toolbar-tool-card song-toolbar-tool-card--recorder">
                    <div className="song-toolbar-tool-card-header">
                      <span className="song-toolbar-tool-card-title">Recorder</span>
                      <button className="floating-tool-close" onClick={() => setShowRecorder(false)} aria-label="Close recorder"><X size={14} /></button>
                    </div>
                    <SongRecorder song={song} user={user} bandId={bandId} />
                  </div>
                )}

                {user && showAttachments && (
                  <div className="song-toolbar-tool-card song-toolbar-tool-card--attachments">
                    <div className="song-toolbar-tool-card-header">
                      <span className="song-toolbar-tool-card-title">Attachments</span>
                      <button className="floating-tool-close" onClick={() => setShowAttachments(false)} aria-label="Close attachments"><X size={14} /></button>
                    </div>
                    <SongAttachments song={song} user={user} bandId={bandId} />
                  </div>
                )}

                {showChordFinder && (
                  <div className="song-toolbar-tool-card song-toolbar-tool-card--chord-finder">
                    <div className="song-toolbar-tool-card-header">
                      <span className="song-toolbar-tool-card-title">
                        <Search size={13} />
                        Chord finder
                      </span>
                      <button className="floating-tool-close" onClick={() => setShowChordFinder(false)} aria-label="Close chord finder"><X size={14} /></button>
                    </div>
                    <ChordFinder />
                  </div>
                )}

                {user && showHistory && (
                  <div className="song-toolbar-tool-card song-toolbar-tool-card--history">
                    <div className="song-toolbar-tool-card-header">
                      <span className="song-toolbar-tool-card-title">
                        <History size={13} />
                        Edit history
                      </span>
                      <button className="floating-tool-close" onClick={() => setShowHistory(false)} aria-label="Close edit history"><X size={14} /></button>
                    </div>
                    <SongHistoryPanel
                      bandId={bandId}
                      song={song}
                      canRestore={canEditBand}
                      onRestored={() => { void refreshBandSongs(bandId); }}
                    />
                  </div>
                )}
              </div>
            )}
          </section>

          <div className="song-toolbar-row song-toolbar-row--actions">
            <div className="song-actions">
              <div className="add-to-list-wrap" ref={menuRef}>
                <button
                  className="rec-btn rec-btn--toggle"
                  onClick={() => setListMenuOpen((v) => !v)}
                  title="Manage songlists"
                  aria-label="Manage songlists"
                >
                  <ListPlus size={15} />
                  <span className="song-action-label">Songlists</span>
                </button>
                {listMenuOpen && (
                  <div className="list-dropdown">
                    {bandSongLists.length === 0 ? (
                      <p className="list-dropdown-empty">No songlists yet — create one from the band sidebar</p>
                    ) : (
                      bandSongLists.map((list) => {
                        const inList = list.songIds.includes(song.id);
                        return (
                          <button
                            key={list.id}
                            className={`list-dropdown-item${inList ? ' in-list' : ''}`}
                            onClick={() => {
                              if (inList) {
                                void removeSongFromBandSongList(bandId, list.id, song.id);
                              } else {
                                void addSongToBandSongList(bandId, list.id, song.id);
                              }
                            }}
                          >
                            {inList ? <Check size={13} /> : <Plus size={13} />}
                            {list.name}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              <button
                className="song-action-btn song-action-btn--import song-action-btn--labeled"
                onClick={() => updateFromFileInputRef.current?.click()}
                title={`Update ${song.title} from file`}
                aria-label={`Update ${song.title} from file`}
                disabled={updatingFromFile}
              >
                <FileUp size={14} />
                <span className="song-action-label">{updatingFromFile ? 'Updating…' : 'Update from file'}</span>
              </button>

              <button
                className="song-action-btn song-action-btn--labeled song-action-btn--download"
                onClick={handleExport}
                title={`Download ${song.title} as ChordPro file`}
                aria-label={`Download ${song.title} as ChordPro file`}
              >
                <FileDown size={14} />
                <span className="song-action-label">Download</span>
              </button>
              <input
                ref={updateFromFileInputRef}
                type="file"
                accept={SONG_TEXT_IMPORT_ACCEPT}
                onChange={(event) => {
                  void handleUpdateFromFile(event.target.files);
                }}
                style={{ display: 'none' }}
              />

              {user && (
                <button
                  className={`song-action-btn song-action-btn--labeled song-action-btn--history${showHistory ? ' song-action-btn--active' : ''}`}
                  onClick={() => setShowHistory((prev) => !prev)}
                  title={showHistory ? 'Hide edit history' : 'Show edit history'}
                  aria-label={showHistory ? 'Hide edit history' : 'Show edit history'}
                  aria-pressed={showHistory}
                >
                  <History size={14} />
                  <span className="song-action-label">History</span>
                </button>
              )}

              <button
                className="song-action-btn song-action-btn--edit song-action-btn--labeled"
                onClick={() => navigate(`/songs/${song.id}/edit`, songPageState ? { state: songPageState } : undefined)}
                title={`Edit ${song.title}`}
                aria-label={`Edit ${song.title}`}
              >
                <SquarePen size={14} />
                <span className="song-action-label">Edit</span>
              </button>
              {canDeleteSong ? (
                <button
                  className="song-action-btn song-action-btn--delete song-action-btn--labeled"
                  onClick={handleDelete}
                  title={`Delete ${song.title}`}
                  aria-label={`Delete ${song.title}`}
                >
                  <Trash2 size={14} />
                  <span className="song-action-label">Delete</span>
                </button>
              ) : null}
            </div>
          </div>

        </div>
      </div>

      <div className="song-view-body">
        <div className="song-notes-stage">
          <ChordDisplay
            chordpro={song.chordpro}
            transpose={transpose}
            notation={chordNotation}
            timeSignature={song.timeSignature}
            instrument={chordInstrument}
            onChordClick={!drawEnabled && !typeEnabled ? handleChordClick : undefined}
            pinnedLineIds={pinnedLineIds}
          />
          <LyricHandNotesOverlay
            visible={showNotes}
            drawEnabled={drawEnabled}
            notes={handNotes.visibleNotes}
            myStrokes={handNotes.myStrokes}
            strokeColor={getUserNoteColor(user?.id ?? null)}
            onMyStrokesChange={handleStrokesChange}
            onActiveLineChange={handleActiveLineChange}
          />
          {user && (
            <SongTextNotesOverlay
              visible={showNotes}
              typeEnabled={typeEnabled}
              notes={handNotes.visibleNotes}
              myTextNotes={handNotes.myTextNotes}
              myAuthorUid={user.id}
              myNotesVisible={handNotes.visibleNotes.some((n) => n.authorUid === user.id)}
              noteColor={getUserNoteColor(user.id)}
              onMyTextNotesChange={handleTextNotesChange}
            />
          )}
        </div>
      </div>

      {activeChord && (
        <ChordDiagram
          chord={activeChord.chord}
          instrument={chordInstrument}
          anchorRect={activeChord.rect}
          onClose={() => setActiveChord(null)}
          voicingOverride={
            chordInstrument === 'piano'
              ? undefined
              : chordVoicings.overrideFor(chordInstrument, activeChord.chord)
          }
          canEditVoicing={chordInstrument !== 'piano' && chordVoicings.canEdit}
          onSaveVoicing={
            chordInstrument === 'piano'
              ? undefined
              : (frets) => chordVoicings.save(chordInstrument, activeChord.chord, frets)
          }
          onResetVoicing={
            chordInstrument === 'piano'
              ? undefined
              : () => chordVoicings.remove(chordInstrument, activeChord.chord)
          }
        />
      )}

    </div>
  );
}
