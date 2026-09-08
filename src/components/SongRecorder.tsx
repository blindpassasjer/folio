import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Play, Pause, Trash2, Save, X, Pencil, Check, Upload, MessageSquare } from 'lucide-react';
import { useSongRecordings } from '../hooks/useSongRecordings';
import { useRecordingComments } from '../hooks/useRecordingComments';
import { useStorageUsage } from '../hooks/useStorageUsage';
import type { Song } from '../types';
import type { User } from '../context/AuthContext';
import type { SongRecording } from '../lib/songRecordings';
import { showConfirmToast } from '../utils/toastDialogs';
import { markReloadUnsafe } from '../lib/reloadGuard';
import { getMicrophoneUnavailableReason } from '../lib/mediaAccess';
import { createResumedAudioContext, pickRecordingMimeType } from '../lib/webAudio';

const WAVEFORM_SAMPLES = 100;

interface Props {
  song: Song;
  user: User;
  /** All songs are band-owned — recordings are stored under this band */
  bandId: string;
}

type RecorderState = 'idle' | 'recording' | 'preview';

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDateTime(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RecorderAvatar({ avatar, name }: { avatar: string | null; name: string }) {
  if (avatar) {
    return <span className="rec-avatar rec-avatar--emoji" title={name}>{avatar}</span>;
  }
  const initials = name.trim().slice(0, 1).toUpperCase();
  return <span className="rec-avatar rec-avatar--initials" title={name}>{initials}</span>;
}

interface WaveformProgressProps {
  audioUrl: string;
  progress: number;
  onSeek: (e: React.MouseEvent<HTMLDivElement>) => void;
  ariaLabel: string;
  className?: string;
  waveformBars?: number[];
}

function computeWaveformPeaks(channelData: Float32Array, samples = WAVEFORM_SAMPLES): number[] {
  if (channelData.length === 0) {
    return Array.from({ length: samples }, () => 0.12);
  }

  const blockSize = Math.max(1, Math.floor(channelData.length / samples));
  const peaks = Array.from({ length: samples }, (_, index) => {
    const start = index * blockSize;
    const end = Math.min(channelData.length, start + blockSize);
    let peak = 0;

    for (let cursor = start; cursor < end; cursor += 1) {
      const amplitude = Math.abs(channelData[cursor]);
      if (amplitude > peak) peak = amplitude;
    }

    return peak;
  });

  const maxPeak = Math.max(...peaks, 0.01);

  return peaks.map((peak) => {
    const normalized = peak / maxPeak;
    // Power curve < 1 expands quiet parts upward; > 1 exaggerates dynamics.
    // 0.5 (sqrt) compresses — we want the opposite: use power > 1 so loud
    // peaks stay tall and quiet parts shrink toward the floor.
    const exaggerated = Math.pow(normalized, 1.8);
    return Math.max(0.04, exaggerated * 0.96);
  });
}

async function computeWaveformPeaksFromBlob(blob: Blob, samples = WAVEFORM_SAMPLES): Promise<number[]> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return computeWaveformPeaks(audioBuffer.getChannelData(0), samples);
  } finally {
    void audioContext.close();
  }
}

// Minimum pixel span (bar + gap) a bar needs to stay visible instead of
// collapsing to sub-pixel width — the floating recorder card is narrow
// (max-width 360px) so 100 fixed bars can shrink to nothing there.
const MIN_BAR_SPAN_PX = 4;

function downsampleBars(bars: number[], count: number): number[] {
  if (count >= bars.length) return bars;
  const blockSize = bars.length / count;
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * blockSize);
    const end = Math.max(start + 1, Math.floor((index + 1) * blockSize));
    let peak = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      if (bars[cursor] > peak) peak = bars[cursor];
    }
    return peak;
  });
}

