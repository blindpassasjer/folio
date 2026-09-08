import { FormEvent, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { Music2, ListMusic, Users, MonitorSpeaker, Newspaper, Activity, type LucideIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import BrandMark from '../components/BrandMark';
import { Button } from '../components/ui/Button';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const REPO_URL = 'https://github.com/blindpassasjer/gigboy';

const LOGIN_FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Music2,
    title: 'Song library',
    description: 'Chord charts, tabs, lyrics, and hand notes in one place.',
  },
  {
    icon: ListMusic,
    title: 'Setlists',
    description: 'Build sets fast, with rehearsal and concert modes.',
  },
  {
    icon: Users,
    title: 'Band collaboration',
    description: 'A shared workspace for every member of the band.',
  },
  {
    icon: MonitorSpeaker,
    title: 'Stage plots & riders',
    description: 'Stage diagrams, tech riders, and input lists.',
  },
  {
    icon: Newspaper,
    title: 'Press kits',
    description: 'Band bio, photos, and assets behind a single link.',
  },
  {
    icon: Activity,
    title: 'Tuner & metronome',
    description: 'Chromatic tuner, metronome, and rehearsal recordings.',
  },
];

function getPostLoginDestination(location: Location): { path: string; state?: unknown } {
  // If the user landed here via a specific deep link (e.g. a band invite link) while
  // signed out, send them back there after auth instead of the generic default landing spot.
  if (location.pathname && location.pathname !== '/' && location.pathname !== '/bands') {
    return { path: `${location.pathname}${location.search}`, state: location.state };
  }

  if (typeof window === 'undefined') {
    return { path: '/profile' };
  }

  try {
    const lastBandId = window.localStorage.getItem('gigboy-active-band-id')?.trim();
    if (lastBandId) {
      return {
        path: `/bands/${lastBandId}/library`,
        state: { bandId: lastBandId },
      };
    }
  } catch {
    // Ignore localStorage failures and fall back to profile.
  }

  return { path: '/' };
}

function LoginHero() {
  return (
    <aside className="login-hero" aria-label="GIGBOY features">
      <div className="login-brand login-brand--hero">
        <BrandMark size={90} />
      </div>
      <h1 className="login-hero-title">A workspace for working bands.</h1>
      <p className="login-hero-copy">
        Gigboy is a free, open-source tool for organising songs, setlists, and everything else
        a band brings to the stage. This is a self-hosted instance — accounts are invite-only.
      </p>
      <ul className="login-feature-list">
        {LOGIN_FEATURES.map(({ icon: Icon, title, description }) => (
          <li key={title} className="login-feature-item">
            <Icon size={16} className="login-feature-icon" aria-hidden="true" />
            <h2>{title}</h2>
            <p>{description}</p>
          </li>
        ))}
      </ul>
      <a className="login-hero-source" href={REPO_URL} target="_blank" rel="noreferrer">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        Source on GitHub
      </a>
    </aside>
  );
}

const NOTE_SYMBOLS = ['♩', '♪', '♫', '♬', '♭', '♯', '♮'];

interface NoteParticle {
  x: number; y: number;
  vx: number; vy: number;
  symbol: string;
  size: number;
  opacity: number;
  angle: number;
  va: number;
}

function randomNote(w: number, h: number, spreadY = false): NoteParticle {
  return {
    x: Math.random() * w,
    y: spreadY ? Math.random() * h : h + 20 + Math.random() * 120,
    vx: (Math.random() - 0.5) * 0.3,
    vy: -(0.35 + Math.random() * 0.5),
    symbol: NOTE_SYMBOLS[Math.floor(Math.random() * NOTE_SYMBOLS.length)],
    size: 18 + Math.random() * 30,
    opacity: 0.25 + Math.random() * 0.3,
    angle: (Math.random() - 0.5) * 0.5,
    va: (Math.random() - 0.5) * 0.008,
  };
}

function MusicNotesBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const COUNT = 16;
    let notes: NoteParticle[] = [];
    let raf: number;
    let accentColor = '#1a6fc4';

    // Capture non-null locals so inner closures don't re-check nullable refs
    const cvs = canvas;
    const context = ctx;

    function syncSize() {
      cvs.width = cvs.parentElement ? cvs.parentElement.offsetWidth : window.innerWidth;
      cvs.height = cvs.parentElement ? cvs.parentElement.offsetHeight : window.innerHeight;
      accentColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent').trim() || '#1a6fc4';
      if (reduceMotion) paint();
    }

    syncSize();
    notes = Array.from({ length: COUNT }, (_, i) =>
      randomNote(cvs.width, cvs.height, i < COUNT * 0.8)
    );

    const ro = new ResizeObserver(syncSize);
    ro.observe(document.documentElement);

    function paint() {
      context.clearRect(0, 0, cvs.width, cvs.height);
      for (const n of notes) {
        context.save();
        context.translate(n.x, n.y);
        context.rotate(n.angle);
        context.globalAlpha = n.opacity;
        context.fillStyle = accentColor;
        context.font = `${n.size}px serif`;
        context.fillText(n.symbol, 0, 0);
        context.restore();
      }
    }

    function draw() {
      for (const n of notes) {
        n.x += n.vx;
        n.y += n.vy;
        n.angle += n.va;
        if (n.y < -60) {
          Object.assign(n, randomNote(cvs.width, cvs.height));
        }
      }
      paint();
      raf = requestAnimationFrame(draw);
    }

    if (reduceMotion) {
      // Respect prefers-reduced-motion: render a single static frame, no loop.
      notes = Array.from({ length: COUNT }, () => randomNote(cvs.width, cvs.height, true));
      paint();
    } else {
      draw();
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="login-notes-canvas" aria-hidden="true" />;
}

function LoginBackdrop() {
  return (
    <div className="login-bg" aria-hidden="true">
      <MusicNotesBg />
    </div>
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useDocumentTitle('Sign in');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');

    const err = await login(email, password);

    if (err) {
      setError(err);
      setBusy(false);
    } else {
      const destination = getPostLoginDestination(location);
      navigate(destination.path, destination.state ? { state: destination.state } : undefined);
    }
  }

  return (
    <div className="login-screen">
      <LoginBackdrop />
      <div className="login-shell">
        <LoginHero />
        <div className="login-card">
          <h1 className="login-title">Sign in</h1>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="form-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                required
              />
            </div>
            {error && <p className="login-error">{error}</p>}
            <Button type="submit" variant="primary" className="login-submit" disabled={busy}>
              {busy ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <footer className="footer">
            From Norway {'<3'} with chords
          </footer>
        </div>
      </div>
    </div>
  );
}
