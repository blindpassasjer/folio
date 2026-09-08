import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download, ArrowDownToLine, Copy } from 'lucide-react';
import DOMPurify from 'dompurify';
import BrandMark from '../components/BrandMark';
import { dataClient } from '../lib/dataClient';
import { generatePressKitZip } from '../lib/pressKitZip';
import { saveBlob } from '../lib/download';
import { parsePressKitMedia, detectPresavePlatformLabel } from '../utils/pressKitMedia';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * Normalized shape this page renders, adapted from `DataClient['publicPressKits']['get']`'s
 * `{ kit, bandName, bandLogo, images }` response — the band press kit's rich text is a single
 * HTML blob rather than the old multi-stageplot/rider `texts` array, and only the video/presave
 * URLs the owner selected for public sharing are included.
 */
interface PublicPressKitPayload {
  bandName: string;
  bandLogo?: string;
  pressKitIcon?: string;
  createdAt?: string;
  texts: Array<{ title: string; body: string }>;
  images: Array<{ title: string; url: string; mimeType: string }>;
  videoUrls: string[];
  presaveReleaseName?: string;
  presaveReleaseDate?: string;
  presaveUrls: string[];
}

async function fetchPublicPressKit(token: string): Promise<PublicPressKitPayload> {
  const result = await dataClient.publicPressKits.get(token);
  if (!result) throw new Error('Press kit not found.');
  const { kit, bandName, bandLogo, images } = result;
  return {
    bandName,
    bandLogo: bandLogo ?? undefined,
    pressKitIcon: kit.icon,
    createdAt: kit.createdAt,
    texts: kit.richText ? [{ title: kit.name, body: kit.richText }] : [],
    images: images.map((image) => ({ title: image.title, url: image.url, mimeType: image.mimeType })),
    videoUrls: kit.selectedVideoUrls ?? kit.videoUrls ?? [],
    presaveReleaseName: kit.presaveReleaseName,
    presaveReleaseDate: kit.presaveReleaseDate,
    presaveUrls: kit.selectedPresaveUrls ?? kit.presaveUrls ?? [],
  };
}

function slugifyFileName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'press-kit';
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

function sanitizePressKitHtml(raw: string): string {
  if (!raw.trim()) return '';
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'br', 'hr', 'a'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    FORCE_BODY: true,
    ALLOW_DATA_ATTR: false,
  });
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  void saveBlob(blob, filename);
}

function inferImageExtension(url: string, mimeType: string): string {
  const normalizedMime = mimeType.split(';')[0].trim().toLowerCase();
  const fromMime = normalizedMime.startsWith('image/') ? normalizedMime.slice(6) : '';
  if (fromMime) return fromMime;

  const pathname = new URL(url, window.location.origin).pathname;
  const fileName = pathname.split('/').pop() ?? '';
  const ext = fileName.includes('.') ? fileName.split('.').pop() ?? '' : '';
  return ext.toLowerCase() || 'jpg';
}

