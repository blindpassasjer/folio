import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Trash2, X, ArrowDownToLine } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from '../utils/anchoredToast';
import { showConfirmToast } from '../utils/toastDialogs';
import { useBands } from '../context/BandsContext';
import { useAuth } from '../context/AuthContext';
import BandManagementPanel from '../components/BandManagementPanel';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { listBandLogos, removeBandLogoAsset, selectBandLogo } from '../lib/bandLogos';
import { saveBlob } from '../lib/download';

const LOGO_CARD_MIN_WIDTH_PX = 130;
const LOGO_GRID_GAP_PX = 10;
const LOGO_GRID_ROWS_PER_PAGE = 4;

function inferImageExtension(url: string, mimeType: string): string {
  const normalizedMime = mimeType.split(';')[0].trim().toLowerCase();
  const fromMime = normalizedMime.startsWith('image/') ? normalizedMime.slice(6) : '';
  if (fromMime) return fromMime;

  const pathname = new URL(url, window.location.origin).pathname;
  const fileName = pathname.split('/').pop() ?? '';
  const ext = fileName.includes('.') ? fileName.split('.').pop() ?? '' : '';
  return ext.toLowerCase() || 'jpg';
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  void saveBlob(blob, filename);
}

interface LogoAsset {
  id: string;
  title: string;
  url: string;
  thumbUrl?: string;
  storagePath?: string;
  thumbStoragePath?: string;
  createdAt?: string;
}

