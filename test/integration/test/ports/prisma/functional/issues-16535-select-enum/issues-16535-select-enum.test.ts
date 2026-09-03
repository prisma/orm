import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/16535-select-enum
// (postgres matrix entry; sqlite/mongodb/sqlserver opted-out upstream).
//
// Verifies that creating a record with an enum field and selecting only that
// enum field returns the correct value.

describe('ports/prisma/functional/issues-16535-select-enum', () => {
  it(
    'allows to select enum field',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const user = await db.public.User.select('role').create({ role: 'ADMIN' });

        expect(user).toEqual({ role: 'ADMIN' });
      }),
    timeouts.spinUpPpgDev,
  );
});
