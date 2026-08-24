import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../ports/_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function withReadings(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

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

        for (const row of rows) {
          expect(row.createdAt).toBeInstanceOf(Temporal.Instant);
          expect(typeof row.createdAtText).toBe('string');
        }

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
        expect(updated!.createdAt.toString()).toBe(created.createdAt.toString());
      }),
    timeouts.spinUpPpgDev,
  );
});
