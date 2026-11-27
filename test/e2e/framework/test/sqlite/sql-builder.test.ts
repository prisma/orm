import { dirname, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { JsonValue } from '@prisma/orm-sqlite/adapter/codec-types';
import { UNBOUND_NAMESPACE_ID } from '@prisma/orm-sqlite/components/ir';
import { timeouts } from '@repo/test-utils';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { withSqliteTestRuntime } from './utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

/**
 * Replace the seeded posts with `groupCount` groups where group `g` holds `g`
 * rows — distinct counts spanning the two-digit boundary, so a count compared
 * or sorted as text ('10' < '9') diverges from the numeric answer.
 */
function seedPostsWithGroupCounts(rawDb: DatabaseSync, groupCount: number): void {
  rawDb.exec('DELETE FROM posts');
  const values: string[] = [];
  let id = 1;
  for (let group = 1; group <= groupCount; group += 1) {
    for (let i = 0; i < group; i += 1) {
      values.push(`(${id}, 'post ${id}', ${group}, 1)`);
      id += 1;
    }
  }
  rawDb.exec(`INSERT INTO posts (id, title, user_id, views) VALUES ${values.join(', ')}`);
}

/** Two rows whose `views` total leaves the safe integer range while staying a perfectly good SQLite integer. */
function seedWideSum(rawDb: DatabaseSync): void {
  rawDb.exec('DELETE FROM posts');
  rawDb.exec(
    "INSERT INTO posts (id, title, user_id, views) VALUES (1, 'a', 1, 9007199254740993), (2, 'b', 1, 2)",
  );
}

describe('e2e: sql-builder on SQLite', { timeout: timeouts.databaseOperation }, () => {
  describe('SELECT', () => {
    it('basic column projection', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
        const rows = await runtime.query(
          db[UNBOUND_NAMESPACE_ID].users.select('id', 'name').build(),
        );
        expect(rows).toHaveLength(4);
        expect(typeof rows[0]!.id).toBe('number');
        expect(typeof rows[0]!.name).toBe('string');

        expectTypeOf(rows[0]!).toEqualTypeOf<{ id: number; name: string }>();
      });
    });

    it('WHERE filter', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
        const rows = await runtime.query(
          db[UNBOUND_NAMESPACE_ID].users
            .select('id', 'name')
            .where((f, fns) => fns.eq(f.id, 1))
            .build(),
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.name).toBe('Alice');
      });
    });

    it('ORDER BY', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
        const rows = await runtime.query(
          db[UNBOUND_NAMESPACE_ID].users
            .select('id', 'name')
            .orderBy('id', { direction: 'desc' })
            .build(),
        );
        expect(rows[0]!.id).toBe(4);
        expect(rows[3]!.id).toBe(1);
      });
    });

    it('LIMIT and OFFSET', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
        const rows = await runtime.query(
          db[UNBOUND_NAMESPACE_ID].users.select('id').orderBy('id').limit(2).offset(1).build(),
        );
        expect(rows).toHaveLength(2);
        expect(rows[0]!.id).toBe(2);
        expect(rows[1]!.id).toBe(3);
      });
    });

    it('callback record select', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
        const rows = await runtime.query(
          db[UNBOUND_NAMESPACE_ID].users
            .select((f) => ({ myId: f.id, myName: f.name }))
            .orderBy('id')
            .build(),
        );
        expect(rows).toHaveLength(4);
        expect(rows[0]!.myId).toBe(1);
        expect(rows[0]!.myName).toBe('Alice');

        expectTypeOf(rows[0]!).toEqualTypeOf<{ myId: number; myName: string }>();
      });
    });
  });

  describe('INSERT', () => {
    it('insert with RETURNING', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
        const row = await runtime
          .query(
            db[UNBOUND_NAMESPACE_ID].users
              .insert([{ id: 100, name: 'Test', email: 'test@example.com' }])
              .returning('id', 'name')
              .build(),
          )
          .firstOrThrow();
        expect(row).toMatchObject({ id: 100, name: 'Test' });

        expectTypeOf(row).toEqualTypeOf<{ id: number; name: string }>();
      });
    });
  });

  describe('UPDATE', () => {
    it('update with WHERE and RETURNING', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
        const row = await runtime
          .query(
            db[UNBOUND_NAMESPACE_ID].users
              .update({ name: 'Alice Updated' })
              .where((f, fns) => fns.eq(f.id, 1))
              .returning('id', 'name')
              .build(),
          )
          .firstOrThrow();
        expect(row).toMatchObject({ id: 1, name: 'Alice Updated' });

        expectTypeOf(row).toEqualTypeOf<{ id: number; name: string }>();

        await runtime.execute(
          db[UNBOUND_NAMESPACE_ID].users
            .update({ name: 'Alice' })
            .where((f, fns) => fns.eq(f.id, 1))
            .build(),
        );
      });
    });
  });

  describe('DELETE', () => {
    it('delete with WHERE and RETURNING', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
        await runtime.execute(
          db[UNBOUND_NAMESPACE_ID].users
            .insert([{ id: 999, name: 'Temp', email: 'temp@example.com' }])
            .build(),
        );
        const deleted = await runtime
          .query(
            db[UNBOUND_NAMESPACE_ID].users
              .delete()
              .where((f, fns) => fns.eq(f.id, 999))
              .returning('id')
              .build(),
          )
          .firstOrThrow();
        expect(deleted).toMatchObject({ id: 999 });

        expectTypeOf(deleted).toEqualTypeOf<{ id: number }>();
      });
    });
  });

  describe('codec round-trip', () => {
    it('integer survives insert and select', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
        await runtime.execute(
          db[UNBOUND_NAMESPACE_ID].typed_rows
            .insert([
              {
                id: 1,
                active: 1,
                created_at: new Date('2024-01-01T00:00:00.000Z'),
                label: 'a',
              },
            ])
            .build(),
        );
        await runtime.execute(
          db[UNBOUND_NAMESPACE_ID].typed_rows
            .insert([
              {
                id: 2,
                active: 0,
                created_at: new Date('2024-06-15T12:00:00.000Z'),
                label: 'b',
              },
            ])
            .build(),
        );

        const rows = await runtime.query(
          db[UNBOUND_NAMESPACE_ID].typed_rows.select('id', 'active').orderBy('id').build(),
        );
        expect(rows[0]!.active).toBe(1);
        expect(rows[1]!.active).toBe(0);

        expectTypeOf(rows[0]!).toEqualTypeOf<{ id: number; active: number }>();
      });
    });

    it('datetime survives insert and select', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
        await runtime.execute(
          db[UNBOUND_NAMESPACE_ID].typed_rows
            .insert([
              {
                id: 1,
                active: 1,
                created_at: new Date('2024-01-01T00:00:00.000Z'),
                label: 'a',
              },
            ])
            .build(),
        );

        const rows = await runtime.query(
          db[UNBOUND_NAMESPACE_ID].typed_rows.select('id', 'created_at').orderBy('id').build(),
        );
        expect(rows[0]!.created_at).toBeInstanceOf(Date);
        expect((rows[0]!.created_at as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z');

        expectTypeOf(rows[0]!).toEqualTypeOf<{ id: number; created_at: Date }>();
      });
    });

    it('json survives insert and select', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
        const jsonData = { nested: { key: 'value' }, list: [1, 2, 3] };
        await runtime.execute(
          db[UNBOUND_NAMESPACE_ID].typed_rows
            .insert([
              {
                id: 3,
                active: 1,
                created_at: new Date('2024-01-01T00:00:00.000Z'),
                metadata: jsonData,
                label: 'c',
              },
            ])
            .build(),
        );

        const rows = await runtime.query(
          db[UNBOUND_NAMESPACE_ID].typed_rows
            .select('id', 'metadata')
            .where((f, fns) => fns.eq(f.id, 3))
            .build(),
        );
        expect(rows[0]!.metadata).toEqual(jsonData);

        expectTypeOf(rows[0]!).toEqualTypeOf<{ id: number; metadata: JsonValue | null }>();
      });
    });
  });

  describe('aggregates', () => {
    it('HAVING on count filters numerically across the two-digit boundary', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db, runtime, rawDb }) => {
        seedPostsWithGroupCounts(rawDb, 12);
        const rows = await runtime.query(
          db[UNBOUND_NAMESPACE_ID].posts
            .select('user_id')
            .select('cnt', (_f, fns) => fns.count())
            .groupBy('user_id')
            .having((_f, fns) => fns.gt(fns.count(), 9))
            .orderBy('user_id')
            .build(),
        );
        expect(rows).toEqual([
          { user_id: 10, cnt: 10 },
          { user_id: 11, cnt: 11 },
          { user_id: 12, cnt: 12 },
        ]);
      });
    });

    it('ORDER BY count sorts numerically across the two-digit boundary', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db, runtime, rawDb }) => {
        seedPostsWithGroupCounts(rawDb, 12);
        const rows = await runtime.query(
          db[UNBOUND_NAMESPACE_ID].posts
            .select('user_id')
            .select('cnt', (_f, fns) => fns.count())
            .groupBy('user_id')
            .orderBy((_f, fns) => fns.count(), { direction: 'desc' })
            .build(),
        );
        expect(rows.map((r) => r.user_id)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
      });
    });

    it('projects a sumBigInt past 2^53 through the bigint lowering', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db, runtime, rawDb }) => {
        seedWideSum(rawDb);
        const rows = await runtime.query(
          db[UNBOUND_NAMESPACE_ID].posts
            .select('total', (f, fns) => fns.sumBigInt(f.views))
            .build(),
        );
        expect(rows).toEqual([{ total: 9007199254740995n }]);
      });
    });

    it('refuses a bare sum past 2^53 rather than rounding it', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db, runtime, rawDb }) => {
        seedWideSum(rawDb);
        await expect(
          runtime.query(
            db[UNBOUND_NAMESPACE_ID].posts.select('total', (f, fns) => fns.sum(f.views)).build(),
          ),
        ).rejects.toMatchObject({
          code: 'RUNTIME.DECODE_FAILED',
          message:
            'A sqlite/bigintnumber@1 value is "9007199254740995", which is not an integer within the safe integer range. sqlite/bigintnumber@1 reads integers from -9007199254740991 to 9007199254740991.',
        });
      });
    });
  });

  describe('capability gating', () => {
    it('lateralJoin is not available (sql.lateral: false)', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db }) => {
        const table = db[UNBOUND_NAMESPACE_ID].users;
        // @ts-expect-error lateralJoin is gated out for SQLite
        expect(() => table.lateralJoin('alias', () => null)).toThrow(
          '`lateralJoin()` is unavailable: your contract declares no dependency on `sql.lateral`',
        );
      });
    });

    it('distinctOn is not available (no postgres.distinctOn)', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db }) => {
        const query = db[UNBOUND_NAMESPACE_ID].users.select('id');
        // @ts-expect-error distinctOn is gated out for SQLite
        expect(() => query.distinctOn('id')).toThrow(
          '`distinctOn()` is unavailable: your contract declares no dependency on `postgres.distinctOn`',
        );
      });
    });

    it('returning is available (sql.returning: true)', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ db }) => {
        expectTypeOf(
          db[UNBOUND_NAMESPACE_ID].users.insert([{ id: 1, name: 'a', email: 'a@a.com' }]).returning,
        ).not.toBeNever();
      });
    });
  });
});
