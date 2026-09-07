import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBeforeUnload, useNavigate, useBlocker } from 'react-router-dom';
import { flushSync } from 'react-dom';
import { ChevronDown, FileUp, Redo2, Save, Undo2, Wand2 } from 'lucide-react';
import toast from '../utils/anchoredToast';
import { generateId } from '../lib/uuid';
import type { Song } from '../types';
import { Button } from './ui/Button';
import ChordDisplay from './ChordDisplay';
import ChordProToolbar from './ChordProToolbar';
import TabDisplay from './TabDisplay';
import TabSequencerModal from './TabSequencerModal';
import { LANGUAGE_NAMES } from '../utils/languages';
import { parsePastedSong } from '../utils/chordFormatParser';
import { extractTabBlocks } from '../utils/tabParser';
import { parseSongMedia } from '../utils/songMedia';
import { parseImportedSongFile, SONG_TEXT_IMPORT_ACCEPT } from '../utils/songImport';

interface Props {
  onSave: (song: Song) => Promise<string | null>;
  initialSong?: Song;
  mode?: 'add' | 'edit';
  songListOptions?: Array<{ id: string; label: string }>;
  initialSongListId?: string;
  onSongListChange?: (nextSongListId: string, previousSongListId: string, songId: string) => void;
  songPageState?: {
    backTo?: string;
    backLabel?: string;
    bandId?: string;
  };
}

const PLACEHOLDER = `{title: My Song}
{artist: Artist Name}

{start_of_verse}
[G]Amazing [C]grace, how [G]sweet the [D]sound
[G]That saved a [C]wretch like [G]me
{end_of_verse}

{start_of_chorus}
[D]I once was [G]lost but [C]now am [G]found
Was [Em]blind but [D]now I [G]see
{end_of_chorus}`;

const UNSAVED_CHANGES_WARNING = 'You have unsaved changes.';
const AUTOSAVE_DELAY_MS = 900;

type SongFormValues = {
  title: string;
  artist: string;
  author: string;
  playbackUrl: string;
  language: string;
  tags: string;
  key: string;
  tempo: string;
  timeSignature: string;
  chordpro: string;
  songListId: string;
};

