import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function withDateTime(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

const firstDate = Temporal.Instant.from('1900-10-10T01:10:10.001Z');
const secondDate = Temporal.Instant.from('1969-01-01T10:33:59.000Z');

/**
 * Reads a `dt` column as text.
 *
 * `dt` is a `Temporal.Instant`, which carries no own enumerable properties — every accessor lives
 * on the prototype. A structural matcher therefore compares two empty objects and passes for *any*
 * pair of instants, which in this suite would mean the repo's only datetime round-trip port
 * asserting nothing at all. Comparing the text is what makes it discriminate.
 */
function dtText(row: { readonly dt: Temporal.Instant | null } | null): string | null | undefined {
  return row === null ? null : (row.dt?.toString() ?? null);
}

describe('ports/engines/queries/data_types/datetime', () => {
  it(
    'read_one',
    () =>
      withDateTime(async ({ db }) => {
        await db.public.TestModel.create({ id: 1, dt: firstDate });
        await db.public.TestModel.create({ id: 2, dt: secondDate });
        await db.public.TestModel.create({ id: 3 });
        const result = await db.public.TestModel.select('dt').first({ id: 1 });
        expect(dtText(result)).toBe(firstDate.toString());
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'read_many',
    () =>
      withDateTime(async ({ db }) => {
        await db.public.TestModel.create({ id: 1, dt: firstDate });
        await db.public.TestModel.create({ id: 2, dt: secondDate });
        await db.public.TestModel.create({ id: 3 });
        const result = await db.public.TestModel.select('dt').all();
        expect(result.map(dtText)).toEqual([firstDate.toString(), secondDate.toString(), null]);
      }),
    timeouts.spinUpPpgDev,
  );
});
