import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { useBands } from '../context/BandsContext';
import type { Song } from '../types';
import ChordDisplay from '../components/ChordDisplay';
import LanguageBadge from '../components/LanguageBadge';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

type PrintLayout = 'sheet' | 'charts';

function songMetaLine(song: Song): string {
  const parts: string[] = [];
  if (song.key) parts.push(`Key ${song.key}`);
  if (song.capo && song.capo > 0) parts.push(`Capo ${song.capo}`);
  if (song.tempo) parts.push(`${song.tempo} BPM`);
  if (song.timeSignature) parts.push(song.timeSignature);
  return parts.join(' · ');
}

export default function BandSetlistPrintPage() {
  const { bandId, setlistId } = useParams<{ bandId: string; setlistId: string }>();
  const {
    bands,
    bandSetlistsByBandId,
    bandSongsByBandId,
    refreshBandSetlists,
    refreshBandSongs,
  } = useBands();

  const [layout, setLayout] = useState<PrintLayout>('sheet');

  const bandSetlists = useMemo(
    () => (bandId ? (bandSetlistsByBandId[bandId] ?? []) : []),
    [bandId, bandSetlistsByBandId],
  );
  const bandSongs = useMemo(
    () => (bandId ? (bandSongsByBandId[bandId] ?? []) : []),
    [bandId, bandSongsByBandId],
  );

  const band = useMemo(() => bands.find((entry) => entry.id === bandId) ?? null, [bands, bandId]);
  const setlist = useMemo(
    () => bandSetlists.find((entry) => entry.id === setlistId) ?? null,
    [bandSetlists, setlistId],
  );
  const songsById = useMemo(() => new Map(bandSongs.map((song) => [song.id, song])), [bandSongs]);
  const setlistSongs = useMemo(
    () => (setlist?.songIds ?? [])
      .map((songId) => songsById.get(songId))
      .filter((song): song is Song => Boolean(song)),
    [setlist?.songIds, songsById],
  );

  useEffect(() => {
    if (!bandId) return;
    if (bandSetlists.length === 0) void refreshBandSetlists(bandId).catch(() => {});
    if (bandSongs.length === 0) void refreshBandSongs(bandId).catch(() => {});
  }, [bandId, bandSetlists.length, bandSongs.length, refreshBandSetlists, refreshBandSongs]);

  const backRoute = bandId && setlistId
    ? `/bands/${bandId}/setlists/${setlistId}`
    : '/bands';

  useDocumentTitle(setlist ? `${setlist.name} — Print` : 'Print setlist');

  if (!setlist) {
    return (
      <div className="not-found">
        <p>Setlist not found.</p>
        <Link to={backRoute} className="back-link"><ArrowLeft size={16} /> Back to setlist</Link>
      </div>
    );
  }

  return (
    <section className="setlist-print">
      <div className="setlist-print-toolbar">
        <Link to={backRoute} className="back-link"><ArrowLeft size={15} /> Back</Link>
        <div className="setlist-print-toolbar-controls">
          <div className="setlist-print-layout-toggle" role="group" aria-label="Print layout">
            <button
              type="button"
              className={layout === 'sheet' ? 'is-active' : ''}
              onClick={() => setLayout('sheet')}
            >
              Setlist sheet
            </button>
            <button
              type="button"
              className={layout === 'charts' ? 'is-active' : ''}
              onClick={() => setLayout('charts')}
            >
              Full charts
            </button>
          </div>
          <button
            type="button"
            className="btn btn--concert"
            onClick={() => window.print()}
          >
            <Printer size={14} /> Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="setlist-print-sheet">
        <header className="setlist-print-header">
          {band?.name && <p className="setlist-print-band">{band.name}</p>}
          <h1>{setlist.name}</h1>
          <p className="setlist-print-count">
            {setlistSongs.length} song{setlistSongs.length === 1 ? '' : 's'}
          </p>
        </header>

        {setlistSongs.length === 0 ? (
          <p>This setlist has no songs yet.</p>
        ) : layout === 'sheet' ? (
          <ol className="setlist-print-list">
            {setlistSongs.map((song) => {
              const meta = songMetaLine(song);
              const note = setlist.songNotes?.[song.id]?.trim();
              return (
                <li key={song.id}>
                  <span className="setlist-print-song-title">{song.title}</span>
                  {song.artist && <span className="setlist-print-song-artist"> — {song.artist}</span>}
                  {meta && <span className="setlist-print-song-meta"> ({meta})</span>}
                  {note && <span className="setlist-print-song-note">{note}</span>}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="setlist-print-charts">
            {setlistSongs.map((song, index) => (
              <article key={song.id} className="setlist-print-chart">
                <header className="setlist-print-chart-header">
                  <h2>
                    <span className="setlist-print-chart-number">{index + 1}.</span> {song.title}
                  </h2>
                  <p className="setlist-print-chart-meta">
                    {song.artist && <span>{song.artist}</span>}
                    <LanguageBadge code={song.language} />
                    {songMetaLine(song) && <span>{songMetaLine(song)}</span>}
                  </p>
                  {setlist.songNotes?.[song.id]?.trim() && (
                    <p className="setlist-print-chart-note">{setlist.songNotes[song.id]}</p>
                  )}
                </header>
                <ChordDisplay
                  chordpro={song.chordpro}
                  transpose={song.preferredTranspose ?? 0}
                  showChords
                  hideMetaDirectives
                />
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
