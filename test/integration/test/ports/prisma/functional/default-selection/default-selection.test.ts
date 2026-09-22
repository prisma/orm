import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/default-selection
// (postgres matrix entry).
//
// Upstream asserts that the default selection returned by findFirstOrThrow:
//   - includes scalar fields (id, value, otherId)
//   - does NOT include relations
//   - includes enums
//   - includes String[] lists (postgres-only)
//   - includes Enum[] enum lists (postgres-only, not mysql)
//   - does NOT include MongoDB composites (mongo-only — skipped)
//
// The faithful PSL translation includes `enumList Enum[]`, a text-backed enum
// list column. That column used to lower to `CHECK (enumList IN ('A', 'B'))`,
// which Postgres rejects for an array column, so the whole suite failed at
// schema push. The membership check is now array containment.
//
// Note: MongoDB `composite` field is mongo-only and is not ported here.

function withDefaultSelection(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

const SEED_OTHER = { id: 'other-1' };
const SEED_MODEL = {
  id: 'model-1',
  value: 'Foo',
  otherId: 'other-1',
  list: ['Hello', 'world'],
  enum: 'A' as const,
  enumList: ['A', 'B'] as const,
};

describe('ports/prisma/functional/default-selection', () => {
  it(
    'includes scalars',
    () =>
      withDefaultSelection(async ({ db }) => {
        await db.public.Other.create(SEED_OTHER);
        await db.public.Model.create(SEED_MODEL);
        const model = await db.public.Model.first({ id: 'model-1' });
        expect(model).not.toBeNull();
        expect(model!.id).toBeDefined();
        expect(model!.value).toBeDefined();
        expect(model!.otherId).toBeDefined();
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'does not include relations',
    () =>
      withDefaultSelection(async ({ db }) => {
        await db.public.Other.create(SEED_OTHER);
        await db.public.Model.create(SEED_MODEL);
        const model = await db.public.Model.first({ id: 'model-1' });
        expect(model).not.toBeNull();
        expect(model).not.toHaveProperty('relation');
        expectTypeOf(model!).not.toBeAny();
        expectTypeOf(model!).not.toHaveProperty('relation');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'includes enums',
    () =>
      withDefaultSelection(async ({ db }) => {
        await db.public.Other.create(SEED_OTHER);
        await db.public.Model.create(SEED_MODEL);
        const model = await db.public.Model.first({ id: 'model-1' });
        expect(model).not.toBeNull();
        expect(model!.enum).toBeDefined();
        expect(model!.enum).toEqual('A');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'includes lists',
    () =>
      withDefaultSelection(async ({ db }) => {
        await db.public.Other.create(SEED_OTHER);
        await db.public.Model.create(SEED_MODEL);
        const model = await db.public.Model.first({ id: 'model-1' });
        expect(model).not.toBeNull();
        expect(model!.list).toBeDefined();
        expect(model!.list).toEqual(['Hello', 'world']);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'includes enum lists',
    () =>
      withDefaultSelection(async ({ db }) => {
        await db.public.Other.create(SEED_OTHER);
        await db.public.Model.create(SEED_MODEL);
        const model = await db.public.Model.first({ id: 'model-1' });
        expect(model).not.toBeNull();
        expect(model!.enumList).toBeDefined();
        expect(model!.enumList).toEqual(['A', 'B']);
      }),
    timeouts.spinUpPpgDev,
  );
});
