import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from '../utils/anchoredToast';
import { FolderInput, Plus, Search, Settings, Upload, X } from 'lucide-react';
import { useBands } from '../context/BandsContext';
import { generateId } from '../lib/uuid';
import { useAuth } from '../context/AuthContext';
import SongList from '../components/SongList';
import SetlistsView from '../components/SetlistsView';
import BandTechRiderPanel from '../components/BandTechRiderPanel';
import TrashView, { type TrashListItem } from '../components/TrashView';
import PressKitView from '../components/PressKitView';
import { dataClient } from '../lib/dataClient';
import type { Song } from '../types';
import { showConfirmToast } from '../utils/toastDialogs';
import { expandSongImportSelection, SONG_IMPORT_ACCEPT } from '../utils/songImport';
import { parseImportedSongListFile, SONGLIST_JSON_IMPORT_ACCEPT } from '../utils/songListImport';
import { parseImportedSetlistFile, SETLIST_JSON_IMPORT_ACCEPT } from '../utils/setlistImport';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function BandDetailPage() {
  const { id } = useParams();
  const { pathname, state } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    bands,
    bandSongsByBandId,
    bandSongListsByBandId,
    bandSetlistsByBandId,
    bandInputListsByBandId,
    loading,
    renameBand,
    refreshBandSongs,
    refreshBandSongLists,
    refreshBandSetlists,
    refreshBandInputLists,
    addSongToBandLibrary,
    removeSongFromBandLibrary,
    renameBandSongList,
    updateBandSongListIcon,
    deleteBandSongList,
    addSongToBandSongList,
    removeSongFromBandSongList,
    renameBandSetlist,
    updateBandSetlistIcon,
    deleteBandSetlist,
    addSongToBandSetlist,
    addSongsToBandSetlist,
    moveSongInBandSetlist,
    removeSongFromBandSetlist,
    updateSongNoteInBandSetlist,
    restoreBandTrashItem,
    deleteBandTrashItemPermanently,
    bandPressKitsByBandId,
    refreshBandPressKits,
    renameBandPressKit,
    updateBandPressKitIcon,
  } = useBands();

  const band = bands.find((entry) => entry.id === id) ?? null;

  useDocumentTitle(band ? band.name : 'Band');

  const bandSongs = useMemo(() => (id ? (bandSongsByBandId[id] ?? []) : []), [bandSongsByBandId, id]);
  const bandSongLists = id ? (bandSongListsByBandId[id] ?? []) : [];
  const bandSetlists = id ? (bandSetlistsByBandId[id] ?? []) : [];
  const bandInputLists = id ? (bandInputListsByBandId[id] ?? []) : [];
  const bandPressKits = id ? (bandPressKitsByBandId[id] ?? []) : [];

  const [bandTrashItems, setBandTrashItems] = useState<TrashListItem[]>([]);
  const loadBandTrash = useCallback(async () => {
    if (!id) return;
    try {
      const items = await dataClient.bandTrash.list(id);
      setBandTrashItems(items);
    } catch (error) {
      console.error('Failed to load band trash.', error);
    }
  }, [id]);

  const allBandsSongs = useMemo(() => {
    return Object.entries(bandSongsByBandId)
      .filter(([bandId]) => bandId !== id)
      .flatMap(([, bandSongList]) => bandSongList);
  }, [bandSongsByBandId, id]);

  const routeSegments = pathname.split('/').filter(Boolean);
  const routeBandId = routeSegments[0] === 'bands' ? routeSegments[1] : null;
  const bandSection = routeBandId === id ? (routeSegments[2] ?? 'library') : 'library';
  const bandResourceId = routeBandId === id ? (routeSegments[3] ?? null) : null;
  const autoRenameState = (() => {
    if (!state || typeof state !== 'object') return null;
    const autoRename = (state as {
      autoRename?: {
        kind?: unknown;
        resourceId?: unknown;
        token?: unknown;
      };
    }).autoRename;
    if (!autoRename || typeof autoRename !== 'object') return null;
    const kind = autoRename.kind;
    const resourceId = autoRename.resourceId;
    const token = autoRename.token;
    if (kind !== 'songlist' && kind !== 'setlist' && kind !== 'rider') return null;
    if (typeof resourceId !== 'string' || !resourceId.trim()) return null;
    if (typeof token !== 'number' && typeof token !== 'string') return null;
    return { kind, resourceId, token };
  })();

  const activeBandSongList = bandSection === 'songlists'
    ? bandSongLists.find((entry) => entry.id === bandResourceId) ?? null
    : null;
  const activeBandSetlist = bandSection === 'setlists'
    ? bandSetlists.find((entry) => entry.id === bandResourceId) ?? null
    : null;
  const activeBandPressKit = bandSection === 'press-kit'
    ? bandPressKits.find((entry) => entry.id === bandResourceId) ?? null
    : null;
  const importInputRef = useRef<HTMLInputElement>(null);
  const [isImportingSongs, setIsImportingSongs] = useState(false);
  const songListImportInputRef = useRef<HTMLInputElement>(null);
  const [isImportingSongList, setIsImportingSongList] = useState(false);
  const setlistImportInputRef = useRef<HTMLInputElement>(null);
  const [isImportingSetlist, setIsImportingSetlist] = useState(false);
  const [showBandPicker, setShowBandPicker] = useState(false);
  const [bandPickerQuery, setBandPickerQuery] = useState('');
  const songsById = useMemo(() => new Map(bandSongs.map((song) => [song.id, song])), [bandSongs]);
  const bandSongIds = useMemo(() => new Set(bandSongs.map((s) => s.id)), [bandSongs]);
  const availableForImport = useMemo(() => {
    const base = allBandsSongs
      .filter((s) => !bandSongIds.has(s.id))
      .sort((a, b) => a.title.localeCompare(b.title));
    const q = bandPickerQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.artist ?? '').toLowerCase().includes(q) ||
        (s.tags ?? []).some((t) => t.toLowerCase().includes(q))
    );
  }, [allBandsSongs, bandSongIds, bandPickerQuery]);

  useEffect(() => {
    if (!id || !band) return;
    void refreshBandSongs(id).catch((error) => {
      console.error('Failed to load band songs.', error);
      toast.error('Failed to load band library.');
    });
  }, [band, id, refreshBandSongs]);

  useEffect(() => {
    if (!id || !band) return;
    void refreshBandSongLists(id).catch((error) => {
      console.error('Failed to load band songlists.', error);
    });
  }, [band, id, refreshBandSongLists]);

  useEffect(() => {
    if (!id || !band) return;
    void refreshBandSetlists(id).catch((error) => {
      console.error('Failed to load band setlists.', error);
    });
  }, [band, id, refreshBandSetlists]);

  useEffect(() => {
    if (!id || !band) return;
    void refreshBandInputLists(id).catch((error: unknown) => {
      console.error('Failed to load band technical riders.', error);
    });
  }, [band, id, refreshBandInputLists]);

  useEffect(() => {
    if (!id || !band) return;
    void loadBandTrash();
  }, [band, id, loadBandTrash]);

  useEffect(() => {
    if (!id || !band) return;
    void refreshBandPressKits(id).catch((error) => {
      console.error('Failed to load band press kits.', error);
    });
  }, [band, id, refreshBandPressKits]);

  if (loading && !band) {
    return <p className="bands-status">Loading band…</p>;
  }

  if (!band || !id) {
    return (
      <section className="bands-page">
        <p className="bands-status">Band not found.</p>
        <Link to="/profile" className="btn btn--secondary">Back to bands</Link>
      </section>
    );
  }

  const isOwner = band.ownerId === user?.id;
  const canEditBand = isOwner || band.memberRoles[user?.id ?? ''] === 'editor';

  const handleAddSong = async (songId: string) => {
    const selectedSong = allBandsSongs.find((song) => song.id === songId);
    if (!selectedSong) {
      toast.error('Select a song to add.');
      return;
    }

    const error = await addSongToBandLibrary(band.id, selectedSong);

    if (error) {
      toast.error(error);
      return;
    }
  };

  const handleDeleteSong = async (song: Song) => {
    if (!canEditBand) {
      toast.error('You do not have permission to edit this band library.');
      return;
    }

    const confirmed = await showConfirmToast(`Remove "${song.title}" from this band library? It will be moved to band trash and automatically deleted after 30 days.`, {
      confirmLabel: 'Move to trash',
    });
    if (!confirmed) return;

    const error = await removeSongFromBandLibrary(band.id, song.id);
    if (error) {
      toast.error(error);
      return;
    }

    toast.success('Song moved to band trash.');
  };

  const handleImportSongs = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!canEditBand) {
      toast.error('You do not have permission to edit this band library.');
      return;
    }

    setIsImportingSongs(true);

    // Loose song files and .zip archives (e.g. a Songbook Pro / OnSong backup) both flatten
    // to a list of parsed drafts; per-entry parse failures are collected, not fatal.
    const { items, errors: parseErrors } = await expandSongImportSelection(files);
    const failedFiles: string[] = parseErrors.map((entry) => entry.name);

    const results = await Promise.allSettled(
      items.map(async ({ draft }) => {
        const now = new Date().toISOString();
        const song: Song = {
          id: generateId(),
          title: draft.title,
          artist: draft.artist,
          author: draft.author,
          language: draft.language ?? 'en',
          secondaryLanguages: draft.secondaryLanguages,
          tags: draft.tags,
          key: draft.key,
          capo: draft.capo,
          tempo: draft.tempo,
          timeSignature: draft.timeSignature,
          chordpro: draft.chordpro,
          createdAt: now,
          updatedAt: now,
        };

        const linkError = await addSongToBandLibrary(band.id, song);
        if (linkError) {
          throw new Error(linkError);
        }
      })
    );

    let importedCount = 0;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        importedCount += 1;
      } else {
        failedFiles.push(items[index].name);
      }
    });

    if (importedCount > 0 && failedFiles.length === 0) {
      toast.success(`Imported ${importedCount} song${importedCount === 1 ? '' : 's'} to ${band.name}.`);
    } else if (importedCount > 0) {
      toast.success(`Imported ${importedCount} song${importedCount === 1 ? '' : 's'}. ${failedFiles.length} failed.`);
    } else {
      toast.error('No songs were imported.');
    }

    if (failedFiles.length > 0) {
      const examples = failedFiles.slice(0, 2).join(', ');
      toast.error(`Failed: ${examples}${failedFiles.length > 2 ? '…' : ''}`);
    }

    setIsImportingSongs(false);
    if (importInputRef.current) {
      importInputRef.current.value = '';
    }
  };

  const handleImportSongListMerge = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !activeBandSongList) return;
    if (!canEditBand) {
      toast.error('You do not have permission to edit this songlist.');
      return;
    }

    setIsImportingSongList(true);
    try {
      const draft = await parseImportedSongListFile(file);
      const existingIds = new Set(activeBandSongList.songIds);
      let addedCount = 0;
      let alreadyPresentCount = 0;
      let unmatchedCount = 0;

      for (const ref of draft.songs) {
        const match = bandSongs.find((song) => (
          song.title.trim().toLowerCase() === ref.title.trim().toLowerCase()
          && (song.artist ?? '').trim().toLowerCase() === (ref.artist ?? '').trim().toLowerCase()
        ));
        if (!match) { unmatchedCount += 1; continue; }
        if (existingIds.has(match.id)) { alreadyPresentCount += 1; continue; }
        const error = await addSongToBandSongList(band.id, activeBandSongList.id, match.id);
        if (error) { toast.error(error); continue; }
        existingIds.add(match.id);
        addedCount += 1;
      }

      const parts = [`${addedCount} song${addedCount === 1 ? '' : 's'} added`];
      if (alreadyPresentCount > 0) parts.push(`${alreadyPresentCount} already in this songlist`);
      if (unmatchedCount > 0) parts.push(`${unmatchedCount} not found in this band's library`);
      toast.success(`Imported "${draft.name}" — ${parts.join(', ')}.`, { duration: 8000 });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to import songlist.', { duration: 8000 });
    } finally {
      setIsImportingSongList(false);
      if (songListImportInputRef.current) songListImportInputRef.current.value = '';
    }
  };

  const handleImportSetlistMerge = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !activeBandSetlist) return;
    if (!canEditBand) {
      toast.error('You do not have permission to edit this setlist.');
      return;
    }

    setIsImportingSetlist(true);
    try {
      const draft = await parseImportedSetlistFile(file);
      const existingIds = new Set(activeBandSetlist.songIds);
      let addedCount = 0;
      let alreadyPresentCount = 0;
      let unmatchedCount = 0;

      for (const ref of draft.songs) {
        const match = bandSongs.find((song) => (
          song.title.trim().toLowerCase() === ref.title.trim().toLowerCase()
          && (song.artist ?? '').trim().toLowerCase() === (ref.artist ?? '').trim().toLowerCase()
        ));
        if (!match) { unmatchedCount += 1; continue; }
        if (existingIds.has(match.id)) { alreadyPresentCount += 1; continue; }
        const error = await addSongToBandSetlist(band.id, activeBandSetlist.id, match.id);
        if (error) { toast.error(error); continue; }
        if (ref.note) {
          await updateSongNoteInBandSetlist(band.id, activeBandSetlist.id, match.id, ref.note);
        }
        existingIds.add(match.id);
        addedCount += 1;
      }

      const parts = [`${addedCount} song${addedCount === 1 ? '' : 's'} added`];
      if (alreadyPresentCount > 0) parts.push(`${alreadyPresentCount} already in this setlist`);
      if (unmatchedCount > 0) parts.push(`${unmatchedCount} not found in this band's library`);
      toast.success(`Imported "${draft.name}" — ${parts.join(', ')}.`, { duration: 8000 });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to import setlist.', { duration: 8000 });
    } finally {
      setIsImportingSetlist(false);
      if (setlistImportInputRef.current) setlistImportInputRef.current.value = '';
    }
  };

  const handleRenameBand = async (name: string) => {
    const error = await renameBand(band.id, name);
    if (error) {
      toast.error(error);
      return;
    }

    toast.success('Band renamed.');
  };

  const handleDeleteBandSongList = async () => {
    if (!activeBandSongList) return;

    const confirmed = await showConfirmToast(
      `Move songlist "${activeBandSongList.name}" to trash? It will be automatically deleted after 30 days.`,
      { confirmLabel: 'Move to trash' }
    );
    if (!confirmed) return;

    const error = await deleteBandSongList(band.id, activeBandSongList.id);
    if (error) {
      toast.error(error);
      return;
    }

    navigate(`/bands/${band.id}/library`);
  };

  const handleDeleteBandSetlist = async () => {
    if (!activeBandSetlist) return;

    const confirmed = await showConfirmToast(
      `Move setlist "${activeBandSetlist.name}" to trash? It will be automatically deleted after 30 days.`,
      { confirmLabel: 'Move to trash' }
    );
    if (!confirmed) return;

    const error = await deleteBandSetlist(band.id, activeBandSetlist.id);
    if (error) {
      toast.error(error);
      return;
    }

    navigate(`/bands/${band.id}/library`);
  };

  if (bandSection === 'songlists') {
    if (!activeBandSongList) {
      return (
        <section className="bands-page">
          <p className="bands-status">Band songlist not found.</p>
          <Link to={`/bands/${band.id}/library`} className="btn btn--secondary">Back to band library</Link>
        </section>
      );
    }

    const songListSongs = activeBandSongList.songIds
      .map((songId) => songsById.get(songId))
      .filter((song): song is Song => Boolean(song));

    return (
      <section className="bands-page bands-page--library">
        <input
          ref={songListImportInputRef}
          type="file"
          accept={SONGLIST_JSON_IMPORT_ACCEPT}
          onChange={(event) => { void handleImportSongListMerge(event.target.files); }}
          style={{ display: 'none' }}
        />
        <SongList
          songs={songListSongs}
          listName={activeBandSongList.name}
          listIcon={activeBandSongList.icon}
          headerMeta={undefined}
          headerVariant="bands"
          allSongs={bandSongs}
          pickerSourceNote="Showing songs from this band's library."
          headerActions={canEditBand ? (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => songListImportInputRef.current?.click()}
              title={isImportingSongList ? 'Importing songlist…' : 'Import songlist from file'}
              aria-label="Import songlist from file"
              disabled={isImportingSongList}
            >
              <Upload size={14} />
            </button>
          ) : undefined}
          onAddSong={async (songId) => {
            const error = await addSongToBandSongList(band.id, activeBandSongList.id, songId);
            if (error) {
              toast.error(error);
            }
          }}
          onDeleteSong={handleDeleteSong}
          onRenameList={canEditBand ? async (name) => {
            const error = await renameBandSongList(band.id, activeBandSongList.id, name);
            if (error) {
              toast.error(error);
            }
          } : undefined}
          onUpdateListAppearance={canEditBand ? async (appearance) => {
            const error = await updateBandSongListIcon(band.id, activeBandSongList.id, appearance.icon);
            if (error) {
              toast.error(error);
            }
          } : undefined}
          onDeleteList={canEditBand ? () => void handleDeleteBandSongList() : undefined}
          deleteListLabel={`Delete songlist ${activeBandSongList.name}`}
          onRemoveSong={canEditBand ? async (song) => {
            const error = await removeSongFromBandSongList(band.id, activeBandSongList.id, song.id);
            if (error) {
              toast.error(error);
            }
          } : undefined}
          bandId={band.id}
          autoStartRenameToken={
            autoRenameState?.kind === 'songlist' && autoRenameState.resourceId === activeBandSongList.id
              ? autoRenameState.token
              : null
          }
        />
      </section>
    );
  }

  if (bandSection === 'setlists') {
    if (!activeBandSetlist) {
      return (
        <section className="bands-page">
          <p className="bands-status">Band setlist not found.</p>
          <Link to={`/bands/${band.id}/library`} className="btn btn--secondary">Back to band library</Link>
        </section>
      );
    }

    const setlistSongs = activeBandSetlist.songIds
      .map((songId) => songsById.get(songId))
      .filter((song): song is Song => Boolean(song));

    return (
      <section className="bands-page bands-page--library">
        <input
          ref={setlistImportInputRef}
          type="file"
          accept={SETLIST_JSON_IMPORT_ACCEPT}
          onChange={(event) => { void handleImportSetlistMerge(event.target.files); }}
          style={{ display: 'none' }}
        />
        <SetlistsView
          headerVariant="bands"
          setlistId={activeBandSetlist.id}
          setlistName={activeBandSetlist.name}
          songs={setlistSongs}
          songNotes={activeBandSetlist.songNotes}
          allSongs={bandSongs}
          availableSongLists={bandSongLists}
          bandId={band.id}
          setlistIconOverride={activeBandSetlist.icon}
          canDeleteOverride={canEditBand}
          canEdit={canEditBand}
          concertRoute={`/bands/${band.id}/setlists/${activeBandSetlist.id}/concert`}
          extraActions={canEditBand ? (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setlistImportInputRef.current?.click()}
              title={isImportingSetlist ? 'Importing setlist…' : 'Import setlist from file'}
              aria-label="Import setlist from file"
              disabled={isImportingSetlist}
            >
              <Upload size={14} />
            </button>
          ) : undefined}
          onRenameOverride={canEditBand ? async (name) => {
            const error = await renameBandSetlist(band.id, activeBandSetlist.id, name);
            if (error) {
              toast.error(error);
            }
          } : undefined}
          onDeleteOverride={canEditBand ? () => void handleDeleteBandSetlist() : undefined}
          onUpdateIconOverride={canEditBand ? async (icon) => {
            const error = await updateBandSetlistIcon(band.id, activeBandSetlist.id, icon);
            if (error) {
              toast.error(error);
            }
          } : undefined}
          onMoveSong={async (songId, beforeSongId) => {
            if (!canEditBand) return;
            const error = await moveSongInBandSetlist(band.id, activeBandSetlist.id, songId, beforeSongId);
            if (error) {
              toast.error(error);
            }
          }}
          onAddSong={async (songId) => {
            const error = await addSongToBandSetlist(band.id, activeBandSetlist.id, songId);
            if (error) {
              toast.error(error);
            }
          }}
          onAddSongs={async (songIds) => {
            const error = await addSongsToBandSetlist(band.id, activeBandSetlist.id, songIds);
            if (error) {
              toast.error(error);
            }
          }}
          onUpdateSongNote={async (songId, note) => {
            if (!canEditBand) return;
            const error = await updateSongNoteInBandSetlist(band.id, activeBandSetlist.id, songId, note);
            if (error) {
              toast.error(error);
            }
          }}
          onRemoveSong={async (songId) => {
            if (!canEditBand) return;
            const error = await removeSongFromBandSetlist(band.id, activeBandSetlist.id, songId);
            if (error) {
              toast.error(error);
            }
          }}
          autoStartRenameToken={
            autoRenameState?.kind === 'setlist' && autoRenameState.resourceId === activeBandSetlist.id
              ? autoRenameState.token
              : null
          }
        />
      </section>
    );
  }

  if (bandSection === 'riders') {
    return (
      <BandTechRiderPanel
        bandId={band.id}
        bandName={band.name}
        riders={bandInputLists}
        canEdit={canEditBand}
        initialRiderId={bandResourceId}
        autoStartRenameToken={
          autoRenameState?.kind === 'rider' && autoRenameState.resourceId === bandResourceId
            ? autoRenameState.token
            : null
        }
      />
    );
  }

  if (bandSection === 'press-kit' && activeBandPressKit) {
    return (
      <PressKitView
        bandId={band.id}
        bandName={band.name}
        kit={activeBandPressKit}
        canEdit={canEditBand}
        userId={user?.id ?? null}
        userEmail={user?.email ?? null}
        onDelete={() => { navigate(`/bands/${band.id}/press-kit`); }}
        onRename={canEditBand ? async (name) => {
          const error = await renameBandPressKit(band.id, activeBandPressKit.id, name);
          if (error) toast.error(error);
        } : undefined}
        onUpdateIcon={canEditBand ? async (icon) => {
          const error = await updateBandPressKitIcon(band.id, activeBandPressKit.id, icon);
          if (error) toast.error(error);
        } : undefined}
      />
    );
  }

  if (bandSection === 'trash') {
    return (
      <TrashView
        headerVariant="bands"
        title={`${band.name} Trash`}
        emptyMessage="Trash is empty."
        items={bandTrashItems}
        onRestore={canEditBand ? async (trashId) => {
          const error = await restoreBandTrashItem(band.id, trashId);
          await loadBandTrash();
          return error;
        } : undefined}
        onDeletePermanently={isOwner ? async (trashId) => {
          const error = await deleteBandTrashItemPermanently(band.id, trashId);
          await loadBandTrash();
          return error;
        } : undefined}
        onEmptyTrash={isOwner ? async () => {
          const error = await dataClient.bandTrash.empty(band.id);
          await loadBandTrash();
          return error;
        } : undefined}
      />
    );
  }

  const closeBandPicker = () => {
    setShowBandPicker(false);
    setBandPickerQuery('');
  };

  return (
    <section className="bands-page bands-page--library">
      <input
        ref={importInputRef}
        type="file"
        accept={SONG_IMPORT_ACCEPT}
        multiple
        onChange={(event) => {
          void handleImportSongs(event.target.files);
        }}
        style={{ display: 'none' }}
      />
      <SongList
        songs={bandSongs}
        listName={band.name}
        listEntityLabel="band"
        headerMeta={`${band.memberIds.length} member${band.memberIds.length === 1 ? '' : 's'} in this band.`}
        headerVariant="bands"
        onRenameList={canEditBand ? (name) => void handleRenameBand(name) : undefined}
        headerActions={(
          <>
            {canEditBand && allBandsSongs.length > 0 && (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setShowBandPicker(true)}
                title="Add song from another band library"
                aria-label="Add song from another band library"
              >
                <FolderInput size={14} />
              </button>
            )}
            {canEditBand && (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => importInputRef.current?.click()}
                title={isImportingSongs ? 'Importing songs…' : 'Import song files or a .zip backup (ChordPro, OnSong, Ultimate Guitar…)'}
                aria-label={isImportingSongs ? 'Importing songs' : 'Import song files or a zip backup'}
                disabled={isImportingSongs}
              >
                <Upload size={14} />
              </button>
            )}
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => navigate(isOwner ? `/bands/${band.id}/settings` : `/bands/${band.id}/members`)}
              title="Band settings"
            >
              <Settings size={14} />
            </button>
          </>
        )}
        onDeleteSong={handleDeleteSong}
        bandId={band.id}
      />

      {showBandPicker && (
        <div className="song-picker-overlay" role="dialog" aria-modal="true" aria-label="Add song from another band library">
          <div className="song-picker-panel">
            <div className="song-picker-header">
              <h2>Add song from another band</h2>
              <button className="song-picker-close" onClick={closeBandPicker} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <p className="song-picker-source-note">Showing songs from your other band libraries.</p>
            <div className="song-picker-search-wrap">
              <Search size={15} className="song-picker-search-icon" />
              <input
                type="text"
                className="song-picker-search"
                value={bandPickerQuery}
                onChange={(e) => setBandPickerQuery(e.target.value)}
                placeholder="Search by title, artist, or tag"
                autoFocus
              />
            </div>
            <div className="song-picker-results" role="list">
              {availableForImport.length === 0 ? (
                <p className="song-picker-empty">No songs available to add.</p>
              ) : (
                availableForImport.map((song) => (
                  <div key={song.id} className="song-picker-item" role="listitem">
                    <div className="song-picker-item-main">
                      <span className="song-picker-song-title">{song.title}</span>
                      {song.artist && <span className="song-picker-song-artist">{song.artist}</span>}
                    </div>
                    <button
                      className="song-picker-add-btn"
                      onClick={() => void handleAddSong(song.id)}
                      title={`Add ${song.title}`}
                    >
                      <Plus size={14} /> Add
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="song-picker-footer">
              <button className="btn btn--primary" onClick={closeBandPicker}>Done</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}