export default function BandSettingsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    bands,
    loading,
    renameBand,
    updateBandDescription,
    updateBandLogo,
    deleteBand,
    refreshBands,
  } = useBands();

  const band = bands.find((entry) => entry.id === id) ?? null;

  useDocumentTitle(band ? `${band.name} Settings` : 'Band Settings');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logo, setLogo] = useState<string | undefined>();
  const [logoAssets, setLogoAssets] = useState<LogoAsset[]>([]);
  const [loadingLogoAssets, setLoadingLogoAssets] = useState(false);
  const [busyLogo, setBusyLogo] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [logoPage, setLogoPage] = useState(1);
  const [logoItemsPerPage, setLogoItemsPerPage] = useState(8);
  const [logoPreview, setLogoPreview] = useState<{ url: string; title: string } | null>(null);
  const [downloadingLogoId, setDownloadingLogoId] = useState<string | null>(null);
  const [busyDeleteBand, setBusyDeleteBand] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const logoGridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!band) return;
    setName(band.name);
    setDescription(band.description ?? '');
    setLogo(band.logo);
  // Intentionally depends only on band.id — resets form when switching bands,
  // not on every property change (which would overwrite the user's in-progress edits).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band?.id]);

  const bandId = band?.id ?? null;
  const isOwner = band?.ownerId === user?.id;
  const canEditBand = isOwner;

  useEffect(() => {
    if (!band || !canEditBand) return;

    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    const currentDescription = band.description ?? '';
    const nameChanged = trimmedName !== band.name;
    const descriptionChanged = trimmedDescription !== currentDescription;

    if (!nameChanged && !descriptionChanged) return;
    if (!trimmedName) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        if (trimmedName !== band.name) {
          const renameError = await renameBand(band.id, trimmedName);
          if (renameError) {
            toast.error(renameError);
            return;
          }
        }

        if (trimmedDescription !== currentDescription) {
          const descError = await updateBandDescription(band.id, trimmedDescription);
          if (descError) {
            toast.error(descError);
          }
        }
      })();
    }, 500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [band, canEditBand, name, description, renameBand, updateBandDescription]);

  useEffect(() => {
    if (!bandId) return;
    let mounted = true;
    setLoadingLogoAssets(true);

    void listBandLogos(bandId)
      .then((logos) => {
        if (!mounted) return;
        const assets: LogoAsset[] = logos.map((asset) => ({
          id: asset.id,
          title: 'Logo',
          url: asset.url,
          thumbUrl: asset.thumbUrl,
          createdAt: asset.createdAt,
        }));
        setLogoAssets(assets);
      })
      .catch(() => {
        if (!mounted) return;
        toast.error('Failed to load logo assets.');
      })
      .finally(() => {
        if (mounted) setLoadingLogoAssets(false);
      });

    return () => {
      mounted = false;
    };
  }, [bandId]);

  const currentLogoAsset = logo
    ? { id: 'current-band-logo', title: 'Current logo', url: logo, thumbUrl: logo }
    : null;
  const combinedLogoAssets = currentLogoAsset && !logoAssets.some((asset) => asset.url === currentLogoAsset.url)
    ? [currentLogoAsset, ...logoAssets]
    : logoAssets;
  const logoTotalPages = Math.max(1, Math.ceil(combinedLogoAssets.length / logoItemsPerPage));
  const logoPageStart = (logoPage - 1) * logoItemsPerPage;
  const pagedLogoAssets = combinedLogoAssets.slice(logoPageStart, logoPageStart + logoItemsPerPage);

  useEffect(() => {
    const computeItemsPerPage = () => {
      const containerWidth = logoGridRef.current?.clientWidth ?? window.innerWidth;
      const columns = Math.max(1, Math.floor((containerWidth + LOGO_GRID_GAP_PX) / (LOGO_CARD_MIN_WIDTH_PX + LOGO_GRID_GAP_PX)));
      setLogoItemsPerPage(columns * LOGO_GRID_ROWS_PER_PAGE);
    };

    computeItemsPerPage();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          computeItemsPerPage();
        })
      : null;

    if (logoGridRef.current && resizeObserver) {
      resizeObserver.observe(logoGridRef.current);
    }

    window.addEventListener('resize', computeItemsPerPage);

    return () => {
      window.removeEventListener('resize', computeItemsPerPage);
      resizeObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (logoPage > logoTotalPages) {
      setLogoPage(logoTotalPages);
    }
  }, [logoPage, logoTotalPages]);

  useEffect(() => {
    if (!logoPreview) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLogoPreview(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [logoPreview]);

  const handleLogoDownload = async (asset: LogoAsset) => {
    setDownloadingLogoId(asset.id);
    try {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error('Failed to download logo.');
      const blob = await response.blob();
      const ext = inferImageExtension(asset.url, blob.type);
      const safeName = (asset.title || 'logo')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'logo';
      triggerBlobDownload(blob, `${safeName}.${ext}`);
    } catch {
      toast.error('Failed to download logo.');
    } finally {
      setDownloadingLogoId(null);
    }
  };

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

  if (!isOwner) {
    return (
      <section className="bands-page">
        <p className="bands-status">Only the band owner can access band settings.</p>
        <Link to={`/bands/${band.id}/members`} className="btn btn--secondary">
          <ArrowLeft size={16} /> Back to members
        </Link>
      </section>
    );
  }

  const handleLogoSelect = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Logo file must be smaller than 5 MB.');
      return;
    }

    setBusyLogo(true);
    const logoError = await updateBandLogo(band.id, file);
    setBusyLogo(false);

    if (logoError) {
      toast.error(logoError);
    } else {
      toast.success('Logo uploaded.');
    }
  };

  const handleRemoveLogo = async (asset?: LogoAsset) => {
    const confirmed = await showConfirmToast('Remove the current band logo?', {
      confirmLabel: 'Remove logo',
    });
    if (!confirmed) return;

    setBusyLogo(true);
    if (asset && asset.id !== 'current-band-logo') {
      try {
        await removeBandLogoAsset(band.id, asset.id);
        setLogoAssets((prev) => prev.filter((entry) => entry.id !== asset.id));
        if (asset.url === logo) setLogo(undefined);
        await refreshBands();
        toast.success('Logo removed.');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to remove logo.');
      } finally {
        setBusyLogo(false);
      }
      return;
    }

    const logoError = await updateBandLogo(band.id, null);
    setBusyLogo(false);

    if (logoError) {
      toast.error(logoError);
    } else {
      setLogo(undefined);
      toast.success('Logo removed.');
    }
  };

  const handleDeleteBand = async () => {
    if (deleteConfirmName !== band.name) return;

    setBusyDeleteBand(true);
    const error = await deleteBand(band.id);
    setBusyDeleteBand(false);

    if (error) {
      toast.error(error);
      return;
    }

    toast.success('Band deleted.');
    navigate('/bands');
  };

  const handleUseLogoAsset = async (asset: LogoAsset) => {
    if (!canEditBand || busyLogo) return;
    if (asset.url === logo) return;

    setBusyLogo(true);
    try {
      const updated = await selectBandLogo(band.id, asset.id);
      setLogo(updated.logo);
      await refreshBands();
      toast.success('Band logo updated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update band logo.');
    } finally {
      setBusyLogo(false);
    }
  };

  const handleLogoDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      void handleLogoSelect(files[0]);
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void handleLogoSelect(e.target.files[0]);
    }
  };

  return (
    <section className="bands-page">
      <header className="bands-header">
        <div>
          <h1>Band Settings</h1>
          <p>{band.name}</p>
        </div>
      </header>

      <Link to={`/bands/${band.id}/library`} className="back-link">
        <ArrowLeft size={16} /> Back to band library
      </Link>

      <div className="bands-settings-layout">
        <div className="bands-settings-left">
          <section className="bands-panel">

          {/* ── Profile ── */}
          <h2 className="bands-section-heading">
            Profile
          </h2>

          <div className="share-menu-field">
            <span>Band name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Band name"
              maxLength={80}
              disabled={!canEditBand}
            />
          </div>

          <div className="share-menu-field">
            <span>Bio / description <span className="bands-field-counter">({description.length}/240)</span></span>
            <textarea
              className="bands-description-field"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short bio or description for your band"
              maxLength={240}
              rows={3}
              disabled={!canEditBand}
            />
          </div>

          </section>

          {/* ── Appearance ── */}
          <section className="bands-panel">
            <h2 className="bands-section-heading">
              Appearance
            </h2>

            <div className="bands-logo-section">
                <section className="bands-logo-upload-area">
                  <header className="press-kit-section-header">
                    <p className="press-kit-section-title">Band Logo</p>
                    <p className="press-kit-section-hint">Upload and manage your logo like Press Kit images.</p>
                  </header>

              {canEditBand && (
                <div
                  className={`bands-logo-upload-drop${dragActive ? ' active' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); if (canEditBand && !busyLogo) setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleLogoDrop}
                  onClick={() => { if (canEditBand && !busyLogo) document.getElementById('band-logo-input')?.click(); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && canEditBand && !busyLogo) document.getElementById('band-logo-input')?.click(); }}
                >
                  <p className="songlist-item-meta" style={{ margin: 0 }}>
                    {busyLogo ? 'Uploading…' : 'Drag & drop or click to upload logo'}
                  </p>
                </div>
              )}

              <input
                id="band-logo-input"
                type="file"
                accept="image/*"
                onChange={handleLogoChange}
                style={{ display: 'none' }}
                disabled={!canEditBand || busyLogo}
              />

              {!loadingLogoAssets && combinedLogoAssets.length === 0 && (
                <p className="bands-status">No logo uploaded yet.</p>
              )}

              {loadingLogoAssets && <p className="bands-status">Loading logo assets…</p>}

              {combinedLogoAssets.length > 0 && (
                <div className="bands-logo-grid" role="list" aria-label="Band logo assets" ref={logoGridRef}>
                  {pagedLogoAssets.map((asset) => {
                    const isCurrent = asset.url === logo;
                    return (
                      <article key={asset.id} className="bands-logo-card" role="listitem">
                        <div className="bands-logo-card-image-wrap">
                          <button
                            type="button"
                            className="image-preview-trigger"
                            onClick={() => setLogoPreview({ url: asset.url, title: isCurrent ? 'Current logo' : asset.title })}
                            aria-label={`Preview ${isCurrent ? 'current logo' : asset.title}`}
                          >
                            <img
                              src={asset.thumbUrl ?? asset.url}
                              alt={asset.title}
                              loading="lazy"
                              decoding="async"
                              className="bands-logo-card-image"
                            />
                          </button>
                        </div>
                        <div className="bands-logo-card-footer">
                          <span className="bands-logo-card-title">{isCurrent ? 'Current logo' : asset.title}</span>
                          <button
                            type="button"
                            className="title-rename-btn"
                            title="Download logo"
                            onClick={() => { void handleLogoDownload(asset); }}
                            disabled={downloadingLogoId === asset.id}
                          >
                            <ArrowDownToLine size={13} />
                          </button>
                          {canEditBand && (
                            <button
                              type="button"
                              className="title-rename-btn"
                              title="Delete logo"
                              onClick={() => { void handleRemoveLogo(asset); }}
                              disabled={busyLogo}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                          {canEditBand && !isCurrent && (
                            <button
                              type="button"
                              className="btn btn--secondary bands-logo-use-btn"
                              onClick={() => { void handleUseLogoAsset(asset); }}
                              disabled={busyLogo}
                            >
                              Use
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {combinedLogoAssets.length > logoItemsPerPage && (
                <div className="media-pagination">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => setLogoPage((current) => Math.max(1, current - 1))}
                    disabled={logoPage <= 1}
                  >
                    Previous
                  </button>
                  <p className="bands-inline-note">Page {logoPage} of {logoTotalPages}</p>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => setLogoPage((current) => Math.min(logoTotalPages, current + 1))}
                    disabled={logoPage >= logoTotalPages}
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
            </div>

        </section>
        </div>

        <div className="bands-settings-left">
          <BandManagementPanel
            band={band}
            canEditBand={canEditBand}
            isOwner={isOwner}
          />

          {isOwner && (
            <section className="bands-panel bands-panel--danger">
              <h3>Danger zone</h3>
              {showDeleteConfirm ? (
                <div className="bands-delete-confirm">
                  <p>Type <strong>{band.name}</strong> to confirm deletion. This cannot be undone.</p>
                  <label className="share-menu-field">
                    <input
                      type="text"
                      value={deleteConfirmName}
                      onChange={(e) => setDeleteConfirmName(e.target.value)}
                      placeholder={band.name}
                      autoFocus
                    />
                  </label>
                  <div className="bands-delete-confirm-actions">
                    <button
                      type="button"
                      className="btn btn--danger"
                      disabled={busyDeleteBand || deleteConfirmName !== band.name}
                      onClick={() => void handleDeleteBand()}
                    >
                      {busyDeleteBand ? 'Deleting…' : 'Delete band'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={busyDeleteBand}
                      onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmName(''); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete band
                </button>
              )}
            </section>
          )}
        </div>
      </div>

      {logoPreview && (
        <div className="image-lightbox-overlay" onClick={() => setLogoPreview(null)} role="dialog" aria-modal="true" aria-label={`${logoPreview.title} preview`}>
          <div className="image-lightbox" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="image-lightbox-close"
              onClick={() => setLogoPreview(null)}
              title="Close preview"
              aria-label="Close preview"
            >
              <X size={18} />
            </button>
            <img src={logoPreview.url} alt={logoPreview.title} className="image-lightbox-image" />
            <p className="image-lightbox-caption">{logoPreview.title}</p>
          </div>
        </div>
      )}
    </section>
  );
}
