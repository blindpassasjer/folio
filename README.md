<p align="center">
  <img src="icon.png" width="96" height="96" alt="Gigboy logo" />
</p>

<h1 align="center">Gigboy</h1>

<p align="center">
  <strong>The songbook and gig-prep app for bands who'd rather own their data than rent it.</strong>
</p>

<p align="center">
  <a href="https://blindpassasjer.github.io/gigboy/"><strong>Live demo</strong></a> ·
  <a href="#quick-start-self-hosting">Quick start</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#features">Features</a> ·
  <a href="SELFHOSTING.md">Self-hosting guide</a> ·
  <a href="#license">License</a>
</p>

<p align="center">
  <img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" />
  <img alt="Self-hosted" src="https://img.shields.io/badge/deployment-self--hosted-informational" />
  <img alt="Docker Compose" src="https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white" />
  <img alt="PWA" src="https://img.shields.io/badge/PWA-installable-5A0FC8" />
</p>

---

Gigboy is a web app for musicians and bands to write, organize, and rehearse songs from — built
on the open **ChordPro** format, so nothing you write is ever locked into a proprietary format or
someone else's server. It's **self-hosted only**: you run it on your own machine, NAS, or VPS with
one Docker Compose command, and your band's setlists, recordings, and press kit live in your own
database, not a startup's.

No subscriptions, no per-seat pricing, no feature paywalls — every account gets full access.

## Live demo

**[blindpassasjer.github.io/gigboy](https://blindpassasjer.github.io/gigboy/)** — a static build
that runs entirely in your browser with seeded sample data, no backend involved. It's how the app
behaves once you're logged in, minus real accounts: click around, add/edit songs, try transpose,
the metronome and tuner, hand-drawn notes, and audio recording. Nothing you do there leaves your
browser or touches a real database — logging out (or deleting the demo account) just resets the
sample data. Deployed automatically from this repo by
[.github/workflows/deploy-demo.yml](.github/workflows/deploy-demo.yml); the real product is
self-hosted only (see below).

To serve this demo from a test host, run `npm run dev:demo` — it starts Vite with the mock
backend, serves from the domain root, trusts `test.manriquez.no`, and points HMR through that
host's TLS. It binds Vite's port with `strictPort`, so only one project's `dev:demo` (gigboy
or cleep) can hold `test.manriquez.no` at a time — stop the other one first. Change the host
via `VITE_DEV_ORIGIN` in [package.json](package.json), or the port with `PORT=… npm run dev:demo`.

## Screenshots

<p align="center">
  <img src="docs/screenshots/song-view.png" width="49%" alt="Song view with inline ChordPro chords" />
  <img src="docs/screenshots/song-view-dark.png" width="49%" alt="Song view in dark mode" />
</p>
<p align="center">
  <img src="docs/screenshots/press-kit.png" width="49%" alt="Press kit editor" />
  <img src="docs/screenshots/library.png" width="49%" alt="Band song library" />
</p>

## Features

### Write and read songs the way musicians actually think about them
- **ChordPro rendering** — chords shown inline above lyrics, written as `[G]Amazing [C]grace`
- **Transpose** — shift every chord up or down by semitone in real time, on stage or in rehearsal;
  whatever you set sticks to that song for you next time (the horn player reads in Eb), and each
  bandmate keeps their own
- **Live preview** while writing — see the rendered sheet as you type
- **Import** from ChordPro, OnSong, and pasted Ultimate Guitar / Chordify / CifraClub charts —
  drop in loose files or a whole `.zip` backup and Gigboy converts them to ChordPro
- **Print / PDF export** — a setlist as a single large-type sheet, or the full charts one song per page
- **Search & filter** by title, artist, tag, or language — across English, Norwegian, Spanish,
  Portuguese, French, Italian, German, and more

### Built for bands, not solo users bolted onto a band feature later
- **Shared song libraries** — every song, songlist, and setlist belongs to the band, with
  per-member editor/viewer roles and invite links to bring people in
- **Setlists & songlists** — ordered setlists for the actual gig, freeform songlists for
  everything else
- **Now-playing sync** — one device leads Concert Mode and the whole band's screens follow
  to the same song, page, and transpose
- **Trash & restore** — soft-deleted songs, songlists, setlists, and press kits recover for
  30 days before they're gone for good
- **Edit history** — every save is snapshotted; see who changed which line, diff any two
  versions, and restore an older one

### Everything you need before you walk on stage
- **Press kits, technical riders, stage plots** — build them once, share via a public link, with
  OG-tag previews that look right when pasted into a booking email or Discord
- **Band logo upload** — used across the press kit and public pages
- **Attachments** — PDFs up to 20MB per song (scanned sheet music, lyric sheets, whatever the gig needs)

### Rehearsal tools that live where the songs do
- **Browser-based audio recorder** — capture a take straight from the song page, no separate app;
  leave timestamped comments on a take ("fix the turnaround at 1:12") that jump the player to that spot
- **Visual metronome & tuner** — no more digging for a physical tuner mid-rehearsal
- **Hand-drawn notes** — sketch directly on the song sheet for reminders that a text note can't capture
- **Custom chord voicings** — pin the fingering your band actually plays for a chord; it replaces
  the built-in diagram everywhere, including Concert Mode

