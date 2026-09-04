import { Router } from 'express';
import type { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import type { PgTableWithColumns, PgColumn } from 'drizzle-orm/pg-core';
import { db } from '../db/client.js';
import { requireAuth } from '../middleware/session.js';
import { requireBandEditor, requireBandMember } from '../middleware/bandAccess.js';
import { insertTrashItem, type TrashItemType } from '../lib/trash.js';

interface BandCrudConfig<Row extends Record<string, unknown>, Api> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: PgTableWithColumns<any>;
  idColumn: PgColumn;
  bandIdColumn: PgColumn;
  resourceKey: string;
  pluralKey: string;
  /** Trash item type recorded when a row is soft-deleted (see Phase 5 trash_items). */
  itemType: TrashItemType;
  toApi: (row: Row) => Api;
  fromBody: (body: Record<string, unknown>, id: string, bandId: string) => Record<string, unknown>;
  /**
   * Optional side effect run after a successful create or update (e.g. record a revision
   * snapshot). Failures here are logged but never fail the write.
   */
  afterWrite?: (ctx: {
    kind: 'create' | 'update';
    row: Row;
    prevRow: Row | null;
    req: Request;
  }) => Promise<void>;
  /**
   * Optional side effect run before a row is deleted (e.g. clean up child files that a DB-level
   * cascade would otherwise strand on disk). Runs after the row is snapshotted to trash but
   * before the delete itself; a failure is logged but never blocks the delete.
   */
  beforeDelete?: (ctx: { row: Row; req: Request }) => Promise<void>;
}

async function runAfterWrite<Row extends Record<string, unknown>>(
  afterWrite: BandCrudConfig<Row, unknown>['afterWrite'],
  ctx: { kind: 'create' | 'update'; row: Row; prevRow: Row | null; req: Request },
): Promise<void> {
  if (!afterWrite) return;
  try {
    await afterWrite(ctx);
  } catch (err) {
    console.error('afterWrite hook failed:', err);
  }
}

/**
 * Builds a band-scoped CRUD router (list/create/update/delete) mounted at
 * `/api/bands/:bandId/<resource>`. Structurally mirrors `buildCrudRouter` in `crud.ts`
 * but checks band membership/editor role instead of personal ownership.
 */
export function buildBandCrudRouter<Row extends { bandId: string | null }, Api>(
  config: BandCrudConfig<Row, Api>,
) {
  const { table, idColumn, bandIdColumn, resourceKey, pluralKey, itemType, toApi, fromBody, afterWrite, beforeDelete } =
    config;
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  router.get('/', requireBandMember, async (req, res) => {
    try {
      const rows = (await db
        .select()
        .from(table)
        .where(eq(bandIdColumn, req.params.bandId))) as Row[];
      res.json({ [pluralKey]: rows.map(toApi) });
    } catch (err) {
      console.error(`Failed to list band ${pluralKey}:`, err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  router.post('/', requireBandEditor, async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = typeof body.id === 'string' && body.id ? body.id : null;
      if (!id) {
        res.status(400).json({ error: 'id is required.' });
        return;
      }
      // IDs originate in the client because the offline/demo data layer shares the same wire
      // format. Look up a conflicting ID globally before deciding whether this is a create or
      // an update. Scoping this lookup to the requested band and then using ON CONFLICT UPDATE
      // would let a member of one band move/overwrite another band's row if they learned its ID.
      const prior = (await db
        .select()
        .from(table)
        .where(eq(idColumn, id))
        .limit(1)) as Row[];

      if (prior[0] && prior[0].bandId !== req.params.bandId) {
        // Do not reveal which other band owns the ID.
        res.status(409).json({ error: `${resourceKey} id is unavailable.` });
        return;
      }

      const values = fromBody(body, id, req.params.bandId);
      const [row] = prior[0]
        ? (await db
            .update(table)
            .set(values)
            .where(and(eq(idColumn, id), eq(bandIdColumn, req.params.bandId)))
            .returning()) as Row[]
        : (await db
            .insert(table)
            .values(values)
            .returning()) as Row[];
      res.json({ [resourceKey]: toApi(row) });
      await runAfterWrite(afterWrite, {
        kind: prior[0] ? 'update' : 'create',
        row,
        prevRow: prior[0] ?? null,
        req,
      });
    } catch (err) {
      console.error(`Failed to save band ${resourceKey}:`, err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  router.put('/:id', requireBandEditor, async (req, res) => {
    try {
      const existing = (await db
        .select()
        .from(table)
        .where(and(eq(idColumn, req.params.id), eq(bandIdColumn, req.params.bandId)))
        .limit(1)) as Row[];
      if (!existing[0]) {
        res.status(404).json({ error: `${resourceKey} not found.` });
        return;
      }
      const values = fromBody((req.body ?? {}) as Record<string, unknown>, req.params.id, req.params.bandId);
      const [row] = (await db
        .update(table)
        .set(values)
        .where(and(eq(idColumn, req.params.id), eq(bandIdColumn, req.params.bandId)))
        .returning()) as Row[];
      res.json({ [resourceKey]: toApi(row) });
      await runAfterWrite(afterWrite, { kind: 'update', row, prevRow: existing[0], req });
    } catch (err) {
      console.error(`Failed to update band ${resourceKey}:`, err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  router.delete('/:id', requireBandEditor, async (req, res) => {
    try {
      const existing = (await db
        .select()
        .from(table)
        .where(and(eq(idColumn, req.params.id), eq(bandIdColumn, req.params.bandId)))
        .limit(1)) as Row[];
      if (!existing[0]) {
        res.status(404).json({ error: `${resourceKey} not found.` });
        return;
      }
      await insertTrashItem({ bandId: req.params.bandId }, itemType, toApi(existing[0]));
      if (beforeDelete) {
        try {
          await beforeDelete({ row: existing[0], req });
        } catch (err) {
          console.error(`beforeDelete hook failed for band ${resourceKey}:`, err);
        }
      }
      await db
        .delete(table)
        .where(and(eq(idColumn, req.params.id), eq(bandIdColumn, req.params.bandId)));
      res.json({});
    } catch (err) {
      console.error(`Failed to delete band ${resourceKey}:`, err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  return router;
}
