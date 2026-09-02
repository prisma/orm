import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/23201-non-ascii-comments
// (allProviders; postgres matrix entry).
//
// Subject: a schema containing non-ASCII characters in field comments (`// привет, 世界`)
// still connects to the database and performs queries without error.

function withIssue23201(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/issues-23201-non-ascii-comments', () => {
  it(
    'can connect to the DB and query when schema has non-ASCII comments',
    () =>
      withIssue23201(async ({ db }) => {
        const result = await db.public.User.first();
        expect(result).toBeNull();
      }),
    timeouts.spinUpPpgDev,
  );
});
