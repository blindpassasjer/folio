import { Suspense, lazy, useEffect, type ReactElement } from 'react';
import { createBrowserRouter, RouterProvider, Routes, Route, Navigate, useRouteError } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Theme } from '@radix-ui/themes';
import { useBands } from './context/BandsContext';
import { DarkModeProvider, useDarkModeContext } from './context/DarkModeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BandsProvider } from './context/BandsContext';
import { isDynamicImportFailure, recoverFromDynamicImportFailure, forceReloadAfterChunkFailure } from './lib/chunkRecovery';
import { Button } from './components/ui/Button';

const Layout = lazy(() => import('./components/Layout'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const AcceptInvitePage = lazy(() => import('./pages/AcceptInvitePage'));
const UsernameSetupPage = lazy(() => import('./pages/UsernameSetupPage'));
const AddSongPage = lazy(() => import('./pages/AddSongPage'));
const BandSetlistConcertPage = lazy(() => import('./pages/BandSetlistConcertPage'));
const BandSetlistPrintPage = lazy(() => import('./pages/BandSetlistPrintPage'));
const BandDetailPage = lazy(() => import('./pages/BandDetailPage'));
const BandSettingsPage = lazy(() => import('./pages/BandSettingsPage'));
const BandMembersPage = lazy(() => import('./pages/BandMembersPage'));
const SongPage = lazy(() => import('./pages/SongPage'));
const SongConcertPage = lazy(() => import('./pages/SongConcertPage'));
const EditSongPage = lazy(() => import('./pages/EditSongPage'));
const AdminInvitesPage = lazy(() => import('./pages/AdminInvitesPage'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const PublicBandRiderPage = lazy(() => import('./pages/PublicBandRiderPage'));
const PublicBandPressKitPage = lazy(() => import('./pages/PublicBandPressKitPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function getRouteErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : '';
  }

  return '';
}

function RouterErrorFallback() {
  const routeError = useRouteError();
  const chunkFailure = isDynamicImportFailure(routeError);
  const errorMessage = getRouteErrorMessage(routeError);

  useEffect(() => {
    if (chunkFailure) {
      recoverFromDynamicImportFailure();
    }
  }, [chunkFailure]);

  const handleReload = () => {
    // Always clear the service worker/caches before reloading, not just for
    // classified chunk failures: a plain reload can keep re-serving stale
    // cached files through an outdated SW for any other post-update error too.
    forceReloadAfterChunkFailure();
  };

  return (
    <div className="app-status" role="alert" style={{ textAlign: 'left' }}>
      <h2 style={{ marginBottom: '0.5rem', color: 'var(--text)' }}>We hit a loading problem</h2>
      <p>
        {chunkFailure
          ? 'A new version was deployed while this tab was open. Reload to sync the latest app files.'
          : 'Something went wrong while opening this page. Try reloading the app.'}
      </p>
      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={handleReload}>
          Reload app
        </Button>
        <Button onClick={() => window.location.assign('/profile')}>
          Go to profile
        </Button>
      </div>
      {!chunkFailure && errorMessage && (
        <p style={{ marginTop: '0.9rem', fontSize: '0.88rem', opacity: 0.9 }}>{errorMessage}</p>
      )}
    </div>
  );
}

const routerErrorElement = <RouterErrorFallback />;

/** Redirects to the last active band's library, or profile if no active band. */
function RootRedirect() {
  const { bands, loading } = useBands();

  if (loading) {
    return <div className="app-status">Loading Gigboy…</div>;
  }

  let targetBandId: string | null = null;

  try {
    const lastBandId = window.localStorage.getItem('gigboy-active-band-id')?.trim();
    if (lastBandId && bands.some((band) => band.id === lastBandId)) {
      targetBandId = lastBandId;
    }
  } catch {
    // Ignore localStorage failures.
  }

  if (!targetBandId && bands.length > 0) {
    targetBandId = bands[0].id;
  }

  if (targetBandId) {
    return <Navigate to={`/bands/${targetBandId}/library`} replace state={{ bandId: targetBandId }} />;
  }

  return <Navigate to="/profile" replace />;
}

/** Guards a route to admins only; anyone else is bounced to their profile. */
function RequireAdmin({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/profile" replace />;
  return children;
}

function AuthenticatedApp() {
  const { user, loading, authEnabled, isDeletingAccount } = useAuth();

  if (loading) {
    return <div className="app-status">Loading Gigboy…</div>;
  }

  if (authEnabled && !user) return <LoginPage />;
  if (authEnabled && user && !user.username && !isDeletingAccount) return <UsernameSetupPage />;

  return (
    <BandsProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/bands" element={<RootRedirect />} />
          <Route path="/songs/new" element={<AddSongPage />} />
          <Route path="/songs/:id" element={<SongPage />} />
          <Route path="/songs/:id/concert" element={<SongConcertPage />} />
          <Route path="/songs/:id/edit" element={<EditSongPage />} />
          <Route path="/bands/:bandId/setlists/:setlistId/concert" element={<BandSetlistConcertPage />} />
          <Route path="/bands/:bandId/setlists/:setlistId/print" element={<BandSetlistPrintPage />} />
          <Route path="/bands/:id/settings" element={<BandSettingsPage />} />
          <Route path="/bands/:id/members" element={<BandMembersPage />} />
          <Route path="/bands/:id/*" element={<BandDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route
            path="/admin/invites"
            element={
              <RequireAdmin>
                <AdminInvitesPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/users"
            element={
              <RequireAdmin>
                <AdminUsersPage />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Layout>
    </BandsProvider>
  );
}

const router = createBrowserRouter(
  [
    { path: '/public/bands/:bandId/:bandName/riders/:riderId', element: <PublicBandRiderPage />, errorElement: routerErrorElement },
    { path: '/public/bands/:bandId/riders/:riderId', element: <PublicBandRiderPage />, errorElement: routerErrorElement },
    { path: '/public/press-kit/:token', element: <PublicBandPressKitPage />, errorElement: routerErrorElement },
    { path: '/invite/:token', element: <AcceptInvitePage />, errorElement: routerErrorElement },
    { path: '/', element: <AuthenticatedApp />, errorElement: routerErrorElement },
    { path: '*', element: <AuthenticatedApp />, errorElement: routerErrorElement },
  ],
  // GitHub Pages serves the demo from a repo subpath (e.g. /gigboy/) rather than the
  // domain root; BASE_URL is set from vite.config.ts's `base`, '/' for every other build.
  { basename: import.meta.env.BASE_URL }
);

function AppContent() {
  const { dark } = useDarkModeContext();

  return (
    <Theme
      appearance={dark ? 'dark' : 'light'}
      accentColor="blue"
      grayColor="sand"
      radius="medium"
      hasBackground={false}
    >
      <AuthProvider>
        <Toaster
          toastOptions={{
            style: {
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'var(--surface)',
              color: 'var(--text)',
              boxShadow: 'var(--shadow)',
              padding: '0.7rem 0.8rem',
              minWidth: '280px',
              maxWidth: '420px',
            },
          }}
          position="top-center"
        />
        <Suspense fallback={<div className="app-status">Loading Gigboy…</div>}>
          <RouterProvider router={router} />
        </Suspense>
      </AuthProvider>
    </Theme>
  );
}

export default function App() {
  return (
    <DarkModeProvider>
      <AppContent />
    </DarkModeProvider>
  );
}
