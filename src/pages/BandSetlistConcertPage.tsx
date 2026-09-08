import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useBands } from '../context/BandsContext';
import type { Song } from '../types';
import ConcertModeView from '../components/ConcertModeView';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useBandTransposePrefs } from '../hooks/useBandTransposePrefs';
import { useSetlistSession } from '../hooks/useSetlistSession';
import { useAuth } from '../context/AuthContext';

export default function BandSetlistConcertPage() {
  const navigate = useNavigate();
  const { bandId, setlistId } = useParams<{ bandId: string; setlistId: string }>();
  const {
    bandSetlistsByBandId,
    bandSongsByBandId,
    refreshBandSetlists,
    refreshBandSongs,
  } = useBands();

  const bandSetlists = useMemo(() => (bandId ? (bandSetlistsByBandId[bandId] ?? []) : []), [bandId, bandSetlistsByBandId]);
  const bandSongs = useMemo(() => (bandId ? (bandSongsByBandId[bandId] ?? []) : []), [bandId, bandSongsByBandId]);

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
    if (bandSetlists.length === 0) {
      void refreshBandSetlists(bandId).catch(() => {});
    }
    if (bandSongs.length === 0) {
      void refreshBandSongs(bandId).catch(() => {});
    }
  }, [bandId, bandSetlists.length, bandSongs.length, refreshBandSetlists, refreshBandSongs]);

  const backRoute = bandId && setlistId
    ? `/bands/${bandId}/setlists/${setlistId}`
    : `/bands`;

  const transposeBySongId = useBandTransposePrefs(bandId);
  const { user } = useAuth();
  const session = useSetlistSession({ bandId, setlistId, currentUserId: user?.id });

  useDocumentTitle(setlist ? `${setlist.name} — Concert Mode` : 'Concert Mode');

  if (!setlist) {
    return (
      <div className="not-found">
        <p>Setlist not found.</p>
        <Link to={backRoute} className="back-link"><ArrowLeft size={16} /> Back to setlist</Link>
      </div>
    );
  }

  if (setlistSongs.length === 0) {
    return (
      <div className="not-found">
        <p>This setlist has no songs yet.</p>
        <button type="button" className="btn btn--primary" onClick={() => navigate(backRoute)}>Back to setlist</button>
      </div>
    );
  }

  return (
    <ConcertModeView
      songs={setlistSongs}
      title={setlist.name}
      backRoute={backRoute}
      songNotes={setlist.songNotes}
      bandId={bandId}
      canUseMetronome={true}
      transposeBySongId={transposeBySongId}
      session={session}
    />
  );
}
