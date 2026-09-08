import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PanelLeft, Sun, Moon, Lightbulb, Maximize2, Minimize2, Coffee, Music, Folder, ListMusic, ClipboardList, Newspaper, ShieldCheck, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBands } from '../context/BandsContext';
import Sidebar from './Sidebar';
import BrandMark from './BrandMark';
import { useDarkModeContext } from '../context/DarkModeContext';
import toast from '../utils/anchoredToast';
import UserAvatar from './UserAvatar';
import { isDemoMode } from '../lib/demo/demoMode';

const DEMO_BANNER_HEIGHT = 36;

interface Props {
  children: ReactNode;
}


export default function Layout({ children }: Props) {
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const {
    bands,
    addBandSongList,
    addBandSetlist,
    addBandInputList,
    addBandPressKit,
  } = useBands();
  const { user } = useAuth();
  const isConcertRoute = pathname.endsWith('/concert')
    && (pathname.startsWith('/bands/') || pathname.startsWith('/songs/'));
  const stateBandId = (() => {
    if (!state || typeof state !== 'object') return null;
    const candidate = (state as { bandId?: unknown }).bandId;
    return typeof candidate === 'string' && candidate.trim() ? candidate : null;
  })();
  const [persistedBandId, setPersistedBandId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem('gigboy-active-band-id');
    } catch {
      return null;
    }
  });
  const isBandRoute = pathname === '/bands' || pathname.startsWith('/bands/') || Boolean(stateBandId);
  const routeSegments = pathname.split('/').filter(Boolean);
  const routeBandId = routeSegments[0] === 'bands' ? routeSegments[1] ?? null : null;
  const fallbackBandId = persistedBandId && bands.some((entry) => entry.id === persistedBandId)
    ? persistedBandId
    : null;
  const themedBandId = routeBandId ?? stateBandId ?? fallbackBandId;
  const bandSection = routeBandId ? (routeSegments[2] ?? 'library') : null;
  const bandSongListId = routeBandId && bandSection === 'songlists' ? (routeSegments[3] ?? null) : null;
  const activeBand = routeBandId ? bands.find((entry) => entry.id === routeBandId) ?? null : null;
  const canEditActiveBand = Boolean(
    activeBand
      && user
      && (activeBand.ownerId === user.id || activeBand.memberRoles[user.id] === 'editor')
  );
  const addSongFabState = routeBandId
    ? {
      addSongScope: {
        kind: 'band' as const,
        bandId: routeBandId,
      },
      ...(bandSongListId ? { initialSongListId: bandSongListId } : {}),
    }
    : undefined;
  const canShowContextFab = Boolean(routeBandId)
    && !isConcertRoute
    && canEditActiveBand
    && (bandSection === 'library'
      || bandSection === 'songlists'
      || bandSection === 'setlists'
      || bandSection === 'riders'
      || bandSection === 'press-kit');
  const wasConcertRouteRef = useRef(isConcertRoute);
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 900px)').matches;
  });
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !window.matchMedia('(max-width: 900px)').matches;
  });
  const { dark, mode, cycle: cycleTheme } = useDarkModeContext();
  const mainContentRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef<Map<string, number>>(new Map());
  const swipeRef = useRef<{ x: number; y: number; fromEdge: boolean } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(() => {
    if (typeof document === 'undefined') return false;
    return Boolean(document.fullscreenElement);
  });
  const [coffeeOpen, setCoffeeOpen] = useState(false);
  const coffeePopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mainEl = mainContentRef.current;
    if (!mainEl) return;

    const handleScroll = () => {
      scrollPositions.current.set(pathname, mainEl.scrollTop);
    };
    mainEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => mainEl.removeEventListener('scroll', handleScroll);
  }, [pathname]);

  useEffect(() => {
    if (!mainContentRef.current) return;
    mainContentRef.current.scrollTop = scrollPositions.current.get(pathname) ?? 0;
    toast.dismiss();
  }, [pathname]);

  const createBandResource = useCallback(async (kind: 'songlist' | 'setlist' | 'rider' | 'pressKit') => {
    if (!routeBandId) return;

    const defaults = {
      songlist: 'New songlist',
      setlist: 'New setlist',
      rider: 'New rider',
      pressKit: 'New press kit',
    } as const;

    if (kind === 'songlist') {
      const result = await addBandSongList(routeBandId, defaults.songlist);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.songListId) {
        navigate(`/bands/${routeBandId}/songlists/${result.songListId}`, {
          state: {
            autoRename: {
              kind: 'songlist',
              resourceId: result.songListId,
              token: Date.now(),
            },
          },
        });
      }
      return;
    }

    if (kind === 'setlist') {
      const result = await addBandSetlist(routeBandId, defaults.setlist);
      if (result.error) {
        toast.error(result.error, { duration: 8000 });
        return;
      }
      if (result.setlistId) {
        navigate(`/bands/${routeBandId}/setlists/${result.setlistId}`, {
          state: {
            autoRename: {
              kind: 'setlist',
              resourceId: result.setlistId,
              token: Date.now(),
            },
          },
        });
      }
      return;
    }

    if (kind === 'pressKit') {
      const result = await addBandPressKit(routeBandId, defaults.pressKit);
      if (result.error) {
        toast.error(result.error, { duration: 8000 });
        return;
      }
      if (result.kitId) {
        navigate(`/bands/${routeBandId}/press-kit/${result.kitId}`);
      }
      return;
    }

    const result = await addBandInputList(routeBandId, defaults.rider);
    if (result.error) {
      toast.error(result.error, { duration: 8000 });
      return;
    }
    if (result.riderId) {
      navigate(`/bands/${routeBandId}/riders/${result.riderId}`, {
        state: {
          autoRename: {
            kind: 'rider',
            resourceId: result.riderId,
            token: Date.now(),
          },
        },
      });
    }
  }, [
    addBandPressKit,
    addBandSetlist,
    addBandSongList,
    addBandInputList,
    navigate,
    routeBandId,
  ]);

  const renderContextFab = () => {
    if (!canShowContextFab || !bandSection) return null;

    if (bandSection === 'library') {
      return (
        <Link
          to="/songs/new"
          state={addSongFabState}
          className="fab-add-song"
          title="Create song"
          aria-label="Create song"
        >
          <Music size={20} />
        </Link>
      );
    }

    if (bandSection === 'songlists') {
      return (
        <button
          type="button"
          className="fab-add-song"
          title="Create songlist"
          aria-label="Create songlist"
          onClick={() => void createBandResource('songlist')}
        >
          <Folder size={20} />
        </button>
      );
    }

    if (bandSection === 'setlists') {
      return (
        <button
          type="button"
          className="fab-add-song"
          title="Create setlist"
          aria-label="Create setlist"
          onClick={() => void createBandResource('setlist')}
        >
          <ListMusic size={20} />
        </button>
      );
    }

    if (bandSection === 'press-kit') {
      return (
        <button
          type="button"
          className="fab-add-song"
          title="Create press kit"
          aria-label="Create press kit"
          onClick={() => void createBandResource('pressKit')}
        >
          <Newspaper size={20} />
        </button>
      );
    }

    return (
      <button
        type="button"
        className="fab-add-song"
        title="Create input list"
        aria-label="Create input list"
        onClick={() => void createBandResource('rider')}
      >
        <ClipboardList size={20} />
      </button>
    );
  };

  // iOS Safari implements the Fullscreen API for <video> only, so requestFullscreen is
  // absent on the document element there — the button would be a dead no-op. Only show it
  // where fullscreen actually works.
  const fullscreenSupported = typeof document !== 'undefined'
    && typeof document.documentElement.requestFullscreen === 'function';

  const toggleFullscreen = async () => {
    if (!fullscreenSupported) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Ignore failures when fullscreen is unavailable or blocked by the browser.
    }
  };

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 900px)');

    const updateViewport = (matches: boolean) => {
      setIsNarrowViewport(matches);
      setSidebarOpen((current) => (matches ? false : current));
    };

    updateViewport(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      updateViewport(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const leavingConcertRoute = wasConcertRouteRef.current && !isConcertRoute;

    if (isNarrowViewport || isConcertRoute) {
      setSidebarOpen(false);
    } else if (leavingConcertRoute) {
      setSidebarOpen(true);
    }

    wasConcertRouteRef.current = isConcertRoute;
  }, [pathname, isNarrowViewport, isConcertRoute]);

  useEffect(() => {
    if (!sidebarOpen || !isNarrowViewport) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [sidebarOpen, isNarrowViewport]);

  useEffect(() => {
    if (typeof document === 'undefined' || !isNarrowViewport) return;

    const originalOverflow = document.body.style.overflow;
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = originalOverflow;
    }

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [sidebarOpen, isNarrowViewport]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange();

    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncPersistedBandId = () => {
      try {
        setPersistedBandId(window.localStorage.getItem('gigboy-active-band-id'));
      } catch {
        setPersistedBandId(null);
      }
    };

    syncPersistedBandId();
    window.addEventListener('storage', syncPersistedBandId);
    return () => window.removeEventListener('storage', syncPersistedBandId);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const nextBandId = routeBandId ?? stateBandId;
    if (!nextBandId) return;
    try {
      window.localStorage.setItem('gigboy-active-band-id', nextBandId);
      setPersistedBandId(nextBandId);
    } catch {
      // Ignore localStorage sync failures.
    }
  }, [routeBandId, stateBandId]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const rootStyle = document.documentElement.style;

    if (!themedBandId) {
      rootStyle.removeProperty('--bands-hue');
      rootStyle.removeProperty('--bands-hue-soft');
      rootStyle.removeProperty('--bands-hue-contrast');
      return;
    }

    const contrast = dark ? '#1b1512' : '#ffffff';
    const bandColor = '#1565c0';

    rootStyle.setProperty('--bands-hue', bandColor);
    rootStyle.setProperty(
      '--bands-hue-soft',
      `color-mix(in srgb, ${bandColor} ${dark ? '26%' : '16%'}, ${dark ? '#0f0f10' : '#ffffff'})`
    );
    rootStyle.setProperty('--bands-hue-contrast', contrast);
  }, [dark, themedBandId]);

  useEffect(() => {
    if (!coffeeOpen) return;

    const handleWindowClick = (event: MouseEvent) => {
      if (!coffeePopoverRef.current) return;
      if (coffeePopoverRef.current.contains(event.target as Node)) return;
      setCoffeeOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCoffeeOpen(false);
      }
    };

    window.addEventListener('mousedown', handleWindowClick);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handleWindowClick);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [coffeeOpen]);

  return (
    <>
      {isDemoMode ? (
        <div className="demo-banner" style={{ height: DEMO_BANNER_HEIGHT }}>
          <span>
            You're viewing a live demo with sample data — nothing leaves your browser.
          </span>
          <a
            href="https://github.com/blindpassasjer/gigboy"
            target="_blank"
            rel="noreferrer"
            className="demo-banner-link"
          >
            Self-host your own <ArrowUpRight size={13} />
          </a>
        </div>
      ) : null}
      <div
        className="app-shell"
        data-library-mode={themedBandId ? 'bands' : 'solo'}
        style={isDemoMode ? { height: `calc(100dvh - ${DEMO_BANNER_HEIGHT}px)` } : undefined}
      >
      <header className="topbar">
        <button
          type="button"
          className="topbar-sidebar-toggle"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          aria-pressed={sidebarOpen}
          aria-controls="app-sidebar"
        >
          <PanelLeft size={20} />
        </button>
        <Link to={themedBandId ? `/bands/${themedBandId}/library` : '/'} className="topbar-brand">
          <BrandMark size={35} scale={1} />
        </Link>
        <nav className="topbar-nav">
          <div className="topbar-coffee" ref={coffeePopoverRef}>
            <button
              type="button"
              onClick={() => setCoffeeOpen((current) => !current)}
              className={['topbar-coffee-trigger', coffeeOpen ? 'active' : ''].filter(Boolean).join(' ')}
              title="Buy me a coffee"
              aria-label="Buy me a coffee"
              aria-expanded={coffeeOpen}
              aria-haspopup="dialog"
              aria-controls="topbar-coffee-popover"
            >
              <Coffee size={16} />
              <span className="topbar-link-label">Buy me a coffee</span>
            </button>

            {coffeeOpen ? (
              <div id="topbar-coffee-popover" className="topbar-coffee-popover" role="dialog" aria-label="Buy me a coffee">
                <div className="topbar-coffee-popover-header">
                  <img
                    src="/assets/developer.jpg"
                    alt=""
                    className="topbar-coffee-popover-avatar"
                    aria-hidden="true"
                  />
                  <div>
                    <h2>Buy me a coffee</h2>
                    <p>Support keeps Gigboy running</p>
                  </div>
                </div>
                <div className="topbar-coffee-popover-content">
                  <div className="topbar-coffee-options">
                    <a
                      href="https://qr.vipps.no/box/26128ed0-008f-4b5a-bd8d-9a936f58cf83/pay-in"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="topbar-coffee-option btn btn--accent"
                    >
                      <span className="topbar-coffee-option-label">Vipps me</span>
                      <ArrowUpRight size={15} />
                    </a>
                    <a
                      href="https://buymeacoffee.com/blindpassasjer"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="topbar-coffee-option btn btn--secondary"
                    >
                      <span className="topbar-coffee-option-label">Buy me a coffee</span>
                      <ArrowUpRight size={15} />
                    </a>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={cycleTheme}
            className="topbar-icon-btn"
            title={
              mode === 'light'
                ? 'Switch to dark mode'
                : mode === 'dark'
                  ? 'Switch to stage mode'
                  : 'Switch to light mode'
            }
            aria-label={
              mode === 'light'
                ? 'Switch to dark mode'
                : mode === 'dark'
                  ? 'Switch to stage mode'
                  : 'Switch to light mode'
            }
            aria-pressed={dark}
          >
            {mode === 'light' ? <Sun size={16} /> : mode === 'dark' ? <Moon size={16} /> : <Lightbulb size={16} />}
          </button>
          {fullscreenSupported && (
            <button
              type="button"
              onClick={toggleFullscreen}
              className="topbar-icon-btn"
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              aria-pressed={isFullscreen}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          {user?.role === 'admin' && (
            <Link
              to="/admin/invites"
              className="topbar-icon-btn"
              title="Admin"
              aria-label="Admin"
              aria-current={pathname.startsWith('/admin/') ? 'page' : undefined}
            >
              <ShieldCheck size={16} />
            </Link>
          )}
          {user && (
            <Link
              to="/profile"
              className={pathname === '/profile' ? 'active topbar-profile-link' : 'topbar-profile-link'}
              title={`Open profile (${user.email})`}
              aria-current={pathname === '/profile' ? 'page' : undefined}
            >
              <UserAvatar label={user.fullName || user.username || user.email} size="sm" />
              <span className="topbar-link-label">Profile</span>
            </Link>
          )}
        </nav>
      </header>

      <div
        className={`app-body${isNarrowViewport ? ' app-body--narrow' : ''}`}
        onPointerDown={(event) => {
          if (!isNarrowViewport || event.pointerType === 'mouse') return;
          swipeRef.current = {
            x: event.clientX,
            y: event.clientY,
            fromEdge: event.clientX <= 32,
          };
        }}
        onPointerUp={(event) => {
          if (!swipeRef.current || event.pointerType === 'mouse') return;
          const { x, y, fromEdge } = swipeRef.current;
          swipeRef.current = null;
          const dx = event.clientX - x;
          const dy = event.clientY - y;
          // Require clear horizontal dominance and ≥55 px travel
          if (Math.abs(dy) > Math.abs(dx) * 0.75 || Math.abs(dx) < 55) return;
          if (!sidebarOpen && fromEdge && dx > 0) setSidebarOpen(true);
          else if (sidebarOpen && dx < 0) setSidebarOpen(false);
        }}
      >
        <Sidebar
          open={sidebarOpen}
          mobile={isNarrowViewport}
          onNavigate={isNarrowViewport ? () => setSidebarOpen(false) : undefined}
          onClose={() => setSidebarOpen(false)}
        />
        {isNarrowViewport && sidebarOpen && (
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <main
          id="main-content"
          ref={mainContentRef}
          tabIndex={-1}
          className={`main-content${isConcertRoute ? ' main-content--concert' : ''}${isBandRoute || (themedBandId && pathname.startsWith('/profile')) ? ' main-content--band' : ''}`}
        >
          {children}
          <footer className="footer">
            From Norway {'<3'} with chords
            <a
              className="footer-version"
              href="https://github.com/blindpassasjer/gigboy/blob/main/CHANGELOG.md"
              target="_blank"
              rel="noreferrer"
              title="View changelog"
            >
              v{__APP_VERSION__}
            </a>
          </footer>
        </main>
        {renderContextFab()}
      </div>
      </div>
    </>
  );
}