function WaveformProgress({ audioUrl, progress, onSeek, ariaLabel, className, waveformBars }: WaveformProgressProps) {
  const [bars, setBars] = useState<number[] | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [visibleBarCount, setVisibleBarCount] = useState(WAVEFORM_SAMPLES);
  const barsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();

    async function loadWaveform() {
      if (waveformBars && waveformBars.length > 0) {
        setBars(waveformBars);
        return;
      }

      try {
        const response = await fetch(audioUrl, { signal: abortController.signal });
        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new AudioContext();

        try {
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          if (cancelled) return;
          setBars(computeWaveformPeaks(audioBuffer.getChannelData(0)));
        } finally {
          void audioContext.close();
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setBars(Array.from({ length: WAVEFORM_SAMPLES }, () => 0.3));
        }
      }
    }

    setBars(null);
    void loadWaveform();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [audioUrl, waveformBars]);

  useEffect(() => {
    const el = barsContainerRef.current;
    if (!el) return;

    function updateVisibleCount(width: number) {
      const fitted = Math.floor(width / MIN_BAR_SPAN_PX);
      setVisibleBarCount(Math.max(16, Math.min(WAVEFORM_SAMPLES, fitted)));
    }

    updateVisibleCount(el.offsetWidth);
    const observer = new ResizeObserver(([entry]) => updateVisibleCount(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fullBars = bars ?? Array.from({ length: WAVEFORM_SAMPLES }, () => 0.24);
  const renderedBars = downsampleBars(fullBars, visibleBarCount);

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverRatio((e.clientX - rect.left) / rect.width);
  }

  return (
    <div
      className={`waveform-progress${className ? ` ${className}` : ''}`}
      onClick={onSeek}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverRatio(null)}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
    >
      <div className="waveform-progress__bars" aria-hidden="true" ref={barsContainerRef}>
        {renderedBars.map((height, index) => {
          const barRatio = (index + 1) / renderedBars.length;
          const isPlayed = barRatio <= progress;
          const isHovered = !isPlayed && hoverRatio !== null && barRatio <= hoverRatio;

          return (
            <span
              key={`${audioUrl}-${index}`}
              className={`waveform-progress__bar${isPlayed ? ' waveform-progress__bar--played' : isHovered ? ' waveform-progress__bar--hover' : ''}`}
              style={{ height: `${Math.round(height * 100)}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}

interface SavedPlayerProps {
  recording: SongRecording;
  currentUserId: string;
  bandId: string;
  songId: string;
  onDelete: (r: SongRecording) => void;
  onRename: (r: SongRecording, newName: string) => void;
}

function SavedPlayer({ recording, currentUserId, bandId, songId, onDelete, onRename }: SavedPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showComments, setShowComments] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const durationMs = recording.durationMs;
  const seekToMs = (ms: number) => {
    const el = audioRef.current;
    if (el) el.currentTime = ms / 1000;
  };

  const comments = useRecordingComments({
    bandId,
    songId,
    recordingId: recording.id,
    enabled: showComments,
  });
  const commentCount = comments.comments.length || recording.commentCount || 0;
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  function togglePlay() {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      void audioRef.current.play();
    }
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    if (!audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const audio = audioRef.current;
    const duration = isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : recording.durationMs / 1000;
    if (duration > 0) audio.currentTime = ratio * duration;
  }

  function openRename() {
    setRenameValue(recording.name);
    setRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }

  function confirmRename() {
    const nextName = renameValue.trim() || recording.name;
    onRename(recording, nextName);
    setRenaming(false);
  }

  function cancelRename() {
    setRenameValue(recording.name);
    setRenaming(false);
  }

  async function confirmDelete() {
    const confirmed = await showConfirmToast(`Delete recording "${recording.name}"? This cannot be undone.`, {
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    });
    if (!confirmed) return;
    onDelete(recording);
  }

  const canRename = recording.recorder?.userId === currentUserId;
  const canDelete = recording.recorder?.userId === currentUserId;

  return (
    <li className="audio-player audio-player--saved">
      <audio
        ref={audioRef}
        src={recording.downloadUrl}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => { setIsPlaying(false); setProgress(0); }}
        onTimeUpdate={() => {
          const el = audioRef.current;
          const dur = el && (isFinite(el.duration) && el.duration > 0 ? el.duration : recording.durationMs / 1000);
          if (el && dur) setProgress(el.currentTime / dur);
        }}
        onSeeked={() => {
          const el = audioRef.current;
          const dur = el && (isFinite(el.duration) && el.duration > 0 ? el.duration : recording.durationMs / 1000);
          if (el && dur) setProgress(el.currentTime / dur);
        }}
      />
      <div className="recorder-preview-playback">
        <button className="play-btn" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>

        <div className="recorder-waveform-wrap">
          <WaveformProgress
            audioUrl={recording.downloadUrl}
            progress={progress}
            onSeek={handleSeek}
            ariaLabel="Seek"
            className="recorder-preview-bar"
            waveformBars={recording.waveformBars}
          />
          {durationMs > 0 && comments.comments.map((comment) => (
            comment.atMs === null ? null : (
              <button
                key={comment.id}
                type="button"
                className="recording-comment-marker"
                style={{ left: `${Math.min(100, (comment.atMs / durationMs) * 100)}%` }}
                title={`${formatTime(comment.atMs)} — ${comment.body}`}
                aria-label={`Jump to comment at ${formatTime(comment.atMs)}`}
                onClick={() => seekToMs(comment.atMs!)}
              />
            )
          ))}
        </div>

        <span className="recorder-elapsed" title="Duration">
          {formatTime(progress * recording.durationMs)} / {formatTime(recording.durationMs)}
        </span>
      </div>

      <div className="recording-rename-row">
        <div className="player-info">
          {renaming ? (
            <input
              ref={renameInputRef}
              className="player-name-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={confirmRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRename();
                if (e.key === 'Escape') cancelRename();
              }}
              aria-label="Rename recording"
            />
          ) : (
            <span className="player-name" title={recording.name}>{recording.name}</span>
          )}
          <span className="player-date">
            {new Date(recording.createdAt).toLocaleString()} · {formatFileSize(recording.sizeBytes)}
          </span>
        </div>

        {recording.recorder && (
          <RecorderAvatar
            avatar={recording.recorder.avatar}
            name={recording.recorder.displayName}
          />
        )}

        {canRename && (
          renaming ? (
            <>
              <button
                className="icon-btn icon-btn--confirm"
                onClick={confirmRename}
                aria-label="Confirm rename"
                title="Confirm"
              >
                <Check size={14} />
              </button>
              <button
                className="icon-btn icon-btn--cancel"
                onClick={cancelRename}
                aria-label="Cancel rename"
                title="Cancel"
              >
                <X size={14} />
              </button>
            </>
          ) : (
            <button
              className="icon-btn icon-btn--rename"
              onClick={openRename}
              aria-label={`Rename recording ${recording.name}`}
              title="Rename"
            >
              <Pencil size={14} />
            </button>
          )
        )}

        {canDelete && (
          <button
            className="icon-btn icon-btn--delete"
            onClick={() => {
              void confirmDelete();
            }}
            aria-label={`Delete recording ${recording.name}`}
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <button
        type="button"
        className={`recording-comments-toggle${showComments ? ' recording-comments-toggle--open' : ''}`}
        onClick={() => setShowComments((v) => !v)}
      >
        <MessageSquare size={13} />
        {commentCount > 0 ? `${commentCount} comment${commentCount === 1 ? '' : 's'}` : 'Comments'}
      </button>

      {showComments && (
        <RecordingCommentsSection
          comments={comments}
          currentUserId={currentUserId}
          currentPlayheadMs={progress * durationMs}
          onSeek={seekToMs}
        />
      )}
    </li>
  );
}

interface RecordingCommentsSectionProps {
  comments: ReturnType<typeof useRecordingComments>;
  currentUserId: string;
  currentPlayheadMs: number;
  onSeek: (ms: number) => void;
}

function RecordingCommentsSection({
  comments,
  currentUserId,
  currentPlayheadMs,
  onSeek,
}: RecordingCommentsSectionProps) {
  const [draft, setDraft] = useState('');
  const [pinToTime, setPinToTime] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const body = draft.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      await comments.add(body, pinToTime ? Math.round(currentPlayheadMs) : null);
      setDraft('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="recording-comments">
      {comments.loading ? (
        <p className="recording-comments-empty">Loading…</p>
      ) : comments.error ? (
        <p className="recording-comments-empty">{comments.error}</p>
      ) : comments.comments.length === 0 ? (
        <p className="recording-comments-empty">No comments yet.</p>
      ) : (
        <ul className="recording-comments-list">
          {comments.comments.map((comment) => (
            <li key={comment.id} className="recording-comment">
              <div className="recording-comment-head">
                {comment.atMs !== null && (
                  <button
                    type="button"
                    className="recording-comment-timestamp"
                    onClick={() => onSeek(comment.atMs!)}
                  >
                    {formatTime(comment.atMs)}
                  </button>
                )}
                <strong>{comment.authorDisplayName || 'Someone'}</strong>
                {comment.authorUserId === currentUserId && (
                  <button
                    type="button"
                    className="recording-comment-delete"
                    onClick={() => { void comments.remove(comment.id); }}
                    aria-label="Delete comment"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
              <p className="recording-comment-body">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="recording-comment-form">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note about this take…"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <label className="recording-comment-pin">
          <input type="checkbox" checked={pinToTime} onChange={(e) => setPinToTime(e.target.checked)} />
          Pin to {formatTime(currentPlayheadMs)}
        </label>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => { void submit(); }}
          disabled={!draft.trim() || submitting}
        >
          {submitting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}

export default function SongRecorder({ song, user, bandId }: Props) {
  const { recordings, loading, uploading, uploadError, uploadRecording, deleteRecording, renameRecording } = useSongRecordings({
    bandId,
    songId: song.id,
  });
  const storageQuotaBytes = user.storageQuotaBytes;
  const { usedBytes } = useStorageUsage(user.id);

  const [recState, setRecState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewName, setPreviewName] = useState('');
  const [previewDurationMs, setPreviewDurationMs] = useState(0);
  const [previewWaveformBars, setPreviewWaveformBars] = useState<number[] | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [error, setError] = useState<string | null>(uploadError);

  useEffect(() => {
    if (uploadError) {
      setError(uploadError);
    }
  }, [uploadError]);

  // Recording/preview state lives only in memory (MediaRecorder blob, not yet
  // saved) — a background app reload would silently drop it with no warning,
  // unlike form edits which get a beforeunload prompt.
  useEffect(() => {
    if (recState === 'idle') return;
    return markReloadUnsafe();
  }, [recState]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const elapsedStartRef = useRef<number>(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  previewUrlRef.current = previewUrl;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopStream();
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [stopStream]);

  async function startRecording() {
    setError(null);
    const unavailableReason = getMicrophoneUnavailableReason();
    if (unavailableReason) {
      setError(unavailableReason);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000,
        },
      });

      const ctx = await createResumedAudioContext({ sampleRate: 48000 });
      const source = ctx.createMediaStreamSource(stream);

      const hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = 80;

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;

      const dest = ctx.createMediaStreamDestination();
      source.connect(hpf);
      hpf.connect(limiter);
      limiter.connect(dest);

      streamRef.current = stream;
      audioCtxRef.current = ctx;

      // Safari's MediaRecorder only produces MP4/AAC — it cannot make WebM at all, and
      // passing an unsupported mimeType throws. Negotiate a format the browser can
      // actually record (or let it pick its own and read it back).
      const preferredMime = pickRecordingMimeType();
      const recorder = preferredMime
        ? new MediaRecorder(dest.stream, { mimeType: preferredMime })
        : new MediaRecorder(dest.stream);
      const mime = recorder.mimeType || preferredMime || 'audio/webm';
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const durationMs = Date.now() - elapsedStartRef.current;
        // Prefer the recorder's own reported type (most accurate after recording); fall
        // back to the negotiated one. Strip codec params for a clean, server-accepted mime.
        const recordedMime = (recorder.mimeType || mime).split(';')[0].trim() || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: recordedMime });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewBlob(blob);
        setPreviewDurationMs(durationMs);
        setPreviewWaveformBars(null);
        void computeWaveformPeaksFromBlob(blob)
          .then((bars) => setPreviewWaveformBars(bars))
          .catch((err) => {
            console.error('Failed to compute waveform peaks:', err);
            setPreviewWaveformBars(null);
          });
        setPreviewName(`${song.title} - ${formatDateTime(new Date())}`);
        setPreviewProgress(0);
        setIsPreviewPlaying(false);
        setRecState('preview');
        stopStream();
        if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
        setElapsed(0);
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      elapsedStartRef.current = Date.now();
      elapsedTimerRef.current = setInterval(() => {
        setElapsed(Date.now() - elapsedStartRef.current);
      }, 500);

      setRecState('recording');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.toLowerCase().includes('denied') ? 'Microphone access denied' : `Mic error: ${msg}`);
    }
  }

  function stopRecording() {
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }

  function triggerFileUpload() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    if (!file.type.startsWith('audio/')) {
      setError('Please select an audio file');
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new AudioContext();
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      } finally {
        void audioContext.close();
      }

      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      setPreviewBlob(file);
      setPreviewDurationMs(audioBuffer.duration * 1000);
      setPreviewWaveformBars(computeWaveformPeaks(audioBuffer.getChannelData(0)));
      setPreviewName(file.name.replace(/\.[^./]+$/, ''));
      setPreviewProgress(0);
      setIsPreviewPlaying(false);
      setRecState('preview');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Couldn't read audio file: ${msg}`);
    }
  }

  function discardPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewBlob(null);
    setPreviewWaveformBars(null);
    setIsPreviewPlaying(false);
    setPreviewProgress(0);
    setRecState('idle');
  }

  async function saveRecording() {
    if (!previewBlob) return;
    // Storage quota check
    if (usedBytes + previewBlob.size > storageQuotaBytes) {
      setError(`Storage quota exceeded. You've used ${Math.round(usedBytes / (1024 * 1024))} MB of your ${Math.round(storageQuotaBytes / (1024 * 1024))} MB limit.`);
      return;
    }
    const displayName = user.fullName?.trim() || user.username?.trim() || user.email;
    setError(null);
    try {
      await uploadRecording(
        previewBlob,
        previewName.trim() || `${song.title} - ${formatDateTime(new Date())}`,
        previewDurationMs,
        { userId: user.id, displayName, avatar: user.avatar },
        previewWaveformBars ?? undefined,
      );
      discardPreview();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save recording';
      setError(message);
    }
  }

  function togglePreviewPlay() {
    if (!previewAudioRef.current) return;
    if (isPreviewPlaying) {
      previewAudioRef.current.pause();
    } else {
      void previewAudioRef.current.play();
    }
  }

  function handlePreviewSeek(e: React.MouseEvent<HTMLDivElement>) {
    if (!previewAudioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const audio = previewAudioRef.current;
    const duration = isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : previewDurationMs / 1000;
    if (duration > 0) audio.currentTime = ratio * duration;
  }

  return (
    <div className="song-recorder">
      {/* ── Controls ─────────────────────────────────── */}
      <div className="recorder-controls">
        {recState === 'idle' && (
          <div className="recorder-idle-actions">
            <button className="rec-btn rec-btn--start" onClick={startRecording}>
              <Mic size={14} /> Start recording
            </button>
            <button className="rec-btn rec-btn--upload" onClick={triggerFileUpload}>
              <Upload size={14} /> Upload file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={(e) => { void handleFileSelected(e); }}
              style={{ display: 'none' }}
              aria-label="Upload audio file"
            />
          </div>
        )}

        {recState === 'recording' && (
          <div className="recorder-recording-row">
            <span className="recorder-indicator">● REC</span>
            <span className="recorder-elapsed">{formatTime(elapsed)}</span>
            <button className="rec-btn rec-btn--stop" onClick={stopRecording}>
              <MicOff size={14} /> Stop
            </button>
          </div>
        )}

        {recState === 'preview' && previewUrl && (
          <div className="recorder-preview-section">
            <audio
              ref={previewAudioRef}
              src={previewUrl}
              preload="metadata"
              onPlay={() => setIsPreviewPlaying(true)}
              onPause={() => setIsPreviewPlaying(false)}
              onEnded={() => { setIsPreviewPlaying(false); setPreviewProgress(0); }}
              onTimeUpdate={() => {
                const el = previewAudioRef.current;
                const dur = el && (isFinite(el.duration) && el.duration > 0 ? el.duration : previewDurationMs / 1000);
                if (el && dur) setPreviewProgress(el.currentTime / dur);
              }}
              onSeeked={() => {
                const el = previewAudioRef.current;
                const dur = el && (isFinite(el.duration) && el.duration > 0 ? el.duration : previewDurationMs / 1000);
                if (el && dur) setPreviewProgress(el.currentTime / dur);
              }}
            />
            <div className="recorder-preview-playback">
              <button
                className="play-btn"
                onClick={togglePreviewPlay}
                aria-label={isPreviewPlaying ? 'Pause preview' : 'Play preview'}
              >
                {isPreviewPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <WaveformProgress
                audioUrl={previewUrl}
                progress={previewProgress}
                onSeek={handlePreviewSeek}
                ariaLabel="Seek preview"
                className="recorder-preview-bar"
                waveformBars={previewWaveformBars ?? undefined}
              />
              <span className="recorder-elapsed" title="Duration">
                {formatTime(previewProgress * previewDurationMs)} / {formatTime(previewDurationMs)}
              </span>
            </div>
            <div className="recorder-save-form">
              <input
                className="recorder-name-input"
                value={previewName}
                onChange={(e) => setPreviewName(e.target.value)}
                placeholder="Recording name"
                aria-label="Recording name"
              />
              <div className="recorder-save-actions">
                <button className="rec-btn rec-btn--save" onClick={saveRecording} disabled={uploading}>
                  <Save size={14} /> {uploading ? 'Saving…' : 'Save'}
                </button>
                <button className="rec-btn rec-btn--reset" onClick={discardPreview}>
                  <X size={14} /> Discard
                </button>
              </div>
            </div>
          </div>
        )}

        {error && <p className="recorder-error">{error}</p>}
      </div>

      {/* ── Recordings list ───────────────────────────── */}
      <div className="recordings-section">
        <div className="recordings-header">
          <h2><span>Recordings</span></h2>
        </div>
        {loading ? (
          <p className="no-recordings">Loading…</p>
        ) : recordings.length === 0 ? (
          <p className="no-recordings">No recordings yet</p>
        ) : (
          <ul className="recordings-list">
            {recordings.map((rec) => (
              <SavedPlayer
                key={rec.id}
                recording={rec}
                currentUserId={user.id}
                bandId={bandId}
                songId={song.id}
                onDelete={deleteRecording}
                onRename={renameRecording}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

