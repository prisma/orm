import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/12572
// (postgres matrix entry).
//
// Verifies that @default(now()) and @updatedAt produce equal date values on
// record creation. prisma-next maps @updatedAt to temporal.updatedAt().

describe('ports/prisma/functional/issues-12572', () => {
  it(
    'should have equal dates on record creation for @default(now) and @updatedAt',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const created = await db.public.User.create({});

        expect(Temporal.Instant.compare(created.createdAt, created.updatedAt)).toBe(0);
      }),
    timeouts.spinUpPpgDev,
  );
});
