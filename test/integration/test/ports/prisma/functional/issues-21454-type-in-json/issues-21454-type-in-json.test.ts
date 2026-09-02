import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/21454-$type-in-json
// (postgres + all SQL providers; optOut excludes sqlserver).
//
// Subject: JSON values containing a `$type` key are stored and read back verbatim.
// Prisma uses `$type` as a tagged-value protocol in some JSON serialisation paths;
// the regression was that `$type` got stripped or transformed. prisma-next has no
// such tagged-value protocol, so the key is stored and returned verbatim.

function withIssue21454(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/issues-21454-$type-in-json', () => {
  it(
    'preserves json with $type key inside',
    () =>
      withIssue21454(async ({ db }) => {
        const { json } = await db.public.Test.create({ json: { $type: 'Thing' } });
        expect(json).toEqual({ $type: 'Thing' });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'preserves deeply nested json with $type key inside',
    () =>
      withIssue21454(async ({ db }) => {
        const { json } = await db.public.Test.create({ json: { nested: { $type: 'Thing' } } });
        expect(json).toEqual({ nested: { $type: 'Thing' } });
      }),
    timeouts.spinUpPpgDev,
  );
});