export default function PublicBandPressKitPage() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyDownload, setBusyDownload] = useState(false);
  const [downloadingImage, setDownloadingImage] = useState<string | null>(null);
  const [copiedVideoUrl, setCopiedVideoUrl] = useState<string | null>(null);
  const [payload, setPayload] = useState<PublicPressKitPayload | null>(null);
  const copyResetTimer = useRef<number | null>(null);

  useDocumentTitle(payload ? `${payload.bandName} — Press Kit` : 'Press Kit');

  useEffect(() => {
    return () => {
      if (copyResetTimer.current) {
        window.clearTimeout(copyResetTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setError('Missing press kit token.');
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    void fetchPublicPressKit(token)
      .then((result) => {
        if (!isMounted) return;
        setPayload(result);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load press kit.');
      })
      .finally(() => {
        if (!isMounted) return;
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  const handleImageDownload = async (url: string, title: string) => {
    setDownloadingImage(url);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to download image.');
      const blob = await response.blob();
      const ext = inferImageExtension(url, blob.type);
      triggerBlobDownload(blob, `${slugifyFileName(title)}.${ext}`);
    } finally {
      setDownloadingImage(null);
    }
  };

  const handleDownload = async () => {
    if (!payload) return;
    setBusyDownload(true);
    try {
      const blob = await generatePressKitZip({
        bandName: payload.bandName,
        stageplots: [],
        riders: [],
        texts: payload.texts,
        images: payload.images,
        videoUrls: payload.videoUrls,
        presaveReleaseName: payload.presaveReleaseName,
        presaveReleaseDate: payload.presaveReleaseDate,
        presaveUrls: payload.presaveUrls,
        generatedAt: new Date().toISOString(),
      });
      triggerBlobDownload(blob, `${slugifyFileName(payload.bandName)}-press-kit.zip`);
    } finally {
      setBusyDownload(false);
    }
  };

  const handleCopyVideoUrl = async (url: string) => {
    const text = url.trim();
    if (!text) return;

    const copyWithLegacyFallback = () => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (!copied) throw new Error('Unable to copy');
    };

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        copyWithLegacyFallback();
      }

      setCopiedVideoUrl(url);
      if (copyResetTimer.current) {
        window.clearTimeout(copyResetTimer.current);
      }
      copyResetTimer.current = window.setTimeout(() => {
        setCopiedVideoUrl((current) => (current === url ? null : current));
      }, 1800);
    } catch {
      try {
        copyWithLegacyFallback();
        setCopiedVideoUrl(url);
      } catch {
        // Ignore clipboard errors.
      }
    }
  };

  if (loading) {
    return <main className="public-setlist-page"><p className="public-setlist-status">Loading press kit...</p></main>;
  }

  if (error || !payload) {
    return <main className="public-setlist-page"><p className="public-setlist-status">{error ?? 'Press kit not found.'}</p></main>;
  }

  const hasTexts = payload.texts.length > 0;
  const hasImages = payload.images.length > 0;
  const hasVideos = payload.videoUrls.length > 0;
  const hasPresaves = payload.presaveUrls.length > 0;

  return (
    <main className="public-setlist-page public-presskit-page">
      <header className="public-setlist-header public-share-header">
        <Link to="/" className="public-page-nav-brand public-page-nav-brand--large"><BrandMark size={22} /></Link>
        <div className="public-share-branding-row public-share-branding-row--header">
          {(payload.bandName || payload.bandLogo) ? (
            <div className="public-share-band-stack public-share-band-stack--header">
              {payload.bandLogo ? (
                <img
                  src={payload.bandLogo}
                  alt={`${payload.bandName} logo`}
                  className="public-setlist-band-logo public-setlist-band-logo--large"
                  loading="lazy"
                />
              ) : null}
              {payload.bandName ? <p className="public-share-band-name">{payload.bandName}</p> : null}
            </div>
          ) : null}
        </div>
        <h1 className="public-setlist-title">{payload.pressKitIcon && <span aria-hidden="true">{payload.pressKitIcon} </span>}Press Kit</h1>
        <p className="public-setlist-count">Public promo package</p>
        <div className="public-presskit-download-wrap">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void handleDownload()}
            disabled={busyDownload}
            title="Download press kit zip"
          >
            <Download size={14} />
            <span>Download ZIP</span>
          </button>
        </div>
      </header>

      <div className="public-presskit-body">
        {hasPresaves && (
          <section className="public-presskit-videos-section public-presskit-presave-section">
            <h2 className="public-presskit-section-heading">
              {payload.presaveReleaseName || 'Presave the upcoming release'}
            </h2>
            {payload.presaveReleaseDate ? (
              <p className="public-setlist-count">Out {payload.presaveReleaseDate}</p>
            ) : null}
            <ul className="public-presskit-presave-list">
              {payload.presaveUrls.map((url) => (
                <li key={url} className="public-presskit-presave-item">
                  <a href={url} target="_blank" rel="noreferrer" className="public-presskit-presave-link">
                    <span className="public-presskit-presave-platform">{detectPresavePlatformLabel(url)}</span>
                    <span className="public-presskit-presave-url">{url}</span>
                  </a>
                  <button type="button" className="public-presskit-dl-btn" onClick={() => void handleCopyVideoUrl(url)}>
                    <Copy size={13} />
                    <span>{copiedVideoUrl === url ? 'Copied' : 'Copy URL'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {hasTexts && (
          <section className="public-presskit-texts-section">
            <div className="public-presskit-text-grid">
              {payload.texts.map((entry) => (
                <div key={`${entry.title}-${entry.body.slice(0, 16)}`} className="public-presskit-text-block">
                  <h2 className="public-presskit-text-standalone-title">{entry.title}</h2>
                  <article className="public-presskit-text-item">
                    <div
                      className="public-presskit-rich-text"
                      dangerouslySetInnerHTML={{ __html: sanitizePressKitHtml(entry.body) || `<p>${escapeHtml(entry.body)}</p>` }}
                    />
                  </article>
                </div>
              ))}
            </div>
          </section>
        )}

        {hasImages && (
          <section className="public-presskit-images-section">
            <h2 className="public-presskit-section-heading">Photos</h2>
            <div className="public-presskit-images-grid">
              {payload.images.map((entry) => (
                <article key={`${entry.title}-${entry.url}`} className="public-presskit-image-card">
                  <img src={entry.url} alt={entry.title} className="public-presskit-image" loading="lazy" />
                  <div className="public-presskit-image-footer">
                    <button
                      type="button"
                      className="public-presskit-dl-btn"
                      disabled={downloadingImage === entry.url}
                      onClick={() => void handleImageDownload(entry.url, entry.title)}
                      title="Download high-res image"
                    >
                      <ArrowDownToLine size={13} />
                      <span>{downloadingImage === entry.url ? 'Downloading…' : 'Download'}</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {hasVideos && (
          <section className="public-presskit-videos-section">
            <h2 className="public-presskit-section-heading">Music & Videos</h2>
            <div className="public-presskit-videos-grid">
              {payload.videoUrls.map((url) => {
                const media = parsePressKitMedia(url);
                if (!media) return null;

                if (media.provider === 'youtube' || media.provider === 'vevo') {
                  return (
                    <article key={url} className="public-presskit-image-card public-presskit-video-card">
                      <div className="public-presskit-video-shell public-presskit-video-shell--widescreen">
                        <iframe
                          src={media.embedUrl}
                          width="100%"
                          title={media.provider === 'vevo' ? 'VEVO video' : 'YouTube video'}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                          loading="lazy"
                          referrerPolicy="strict-origin-when-cross-origin"
                          className="public-presskit-video-embed"
                        />
                      </div>
                      <div className="public-presskit-video-footer">
                        <input type="text" readOnly value={url} className="public-presskit-video-url" onFocus={(event) => event.currentTarget.select()} />
                        <button type="button" className="public-presskit-dl-btn" onClick={() => void handleCopyVideoUrl(url)}>
                          <Copy size={13} />
                          <span>{copiedVideoUrl === url ? 'Copied' : 'Copy URL'}</span>
                        </button>
                      </div>
                    </article>
                  );
                }

                if (media.provider === 'vimeo') {
                  return (
                    <article key={url} className="public-presskit-image-card public-presskit-video-card">
                      <div className="public-presskit-video-shell public-presskit-video-shell--widescreen">
                        <iframe
                          src={media.embedUrl}
                          width="100%"
                          title="Vimeo video"
                          allow="autoplay; fullscreen; picture-in-picture"
                          allowFullScreen
                          loading="lazy"
                          className="public-presskit-video-embed"
                        />
                      </div>
                      <div className="public-presskit-video-footer">
                        <input type="text" readOnly value={url} className="public-presskit-video-url" onFocus={(event) => event.currentTarget.select()} />
                        <button type="button" className="public-presskit-dl-btn" onClick={() => void handleCopyVideoUrl(url)}>
                          <Copy size={13} />
                          <span>{copiedVideoUrl === url ? 'Copied' : 'Copy URL'}</span>
                        </button>
                      </div>
                    </article>
                  );
                }

                if (media.provider === 'spotify' || media.provider === 'soundcloud') {
                  return (
                    <article key={url} className="public-presskit-image-card public-presskit-video-card">
                      <div className="public-presskit-video-shell public-presskit-video-shell--spotify">
                        <iframe
                          src={media.embedUrl}
                          width="100%"
                          height={media.embedHeight}
                          title={media.provider === 'spotify' ? 'Spotify player' : 'SoundCloud player'}
                          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                          loading="lazy"
                          className="public-presskit-video-embed"
                        />
                      </div>
                      <div className="public-presskit-video-footer">
                        <input type="text" readOnly value={url} className="public-presskit-video-url" onFocus={(event) => event.currentTarget.select()} />
                        <button type="button" className="public-presskit-dl-btn" onClick={() => void handleCopyVideoUrl(url)}>
                          <Copy size={13} />
                          <span>{copiedVideoUrl === url ? 'Copied' : 'Copy URL'}</span>
                        </button>
                      </div>
                    </article>
                  );
                }

                return null;
              })}
            </div>
          </section>
        )}

        {!hasTexts && !hasImages && !hasVideos && !hasPresaves && (
          <p className="public-setlist-status">This press kit has no content yet.</p>
        )}
      </div>

      <footer className="footer">From Norway {'<3'} with chords</footer>
    </main>
  );
}
