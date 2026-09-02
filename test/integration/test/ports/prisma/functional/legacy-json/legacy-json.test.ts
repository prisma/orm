import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/0-legacy-ports/json
// (postgres matrix entry only; sqlserver opted out as it does not support JSON).
//
// Upstream uses copycat.uuid(1) for the id; we use the same deterministic value
// directly. Upstream's requiredJson is a static object; we use the same shape.
//
// Prisma-next JSON behaviour vs upstream Prisma Client:
//   - JSON fields map to `pg/jsonb@1` (jsonb) returning a plain JsonValue.
//   - prisma-next shorthand `where({ requiredJson: value })` does equality
//     filtering (jsonb supports @= comparison).
//   - `where: { requiredJson: { equals: ... } }` → `where({ requiredJson: ... })`
//   - `where: { requiredJson: { not: ... } }` → `where((r) => r.requiredJson.neq(...))`
//   - `where: { requiredJson: { path: [...], equals: ... } }` → no path-based
//     JSON filter in prisma-next; recorded as non-ported.
//   - No inline snapshot ID (copycat replaced with literal).

const RESOURCE_ID = '02d25579a73a72373fa4e846';
const REQUIRED_JSON = {
  foo: 'bar',
  bar: { baz: 'qux' },
  quux: ['corge', 'grault'],
  garply: [{ waldo: 'fred' }, { plugh: 'xyzzy' }],
};

function withLegacyJson(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.Resource.where((r) => r.id.like('%')).deleteAll();
    await fn(ctx);
  });
}

describe('ports/prisma/functional/legacy-json', () => {
  it(
    'create required json',
    () =>
      withLegacyJson(async ({ db }) => {
        const result = await db.public.Resource.create({
          id: RESOURCE_ID,
          requiredJson: REQUIRED_JSON,
        });

        expect(result).toEqual({
          id: '02d25579a73a72373fa4e846',
          optionalJson: null,
          requiredJson: {
            bar: { baz: 'qux' },
            foo: 'bar',
            garply: [{ waldo: 'fred' }, { plugh: 'xyzzy' }],
            quux: ['corge', 'grault'],
          },
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'select required json',
    () =>
      withLegacyJson(async ({ db }) => {
        await db.public.Resource.create({ id: RESOURCE_ID, requiredJson: REQUIRED_JSON });

        const result = await db.public.Resource.select('requiredJson').all();

        expect(result).toHaveLength(1);
        expect(result[0]).toHaveProperty('requiredJson');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'select required json with where equals',
    () =>
      withLegacyJson(async ({ db }) => {
        await db.public.Resource.create({ id: RESOURCE_ID, requiredJson: REQUIRED_JSON });

        const result = await db.public.Resource.where({ requiredJson: REQUIRED_JSON }).all();

        expect(result).toHaveLength(1);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'select required json with where not equals',
    () =>
      withLegacyJson(async ({ db }) => {
        await db.public.Resource.create({ id: RESOURCE_ID, requiredJson: REQUIRED_JSON });

        const result = await db.public.Resource.where((r) =>
          r.requiredJson.neq(REQUIRED_JSON),
        ).all();

        expect(result).toHaveLength(0);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'update required json with where equals',
    () =>
      withLegacyJson(async ({ db }) => {
        await db.public.Resource.create({ id: RESOURCE_ID, requiredJson: REQUIRED_JSON });

        const result = await db.public.Resource.where({ id: RESOURCE_ID }).update({
          requiredJson: {},
        });

        expect(result).toEqual({
          id: '02d25579a73a72373fa4e846',
          optionalJson: null,
          requiredJson: {},
        });
      }),
    timeouts.spinUpPpgDev,
  );
});
