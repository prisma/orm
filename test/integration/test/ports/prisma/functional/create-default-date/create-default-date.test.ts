import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/create-default-date
// (postgres matrix entry).
//
// Upstream: creates a Visit with no explicit data; asserts visitTime is a Date instance.
// prisma-next: same — create({}) relies on @default(now()) and @default(autoincrement()).
//
// Upstream opts out of Mongo/CockroachDB (autoincrement not supported there).
// This port is postgres-only by construction.

describe('ports/prisma/functional/create-default-date', () => {
  it(
    'correctly creates a field with default date',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const visit = await db.public.Visit.create({});
        expect(visit.visitTime).toBeInstanceOf(Temporal.Instant);
      }),
    timeouts.spinUpPpgDev,
  );
});
