import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { withTestRuntime } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('DML E2E Tests', { timeout: 30000 }, () => {
  it('inserts, updates, and deletes a user', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db, client, runtime }) => {
      // Insert
      await runtime.execute(db.public.user.insert([{ email: 'e2e@example.com' }]).build());

      const insertedRows = await runtime.query(
        db.public.user
          .select('id', 'email', 'created_at', 'update_at')
          .where((f, fns) => fns.eq(f.email, 'e2e@example.com'))
          .limit(1)
          .build(),
      );
      const inserted = insertedRows[0];

      expect(inserted).toMatchObject({
        id: expect.any(Number),
        email: 'e2e@example.com',
        created_at: expect.any(Temporal.Instant),
        update_at: null,
      });

      const userId = inserted!.id;

      // Update
      await runtime.execute(
        db.public.user
          .update({ email: 'updated-e2e@example.com' })
          .where((f, fns) => fns.eq(f.id, userId))
          .build(),
      );

      const updatedRows = await runtime.query(
        db.public.user
          .select('id', 'email')
          .where((f, fns) => fns.eq(f.id, userId))
          .limit(1)
          .build(),
      );
      const updated = updatedRows[0];

      expect(updated).toMatchObject({
        id: userId,
        email: 'updated-e2e@example.com',
      });

      // Delete
      await runtime.execute(
        db.public.user
          .delete()
          .where((f, fns) => fns.eq(f.id, userId))
          .build(),
      );

      // Verify deleted
      const selectResult = await client.query('SELECT * FROM "user" WHERE id = $1', [userId]);
      expect(selectResult.rows.length).toBe(0);
    });
  });
});

describe('DML E2E Tests - UUIDv7 client-generated IDs', { timeout: 30000 }, () => {
  const UUIDV7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('auto-generates a valid UUIDv7 id on insert', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
      await runtime.execute(db.public.event.insert([{ name: 'uuidv7-test-event' }]).build());

      const rows = await runtime.query(
        db.public.event
          .select('id', 'name', 'created_at', 'scheduled_at')
          .where((f, fns) => fns.eq(f.name, 'uuidv7-test-event'))
          .limit(1)
          .build(),
      );
      const row = rows[0];

      expect(row).toMatchObject({
        id: expect.stringMatching(UUIDV7_REGEX),
        name: 'uuidv7-test-event',
        created_at: expect.any(Temporal.Instant),
        scheduled_at: '2024-01-15 10:30:00+00',
      });
    });
  });

  it('allows overriding the auto-generated id', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
      const overrideId = '019470ab-9a66-7000-8000-000000000001';

      await runtime.execute(
        db.public.event.insert([{ id: overrideId, name: 'override-event' }]).build(),
      );

      const rows = await runtime.query(
        db.public.event
          .select('id', 'name')
          .where((f, fns) => fns.eq(f.id, overrideId))
          .limit(1)
          .build(),
      );
      const row = rows[0];

      expect(row).toMatchObject({
        id: overrideId,
        name: 'override-event',
      });
    });
  });

  it('updates and deletes by UUIDv7 id', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db, client, runtime }) => {
      // Insert (auto-generated id)
      await runtime.execute(db.public.event.insert([{ name: 'to-be-updated' }]).build());

      const insertedRows = await runtime.query(
        db.public.event
          .select('id', 'name')
          .where((f, fns) => fns.eq(f.name, 'to-be-updated'))
          .limit(1)
          .build(),
      );
      const inserted = insertedRows[0];

      const eventId = inserted!.id;
      expect(eventId).toMatch(UUIDV7_REGEX);

      // Update
      await runtime.execute(
        db.public.event
          .update({ name: 'updated-event' })
          .where((f, fns) => fns.eq(f.id, eventId))
          .build(),
      );

      const updatedRows = await runtime.query(
        db.public.event
          .select('id', 'name')
          .where((f, fns) => fns.eq(f.id, eventId))
          .limit(1)
          .build(),
      );
      const updated = updatedRows[0];

      expect(updated).toMatchObject({
        id: eventId,
        name: 'updated-event',
      });

      // Delete
      await runtime.execute(
        db.public.event
          .delete()
          .where((f, fns) => fns.eq(f.id, eventId))
          .build(),
      );

      // Verify deleted
      const selectResult = await client.query('SELECT * FROM "event" WHERE id = $1', [eventId]);
      expect(selectResult.rows.length).toBe(0);
    });
  });

  it('applies literal defaults for every supported type', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
      await runtime.execute(db.public.literal_defaults.insert([{}]).build());

      const rows = await runtime.query(
        db.public.literal_defaults
          .select('id', 'label', 'score', 'rating', 'active', 'big_count', 'metadata', 'tags')
          .limit(1)
          .build(),
      );
      const row = rows[0];

      expect(row).not.toBeNull();
      expect(row!.id).toEqual(expect.any(Number));
      expect(row!.label).toBe('draft');
      expect(row!.score).toBe(0);
      expect(row!.rating).toBeCloseTo(3.14);
      expect(row!.active).toBe(true);
      expect(row!.big_count).toBe(9007199254740991n);
      expect(row!.metadata).toEqual({ key: 'default' });
      expect(row!.tags).toEqual(['alpha', 'beta']);
    });
  });

  it('supports typed jsonb/json values in insert and select clauses', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
      const profile = {
        displayName: 'e2e',
        tags: ['typed', 'json'],
        active: true,
      } as const;
      const meta = {
        source: 'dml-test',
        rank: 10,
        verified: true,
      } as const;

      await runtime.execute(
        db.public.user.insert([{ email: 'json@example.com', profile }]).build(),
      );

      const userRows = await runtime.query(
        db.public.user
          .select('id', 'profile')
          .where((f, fns) => fns.eq(f.email, 'json@example.com'))
          .limit(1)
          .build(),
      );
      const userRow = userRows[0];

      expect(userRow).toMatchObject({ profile });

      await runtime.execute(
        db.public.post
          .insert([
            {
              userId: userRow!.id,
              title: 'Typed JSON post',
              published: true,
              meta,
            },
          ])
          .build(),
      );

      const postRows = await runtime.query(
        db.public.post
          .select('id', 'meta')
          .where((f, fns) => fns.eq(f.title, 'Typed JSON post'))
          .limit(1)
          .build(),
      );
      const postRow = postRows[0];

      expect(postRow).toMatchObject({ meta });
    });
  });
});
