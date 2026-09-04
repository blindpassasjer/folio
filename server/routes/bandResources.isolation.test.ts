// @vitest-environment node
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  db: null as unknown as import('drizzle-orm/node-postgres').NodePgDatabase<Record<string, unknown>>,
  ready: null as unknown as Promise<void>,
  client: null as unknown as import('@electric-sql/pglite').PGlite,
}));

vi.mock('../storage/localStorageAdapter.js', () => ({
  localStorageAdapter: {
    save: vi.fn(),
    read: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../db/client.js', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const schema = await import('../db/schema.js');

  const client = new PGlite();
  const db = drizzle(client, { schema: schema as unknown as Record<string, unknown> });

  h.client = client;
  h.ready = (async () => {
    await client.exec(`
      CREATE TABLE users (
        id text primary key,
        email text,
        email_lower text,
        username text,
        password_hash text,
        role text default 'member'
      );
      CREATE TABLE bands (
        id text primary key,
        name text,
        owner_id text,
        created_at timestamptz default now(),
        updated_at timestamptz default now()
      );
      CREATE TABLE band_members (
        band_id text,
        user_id text,
        role text default 'editor',
        joined_at timestamptz default now(),
        primary key (band_id, user_id)
      );
      CREATE TABLE song_lists (
        id text primary key,
        band_id text not null,
        name text not null,
        song_ids jsonb not null default '[]',
        folder_id text,
        icon text,
        sort_order integer
      );
      CREATE TABLE trash_items (
        id text primary key,
        band_id text not null,
        item_type text not null,
        payload jsonb not null,
        deleted_at timestamptz not null default now(),
        purge_at timestamptz not null
      );
    `);
    await client.exec(`
      INSERT INTO users (id, email, email_lower, username, password_hash) VALUES
        ('user-a', 'a@example.test', 'a@example.test', 'user-a', 'x'),
        ('user-b', 'b@example.test', 'b@example.test', 'user-b', 'x'),
        ('viewer-a', 'v@example.test', 'v@example.test', 'viewer-a', 'x');
      INSERT INTO bands (id, name, owner_id) VALUES
        ('band-a', 'Church A', 'user-a'),
        ('band-b', 'Church B', 'user-b');
      INSERT INTO band_members (band_id, user_id, role) VALUES
        ('band-a', 'user-a', 'editor'),
        ('band-a', 'viewer-a', 'viewer'),
        ('band-b', 'user-b', 'editor');
      INSERT INTO song_lists (id, band_id, name) VALUES
        ('list-a', 'band-a', 'Church A Songs'),
        ('list-b', 'band-b', 'Church B Songs');
    `);
  })();

  h.db = db as never;
  return { db };
});

const { bandSongListsRouter } = await import('./bandSongLists.js');

let server: ReturnType<express.Express['listen']>;
let baseUrl: string;

beforeAll(async () => {
  await h.ready;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header('x-user-id');
    if (userId) req.userId = userId;
    next();
  });
  app.use('/api/bands/:bandId/song-lists', bandSongListsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api/bands`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await h.client.close();
});

function request(
  bandId: string,
  path: string,
  userId: string,
  method = 'GET',
  body?: unknown,
) {
  return fetch(`${baseUrl}/${bandId}/song-lists${path}`, {
    method,
    headers: {
      'x-user-id': userId,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readSongList(id: string) {
  const result = await h.client.query<{ id: string; band_id: string; name: string }>(
    'SELECT id, band_id, name FROM song_lists WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}

describe('band resource tenant isolation', () => {
  it('does not let a member read another band through a band-scoped route', async () => {
    const response = await request('band-a', '/', 'user-b');
    expect(response.status).toBe(403);
  });

  it('does not let a client-supplied id overwrite or move another band resource', async () => {
    const response = await request('band-b', '/', 'user-b', 'POST', {
      id: 'list-a',
      name: 'Hijacked',
      songIds: [],
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'songList id is unavailable.' });
    expect(await readSongList('list-a')).toEqual({
      id: 'list-a',
      band_id: 'band-a',
      name: 'Church A Songs',
    });
  });

  it('keeps legitimate same-band POST upserts working', async () => {
    const response = await request('band-a', '/', 'user-a', 'POST', {
      id: 'list-a',
      name: 'Updated Church A Songs',
      songIds: [],
    });

    expect(response.status).toBe(200);
    expect(await readSongList('list-a')).toMatchObject({
      band_id: 'band-a',
      name: 'Updated Church A Songs',
    });
  });

  it('scopes PUT and DELETE lookups to the route band', async () => {
    const update = await request('band-a', '/list-b', 'user-a', 'PUT', {
      name: 'Not Church A Data',
      songIds: [],
    });
    const remove = await request('band-a', '/list-b', 'user-a', 'DELETE');

    expect(update.status).toBe(404);
    expect(remove.status).toBe(404);
    expect(await readSongList('list-b')).toMatchObject({
      band_id: 'band-b',
      name: 'Church B Songs',
    });
  });

  it('lets viewers read their band but never mutate it', async () => {
    expect((await request('band-a', '/', 'viewer-a')).status).toBe(200);
    expect((await request('band-a', '/', 'viewer-a', 'POST', {
      id: 'viewer-list',
      name: 'Viewer Write',
      songIds: [],
    })).status).toBe(403);
    expect(await readSongList('viewer-list')).toBeNull();
  });
});
