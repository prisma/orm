/**
 * The two `temporal.{createdAt,updatedAt}` preset pairs, exercised through encode against a real
 * server.
 *
 * These presets used to be equivalent *by construction*: `temporalStringAuthoringPresets`
 * delegated to `temporalAuthoringPresets`, so the two pairs lowered to the same generator and the
 * argument that they behaved alike needed no test. They no longer share a clock — a Temporal-backed
 * column takes a `Temporal.Instant`, a `*String` column takes text, and one generator cannot
 * produce both because a generator receives no column or codec context. So the equivalence is now a
 * behavioural claim, and this is where it is checked.
 *
 * Both halves have to hold for each pair:
 *
 * - `createdAt` fills from a PostgreSQL `now()` storage default, so the column is populated without
 *   the client sending anything.
 * - `updatedAt` fills from an execution generator whose value is constant across one ORM operation
 *   — a `createAll` of N rows writes one timestamp, not N — and advances on a later update.
 *
 * The insert is the part a control-plane test cannot reach: a generated value is bound as an
 * ordinary parameter and goes through the column's codec, which is where a generator producing the
 * wrong representation fails.
 */

import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../ports/_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function withReadings(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

/** Distinct values in an array, as text — one entry means every row agreed. */
function distinct(values: ReadonlyArray<{ toString: () => string }>): readonly string[] {
  return [...new Set(values.map((value) => value.toString()))];
}

describe('temporal default presets', () => {
  it(
    'both representations fill their storage default and share one generated value per operation',
    () =>
      withReadings(async ({ db }) => {
        await db.public.Reading.createAll([
          { id: 1, label: 'a' },
          { id: 2, label: 'b' },
          { id: 3, label: 'c' },
        ]);

        const rows = await db.public.Reading.orderBy((r) => r.id.asc()).all();
        expect(rows).toHaveLength(3);

        // The storage-default half: PostgreSQL filled both `createdAt` columns.
        for (const row of rows) {
          expect(row.createdAt).toBeInstanceOf(Temporal.Instant);
          expect(typeof row.createdAtText).toBe('string');
        }

        // The generator half, per representation. Not compared across representations: the two
        // pairs read two different clocks now — the server's for one, the client's for the other —
        // so what they share is the guarantee, not the value.
        expect(distinct(rows.map((row) => row.updatedAt))).toHaveLength(1);
        expect(distinct(rows.map((row) => row.updatedAtText))).toHaveLength(1);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'both representations advance on update',
    () =>
      withReadings(async ({ db }) => {
        const created = await db.public.Reading.create({ id: 1, label: 'a' });

        const updated = await db.public.Reading.where({ id: 1 }).update({ label: 'b' });

        expect(updated?.label).toBe('b');
        expect(Temporal.Instant.compare(updated!.updatedAt, created.updatedAt)).toBeGreaterThan(0);
        expect(updated!.updatedAtText).not.toBe(created.updatedAtText);
        // `createdAt` is a storage default, so an update leaves it where it was.
        expect(updated!.createdAt.toString()).toBe(created.createdAt.toString());
      }),
    timeouts.spinUpPpgDev,
  );
});
