import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/mixed-string-uuid-datetime-list-inputs
// (postgres matrix entry only; mongodb and cockroachdb skipped — out of scope).
//
// https://github.com/prisma/prisma/issues/9248
//
// Verifies that a String[] field correctly round-trips values whose textual
// content resembles ISO-8601 datetimes or UUIDs.  The pg driver must not
// attempt to coerce those strings to other scalar types when storing or
// reading an array of text.
//
// Upstream helper `permutations` is reproduced inline — it is a simple
// array-permutation generator with no external deps.

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((item, i) =>
    permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

function withMixedListInputs(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

async function expectCreateToSucceed(
  db: Parameters<Parameters<typeof withPostgresPort<Contract>>[1]>[0]['db'],
  words: string[],
): Promise<void> {
  const created = await db.public.Post.create({ words });

  expect(created.words).toEqual(words);

  const readBack = await db.public.Post.where({ id: created.id }).all();
  expect(readBack).toHaveLength(1);
  expect(readBack[0]?.words).toEqual(words);
}

describe('ports/prisma/functional/mixed-string-uuid-datetime-list-inputs', () => {
  it(
    'create with two strings',
    () =>
      withMixedListInputs(async ({ db }) => {
        await expectCreateToSucceed(db, ['hello', 'world']);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'create with a string that looks like a date',
    () =>
      withMixedListInputs(async ({ db }) => {
        await expectCreateToSucceed(db, ['2022-09-06T16:31:16.269Z']);
        await expectCreateToSucceed(db, ['2022-09-06T16:31:16.269Z', '2021-09-14T00:00:00.000Z']);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'create with a string and a string that looks like a date',
    () =>
      withMixedListInputs(async ({ db }) => {
        await expectCreateToSucceed(db, ['hello', '2022-09-06T16:31:16.269Z']);
        await expectCreateToSucceed(db, ['2022-09-06T16:31:16.269Z', 'hello']);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'create a string that looks like a uuid',
    () =>
      withMixedListInputs(async ({ db }) => {
        await expectCreateToSucceed(db, ['4464dcac-809d-4f01-8642-81d637cd7cdd']);
        await expectCreateToSucceed(db, [
          '4464dcac-809d-4f01-8642-81d637cd7cdd',
          '2690FE4B-BB1C-4278-8022-9C029C2248C8',
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'create with a string and a string that looks like a uuid',
    () =>
      withMixedListInputs(async ({ db }) => {
        await expectCreateToSucceed(db, ['hello', '4464dcac-809d-4f01-8642-81d637cd7cdd']);
        await expectCreateToSucceed(db, ['2690FE4B-BB1C-4278-8022-9C029C2248C8', 'world']);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'create with a date and uuid',
    () =>
      withMixedListInputs(async ({ db }) => {
        await expectCreateToSucceed(db, [
          '2022-09-06T16:31:16.269Z',
          '4464dcac-809d-4f01-8642-81d637cd7cdd',
        ]);
        await expectCreateToSucceed(db, [
          '2690FE4B-BB1C-4278-8022-9C029C2248C8',
          '2021-09-14T00:00:00.000Z',
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'create with a string, date and uuid',
    () =>
      withMixedListInputs(async ({ db }) => {
        const words = ['hello', '2022-09-06T16:31:16.269Z', '4464dcac-809d-4f01-8642-81d637cd7cdd'];

        for (const permutedWords of permutations(words)) {
          await expectCreateToSucceed(db, permutedWords);
        }
      }),
    timeouts.spinUpPpgDev,
  );
});