### Your data stays yours
- **Full export, no lock-in** — download every band's entire songbook (songs as plain ChordPro
  files, plus every recording, press kit image, and technical rider) as a single ZIP, any time,
  from account settings
- **Offline-capable PWA** — install it, and it keeps working without a connection
- **Admin-controlled storage quotas** — self-hosters can cap how much each user's bands are
  allowed to store, right from the admin dashboard

## Tech stack

| Tool | Purpose |
|---|---|
| React 18 + TypeScript | UI |
| Vite 7 | Build tooling |
| React Router 7 | Client-side routing |
| Express + Postgres (Drizzle ORM) | API server & data storage |
| Docker Compose | Deployment |
| lucide-react | Icons |
| Web MediaRecorder API | In-browser audio recording |

## Browser support

Gigboy targets current evergreen browsers. The minimum is **Safari 16.2 / iOS 16.2**,
**Chrome 111**, or **Firefox 113** — the UI is built on CSS `color-mix()` and older engines
render it unstyled (they get a "please update" notice instead). Audio recording, the
metronome and the tuner use the Web Audio and MediaRecorder APIs; on iOS those require the
page to be served over HTTPS.

## Quick start (self-hosting)

Gigboy ships as a prebuilt Docker image — no build toolchain required on the machine running it,
which matters if that machine is a NAS or another low-power box. See
**[SELFHOSTING.md](SELFHOSTING.md)** for the full guide, including the admin account bootstrap
and invite-link flow used to add users (there's no open self-registration).

```bash
cp .env.example .env
# fill in POSTGRES_PASSWORD, SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
mkdir -p data/postgres data/attachments
chown -R 999:999 data/postgres   # match PUID/PGID in .env if you changed them
docker compose pull
docker compose up -d
```

`.env.example`:

```bash
PUID=999
PGID=999

POSTGRES_PASSWORD=change-me
DATABASE_URL=postgres://gigboy:change-me@postgres:5432/gigboy
SESSION_SECRET=          # openssl rand -hex 32
PORT=6168
COOKIE_SECURE=false      # set true once a reverse proxy terminates HTTPS

# Optional: set both to bootstrap an initial admin account on first run
ADMIN_EMAIL=
ADMIN_PASSWORD=
```

Open [http://localhost:6168](http://localhost:6168) (or whatever `PORT` you set in `.env`) and log in
with the admin account you configured. From there, generate invite links to bring your bandmates in
— every new account is a regular member by default; grant admin access to specific people
afterward from the Users tab if you need to.

## Local development (without Docker)

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) for the frontend. The API server runs
separately — see the "Development (without Docker)" section of [SELFHOSTING.md](SELFHOSTING.md)
for running `server:dev` against a local Postgres instance.

## ChordPro format

Chords are wrapped in square brackets inline with lyrics:

```
[G]Amazing [C]grace, how [G]sweet the [D]sound
```

Directives use curly braces:

```
{title: Amazing Grace}
{artist: John Newton}
{start_of_verse}
...
{end_of_verse}
{start_of_chorus}
...
{end_of_chorus}
```

Supported directives: `title` (or `t`), `subtitle` (or `st`), `artist`, `intro`, `pre_chorus`, `interlude`, `solo`, `outro`, and generic `start_of_<section>` / `end_of_<section>` pairs (e.g. `start_of_verse`/`end_of_verse`, `start_of_chorus`/`end_of_chorus`, `start_of_bridge`/`end_of_bridge`, or any other section name). Tab blocks use `start_of_tab`/`sot` … `end_of_tab`/`eot`.

## Adding songs

1. Click **Add Song** in the nav bar.
2. Fill in title, artist, language, key, capo, and BPM.
3. Write or paste ChordPro lyrics — toggle **Preview** to see the rendered result.
4. Click **Save Song** — the song is stored and you land directly on the song view.

## Deploying

Deployment is Docker Compose only — see [SELFHOSTING.md](SELFHOSTING.md) for the full guide,
including backups, updating, and the admin bootstrap/invite flow. There is no separate static
build/hosting path: the `app` container serves the built frontend and the API from the same origin.
A GitHub Actions workflow ([.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml))
builds and publishes that image, so self-hosters pull instead of building on their own hardware.

## Project structure

```
src/
  components/     UI components (Layout, Sidebar, SongList, SongView, ChordDisplay, PressKitView, …)
  context/        AuthContext, BandsContext, DarkModeContext
  hooks/          useStorageUsage, useSongRecordings, …
  pages/          SongPage, AddSongPage, BandDetailPage, ProfilePage, AdminInvitesPage, AdminUsersPage, …
  lib/            dataClient (REST API client), songbookExport (ChordPro export), chunkRecovery, …
  types/          Song, Setlist, SongList, Band, User types
  utils/          chordParser, languages
server/
  routes/         Express route handlers (auth, songs, bands, invites, admin users, press kits, …)
  db/             Drizzle schema, migrations, admin bootstrap
  lib/            Server-side helpers (band logos, hand notes, recordings, storage quotas, press-kit OG tags)
  middleware/     Session auth, admin gating
```

## Codebase knowledge graph

`graphify-out/graph.json` is a generated knowledge graph of this codebase (symbols/functions/components as nodes, relationships as edges), used by AI coding assistants to navigate the project faster than blind file search. Regenerate it after code changes with:

```bash
graphify update .
```

## License

Apache License 2.0 — see [LICENSE](LICENSE).