export default function AddSongForm({
  onSave,
  initialSong,
  mode = 'add',
  songListOptions,
  initialSongListId,
  onSongListChange,
  songPageState,
}: Props) {
  const navigate = useNavigate();
  const [allowNavigation, setAllowNavigation] = useState(false);
  const [title, setTitle] = useState(initialSong?.title ?? '');
  const [artist, setArtist] = useState(initialSong?.artist ?? '');
  const [author, setAuthor] = useState(initialSong?.author ?? '');
  const [playbackUrl, setPlaybackUrl] = useState(initialSong?.playbackUrl ?? '');
  const [language, setLanguage] = useState(initialSong?.language ?? 'en');
  const [tags, setTags] = useState((initialSong?.tags ?? []).join(', '));
  const [key, setKey] = useState(initialSong?.key ?? '');
const [tempo, setTempo] = useState(initialSong?.tempo !== undefined ? String(initialSong.tempo) : '');
  const [timeSignature, setTimeSignature] = useState(initialSong?.timeSignature ?? '');
  const [chordpro, setChordpro] = useState(initialSong?.chordpro ?? '');
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [parseStatus, setParseStatus] = useState<string | null>(null);
  const [detectedSource, setDetectedSource] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [songListId, setSongListId] = useState(initialSongListId ?? '');
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const saveGenerationRef = useRef(0);
  const tabBlocks = useMemo(() => extractTabBlocks(chordpro), [chordpro]);
  const [editingTabIdx, setEditingTabIdx] = useState<number | null>(null);

  function replaceNthTabBlock(source: string, index: number, newTabLines: string[]): string {
    let count = 0;
    return source.replace(
      /\{start_of_tab\}([\s\S]*?)\{end_of_tab\}/gi,
      (match) => count++ === index
        ? `{start_of_tab}\n${newTabLines.join('\n')}\n{end_of_tab}`
        : match,
    );
  }

  function handleEditTabInsert(newTabLines: string[]) {
    if (editingTabIdx === null) return;
    setChordpro(prev => replaceNthTabBlock(prev, editingTabIdx, newTabLines));
    setEditingTabIdx(null);
  }

  const initialValues = useMemo<SongFormValues>(() => ({
    title: initialSong?.title ?? '',
    artist: initialSong?.artist ?? '',
    author: initialSong?.author ?? '',
    playbackUrl: initialSong?.playbackUrl ?? '',
    language: initialSong?.language ?? 'en',
    tags: (initialSong?.tags ?? []).join(', '),
    key: initialSong?.key ?? '',
    tempo: initialSong?.tempo !== undefined ? String(initialSong.tempo) : '',
    timeSignature: initialSong?.timeSignature ?? '',
    chordpro: initialSong?.chordpro ?? '',
    songListId: initialSongListId ?? '',
  }), [
    initialSong?.title,
    initialSong?.artist,
    initialSong?.author,
    initialSong?.playbackUrl,
    initialSong?.language,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    initialSong?.tags?.join(','),
    initialSong?.key,
    initialSong?.tempo,
    initialSong?.timeSignature,
    initialSong?.chordpro,
    initialSongListId,
  ]);

  const [lastSavedValues, setLastSavedValues] = useState<SongFormValues>(initialValues);
  const historyRef = useRef<SongFormValues[]>([initialValues]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const skipHistoryRef = useRef(false);
  const historyDebounceRef = useRef<number | null>(null);

  const formValues = useMemo<SongFormValues>(() => ({
    title,
    artist,
    author,
    playbackUrl,
    language,
    tags,
    key,
    tempo,
    timeSignature,
    chordpro,
    songListId,
  }), [
    title,
    artist,
    author,
    playbackUrl,
    language,
    tags,
    key,
    tempo,
    timeSignature,
    chordpro,
    songListId,
  ]);

  // Reset the undo/redo history only when a *different* song is loaded (by id),
  // not on every `initialValues` recompute — autosave round-trips the saved song
  // back through `initialSong` on every save, which would otherwise wipe the
  // history stack seconds after the user starts typing.
  useEffect(() => {
    setLastSavedValues(initialValues);
    setSaveState('idle');
    historyRef.current = [initialValues];
    setHistoryIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSong?.id]);

  const isDirty = useMemo(() => {
    return formValues.title !== lastSavedValues.title
      || formValues.artist !== lastSavedValues.artist
      || formValues.author !== lastSavedValues.author
      || formValues.playbackUrl !== lastSavedValues.playbackUrl
      || formValues.language !== lastSavedValues.language
      || formValues.tags !== lastSavedValues.tags
      || formValues.key !== lastSavedValues.key
      || formValues.tempo !== lastSavedValues.tempo
      || formValues.timeSignature !== lastSavedValues.timeSignature
      || formValues.chordpro !== lastSavedValues.chordpro
      || formValues.songListId !== lastSavedValues.songListId;
  }, [formValues, lastSavedValues]);

  const shouldBlockNavigation = isDirty && !allowNavigation;
  const blocker = useBlocker(shouldBlockNavigation);

  useBeforeUnload((event) => {
    if (!shouldBlockNavigation) return;
    event.preventDefault();
    event.returnValue = '';
  });

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    toast(UNSAVED_CHANGES_WARNING, { icon: '!' });
    blocker.reset();
  }, [blocker]);

  function validate(values: SongFormValues) {
    const errs: string[] = [];
    if (!values.title.trim()) errs.push('Title is required.');
    if (!values.chordpro.trim()) errs.push('Song content (ChordPro) is required.');
    if (values.playbackUrl.trim() && !parseSongMedia(values.playbackUrl)) {
      errs.push('Playback link must be a valid YouTube or Spotify URL.');
    }
    return errs;
  }

  const buildSong = useCallback((values: SongFormValues): Song => {
    return {
      id: initialSong?.id ?? generateId(),
      title: values.title.trim(),
      artist: values.artist.trim() || undefined,
      author: values.author.trim() || undefined,
      playbackUrl: values.playbackUrl.trim() || undefined,
      language: values.language,
      tags: values.tags.split(',').map((t) => t.trim()).filter(Boolean),
      key: values.key.trim() || undefined,
      tempo: values.tempo && !Number.isNaN(parseInt(values.tempo, 10)) ? parseInt(values.tempo, 10) : undefined,
      timeSignature: values.timeSignature.trim() || undefined,
      chordpro: values.chordpro.trim(),
      createdAt: initialSong?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }, [initialSong?.id, initialSong?.createdAt]);

  function applyParsedSong(rawText: string, source: 'manual' | 'paste') {
    const parsed = parsePastedSong(rawText, { guessTitleArtist: source === 'paste' });
    if (parsed.title) setTitle(parsed.title);
    if (parsed.artist) setArtist(parsed.artist);
    if (parsed.author) setAuthor(parsed.author);
    if (parsed.key) setKey(parsed.key);
    if (typeof parsed.tempo === 'number') setTempo(String(parsed.tempo));
    setChordpro(parsed.chordpro);
    setParseWarnings(parsed.warnings);
    setDetectedSource(parsed.detectedSource ?? null);
    setParseStatus(source === 'paste' ? 'Pasted content was parsed automatically.' : 'Text was parsed into ChordPro.');
    setErrors([]);
    setPreview(false);
  }

  async function handleSongFileImport(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;

    setIsImportingFile(true);
    try {
      const imported = await parseImportedSongFile(file);
      setTitle(imported.title);
      setArtist(imported.artist ?? '');
      if (imported.author !== undefined) {
        setAuthor(imported.author ?? '');
      }
      if (imported.language) {
        setLanguage(imported.language);
      }
      setTags((imported.tags ?? []).join(', '));
      setKey(imported.key ?? '');
      setTempo(typeof imported.tempo === 'number' ? String(imported.tempo) : '');
      setTimeSignature(imported.timeSignature ?? '');
      setChordpro(imported.chordpro);
      setParseWarnings(imported.warnings);
      setDetectedSource(imported.detectedSource ?? null);
      setParseStatus(`${mode === 'edit' ? 'Updated' : 'Imported'} from ${file.name}.`);
      setPreview(false);
      setErrors([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import this file.';
      setErrors([message]);
      toast.error(message);
    } finally {
      setIsImportingFile(false);
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
    }
  }

  function handleParsePasted() {
    if (!chordpro.trim()) {
      setErrors(['Add some content before parsing.']);
      return;
    }

    applyParsedSong(chordpro, 'manual');
  }

  function handleChordproPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pastedText = event.clipboardData.getData('text/plain');
    if (!pastedText.trim()) {
      return;
    }

    event.preventDefault();

    const textarea = event.currentTarget;
    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const nextValue = `${chordpro.slice(0, selectionStart)}${pastedText}${chordpro.slice(selectionEnd)}`;

    applyParsedSong(nextValue, 'paste');
  }

  function handleChordproChange(value: string) {
    setChordpro(value);
    setParseStatus(null);
    setDetectedSource(null);

    if (!key.trim()) {
      const match = value.match(/\{\s*key\s*:\s*([^}]+)\s*\}/i);
      if (match) {
        const extracted = match[1].trim();
        if (extracted) setKey(extracted);
      }
    }
  }

  function applyValues(values: SongFormValues) {
    skipHistoryRef.current = true;
    setTitle(values.title);
    setArtist(values.artist);
    setAuthor(values.author);
    setPlaybackUrl(values.playbackUrl);
    setLanguage(values.language);
    setTags(values.tags);
    setKey(values.key);
    setTempo(values.tempo);
    setTimeSignature(values.timeSignature);
    setChordpro(values.chordpro);
    setSongListId(values.songListId);
  }

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historyRef.current.length - 1;

  function handleUndo() {
    if (!canUndo) return;
    const newIndex = historyIndex - 1;
    applyValues(historyRef.current[newIndex]);
    setHistoryIndex(newIndex);
  }

  function handleRedo() {
    if (!canRedo) return;
    const newIndex = historyIndex + 1;
    applyValues(historyRef.current[newIndex]);
    setHistoryIndex(newIndex);
  }

  useEffect(() => {
    if (mode !== 'edit') return;

    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      return;
    }

    if (historyDebounceRef.current) {
      window.clearTimeout(historyDebounceRef.current);
    }

    historyDebounceRef.current = window.setTimeout(() => {
      setHistoryIndex(prev => {
        const currentValues = historyRef.current[prev];
        if (JSON.stringify(formValues) === JSON.stringify(currentValues)) return prev;
        const newStack = historyRef.current.slice(0, prev + 1).concat(formValues).slice(-50);
        historyRef.current = newStack;
        return newStack.length - 1;
      });
    }, 500);

    return () => {
      if (historyDebounceRef.current) {
        window.clearTimeout(historyDebounceRef.current);
        historyDebounceRef.current = null;
      }
    };
  }, [mode, formValues]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate(formValues);
    if (errs.length) { setErrors(errs); return; }

    const song = buildSong(formValues);

    const saveError = await onSave(song);
    if (saveError) {
      setErrors([`Could not save song: ${saveError}`]);
      return;
    }

    if (songListId !== initialValues.songListId) {
      onSongListChange?.(songListId, initialValues.songListId, song.id);
    }

    flushSync(() => {
      setAllowNavigation(true);
    });
    navigate(`/songs/${song.id}`, { state: songPageState });
  }

  const performSave = useCallback(async (valuesToSave: SongFormValues, previousSongListId: string) => {
    const generation = ++saveGenerationRef.current;
    const song = buildSong(valuesToSave);
    setSaveState('saving');

    try {
      const saveError = await onSave(song);
      if (generation !== saveGenerationRef.current) return saveError;
      if (saveError) {
        setErrors([`Could not save song: ${saveError}`]);
        setSaveState('error');
        return saveError;
      }

      if (valuesToSave.songListId !== previousSongListId) {
        onSongListChange?.(valuesToSave.songListId, previousSongListId, song.id);
      }

      setLastSavedValues(valuesToSave);
      setSaveState('saved');
      window.setTimeout(() => {
        setSaveState((current) => (current === 'saved' ? 'idle' : current));
      }, 1200);
      return null;
    } catch (error: unknown) {
      if (generation !== saveGenerationRef.current) return null;
      const message = error instanceof Error ? error.message : String(error);
      setErrors([`Could not save song: ${message}`]);
      setSaveState('error');
      return message;
    }
  }, [onSave, onSongListChange, buildSong]);

  useEffect(() => {
    if (mode !== 'edit') return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (editingTabIdx !== null) return;
      event.preventDefault();

      const goBack = () => {
        flushSync(() => {
          setAllowNavigation(true);
        });
        navigate(initialSong?.id ? `/songs/${initialSong.id}` : '/', { state: songPageState });
      };

      if (isDirty) {
        if (autosaveTimerRef.current) {
          window.clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = null;
        }
        const errs = validate(formValues);
        if (errs.length > 0) {
          toast.error(UNSAVED_CHANGES_WARNING);
          setErrors(errs);
          setSaveState('error');
          return;
        }
        void performSave({ ...formValues }, lastSavedValues.songListId).then((saveError) => {
          if (saveError) {
            toast.error(UNSAVED_CHANGES_WARNING);
            return;
          }
          goBack();
        });
        return;
      }

      goBack();
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [mode, isDirty, navigate, initialSong?.id, songPageState, editingTabIdx, formValues, lastSavedValues, performSave]);

  useEffect(() => {
    if (mode !== 'edit') return;

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    if (!isDirty) {
      return;
    }

    const errs = validate(formValues);
    if (errs.length > 0) {
      setErrors(errs);
      setSaveState('error');
      return;
    }

    setErrors([]);
    autosaveTimerRef.current = window.setTimeout(() => {
      void performSave({ ...formValues }, lastSavedValues.songListId);
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [mode, isDirty, formValues, lastSavedValues, performSave]);

  return (
    <>
    {editingTabIdx !== null && (
      <TabSequencerModal
        initialTabLines={tabBlocks[editingTabIdx]}
        onInsert={handleEditTabInsert}
        onClose={() => setEditingTabIdx(null)}
        tempo={tempo ? parseInt(tempo, 10) : undefined}
      />
    )}
    <div className="add-song-page">
      <h1>{mode === 'edit' ? 'Edit Song' : 'Add Song'}</h1>
      <form onSubmit={mode === 'edit' ? (e) => e.preventDefault() : handleSubmit} className="add-song-form">
        {errors.length > 0 && (
          <ul className="form-errors">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        <div className="form-metadata-section">
          <button
            type="button"
            className="form-metadata-toggle"
            onClick={() => setMetadataOpen((v) => !v)}
            aria-expanded={metadataOpen}
          >
            <span className="form-metadata-toggle-label">
              Metadata
              {!metadataOpen && (title || artist || key || tempo) && (
                <span className="form-metadata-summary">
                  {[title, artist, key && `Key: ${key}`, tempo && `${tempo} BPM`].filter(Boolean).join(' · ')}
                </span>
              )}
            </span>
            <ChevronDown size={16} className={`form-metadata-chevron${metadataOpen ? ' form-metadata-chevron--open' : ''}`} />
          </button>

          {metadataOpen && (
            <div className="form-metadata-body">
              <div className="form-row">
                <div className="form-field">
                  <label>Title *</label>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" />
                </div>
                <div className="form-field">
                  <label>Artist</label>
                  <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist / band" />
                </div>
                <div className="form-field">
                  <label>Author</label>
                  <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Songwriter" />
                </div>
              </div>

              <div className="form-row">
                <div className="form-field">
                  <label>Language</label>
                  <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                    {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
                      <option key={code} value={code}>{name}</option>
                    ))}
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>Key</label>
                  <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. G" maxLength={4} />
                </div>
                <div className="form-field">
                  <label>BPM</label>
                  <input type="number" value={tempo} onChange={(e) => setTempo(e.target.value)} min={20} max={300} placeholder="120" />
                </div>
                <div className="form-field">
                  <label>Time Signature</label>
                  <input value={timeSignature} onChange={(e) => setTimeSignature(e.target.value)} placeholder="4/4" maxLength={7} />
                </div>
              </div>

              <div className="form-field">
                <label>Playback Link (YouTube or Spotify)</label>
                <input
                  value={playbackUrl}
                  onChange={(e) => setPlaybackUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=... or https://open.spotify.com/track/..."
                />
                <p className="form-hint">This adds an inline mini player button to the song toolbar.</p>
              </div>

              <div className="form-field">
                <label>Tags (comma separated)</label>
                <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="worship, hymn, folk…" />
              </div>

              <div className="form-field">
                <label>Save to song list</label>
                <select value={songListId} onChange={(e) => setSongListId(e.target.value)}>
                  <option value="">Do not add to a list</option>
                  {songListOptions?.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="form-field form-field--full">
          <div className="chordpro-label-row">
            <label>ChordPro Lyrics *</label>
            <div className="chordpro-label-actions">
              <button
                type="button"
                className="preview-toggle"
                onClick={() => importInputRef.current?.click()}
                disabled={isImportingFile}
              >
                <FileUp size={14} /> {isImportingFile ? 'Importing…' : mode === 'edit' ? 'Update from file' : 'Import file'}
              </button>
              {mode === 'add' && (
                <button type="button" className="preview-toggle" onClick={handleParsePasted}>
                  <Wand2 size={14} /> Parse
                </button>
              )}
              <button type="button" className="preview-toggle" onClick={() => setPreview((v) => !v)}>
                {preview ? 'Edit' : 'Preview'}
              </button>
              {mode === 'add' && (
                <Button type="submit" variant="primary" className="form-submit-inline" icon={<Save size={14} />}>
                  Save Song
                </Button>
              )}
              {mode === 'edit' && !preview && (
                <>
                  <button
                    type="button"
                    className="preview-toggle"
                    onClick={handleUndo}
                    disabled={!canUndo}
                    title="Undo"
                    aria-label="Undo"
                  >
                    <Undo2 size={14} />
                  </button>
                  <button
                    type="button"
                    className="preview-toggle"
                    onClick={handleRedo}
                    disabled={!canRedo}
                    title="Redo"
                    aria-label="Redo"
                  >
                    <Redo2 size={14} />
                  </button>
                  <span
                    className={`notes-save-status ${
                      saveState === 'saving'
                        ? 'notes-save-status--saving'
                        : saveState === 'saved'
                          ? 'notes-save-status--saved'
                          : saveState === 'error'
                            ? 'notes-save-status--error'
                            : ''
                    }`}
                  >
                    {saveState === 'saving'
                      ? 'Saving…'
                      : saveState === 'saved'
                        ? 'Saved'
                        : saveState === 'error'
                          ? 'Could not autosave'
                          : 'Autosave on'}
                  </span>
                </>
              )}
            </div>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept={SONG_TEXT_IMPORT_ACCEPT}
            onChange={(event) => {
              void handleSongFileImport(event.target.files);
            }}
            style={{ display: 'none' }}
          />
          {!preview && (
            <ChordProToolbar
              textareaRef={textareaRef}
              value={chordpro}
              onChange={handleChordproChange}
              tempo={tempo ? parseInt(tempo, 10) : undefined}
              songKey={key || undefined}
            />
          )}
          {preview ? (
            <div className="chordpro-preview">
              <ChordDisplay
                chordpro={chordpro || PLACEHOLDER}
                showChords
                timeSignature={timeSignature.trim() || undefined}
              />
            </div>
          ) : (
            <>
              <textarea
                ref={textareaRef}
                value={chordpro}
                onChange={(e) => handleChordproChange(e.target.value)}
                onPaste={handleChordproPaste}
                placeholder={PLACEHOLDER}
                rows={16}
                spellCheck={false}
              />
              {tabBlocks.length > 0 && (
                <div className="tab-editor-guides">
                  <p className="form-hint tab-guide-hint">
                    Tab beat guide ({timeSignature.trim() || '4/4'}): bars start with <strong>|</strong>, beats are numbered.
                  </p>
                  {tabBlocks.map((block, idx) => (
                    <TabDisplay
                      key={`tab-guide-${idx}`}
                      tabLines={block}
                      bpm={tempo ? parseInt(tempo, 10) : undefined}
                      timeSignature={timeSignature.trim() || undefined}
                      onEdit={() => setEditingTabIdx(idx)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
          {parseWarnings.length > 0 && (
            <div className="paste-import-warnings" role="status">
              {parseWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
          {parseStatus && (
            <p className="form-hint" role="status">{parseStatus}</p>
          )}
          {detectedSource && (
            <p className="form-hint" role="status">Detected source format: {detectedSource}.</p>
          )}
          <p className="form-hint">
            Paste plain lyrics with chords to convert automatically, or write ChordPro directly{mode === 'add' ? ' and use Parse for existing text' : ''}:{' '}
            <code>[G]Amazing [C]grace</code>, <code>&#123;start_of_chorus&#125;</code>.
          </p>
        </div>

        {mode === 'add' && (
          <div className="form-actions">
            <Button type="submit" variant="primary" icon={<Save size={16} />}>
              Save Song
            </Button>
          </div>
        )}
      </form>
    </div>
    </>
  );
}
