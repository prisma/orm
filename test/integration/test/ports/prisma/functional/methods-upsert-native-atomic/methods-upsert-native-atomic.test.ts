import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/methods/upsert/native-atomic
// (postgres matrix entry; mongodb/mysql/sqlserver opted out).
//
// Tests 1–3 ('should only use ON CONFLICT when…') assert on query-log inspection —
// they capture $on('query') events to check whether the emitted SQL contained
// 'ON CONFLICT'. prisma-next has no equivalent query-log event API, and these
// tests check internal engine strategy selection rather than observable behaviour.
// Non-ported: no query log / ON CONFLICT strategy introspection API.
//
// Tests 4–6 are pure behavioural upsert tests (create then re-upsert) — ported.
// In prisma-next, upsert() uses `conflictOn` to specify the unique constraint.

function withNativeAtomic(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/methods-upsert-native-atomic', () => {
  it(
    'should perform an upsert (create then update on conflict)',
    () =>
      withNativeAtomic(async ({ db }) => {
        const name = 'native-atomic-upsert-user';

        const user = await db.public.User.upsert({
          create: { id: 'native-atomic-upsert-id', name },
          update: { name: `${name}-updated` },
          conflictOn: { name },
        });
        expect(user.name).toEqual(name);

        const userUpdated = await db.public.User.upsert({
          create: { id: 'native-atomic-upsert-id', name },
          update: { name: `${name}-updated` },
          conflictOn: { name },
        });
        expect(userUpdated.name).toEqual(`${name}-updated`);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should perform an upsert with id conflict',
    () =>
      withNativeAtomic(async ({ db }) => {
        const name = 'native-atomic-id-user';

        const user = await db.public.User.upsert({
          create: { id: 'fixed-id-1', name },
          update: { name: `${name}-updated` },
          conflictOn: { id: 'fixed-id-1' },
        });
        expect(user.name).toEqual(name);

        const userUpdated = await db.public.User.upsert({
          create: { id: 'fixed-id-1', name },
          update: { name: `${name}-updated` },
          conflictOn: { id: 'fixed-id-1' },
        });
        expect(userUpdated.name).toEqual(`${name}-updated`);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should perform an upsert with compound id',
    () =>
      withNativeAtomic(async ({ db }) => {
        let compound = await db.public.Compound.upsert({
          create: { id1: 1, id2: '1', field1: 2, field2: '2', val: 1 },
          update: { val: 2 },
          conflictOn: { id1: 1, id2: '1' },
        });
        expect(compound.val).toEqual(1);

        compound = await db.public.Compound.upsert({
          create: { id1: 1, id2: '1', field1: 2, field2: '2', val: 1 },
          update: { val: 2 },
          conflictOn: { id1: 1, id2: '1' },
        });
        expect(compound.val).toEqual(2);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should perform an upsert with compound unique conflict',
    () =>
      withNativeAtomic(async ({ db }) => {
        let compound = await db.public.Compound.upsert({
          create: { id1: 1, id2: '1', field1: 2, field2: '2', val: 1 },
          update: { val: 2 },
          conflictOn: { field1: 2, field2: '2' },
        });
        expect(compound.val).toEqual(1);

        compound = await db.public.Compound.upsert({
          create: { id1: 1, id2: '1', field1: 2, field2: '2', val: 1 },
          update: { val: 2 },
          conflictOn: { field1: 2, field2: '2' },
        });
        expect(compound.val).toEqual(2);
      }),
    timeouts.spinUpPpgDev,
  );
});
