import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/25404
// (allProviders matrix; postgres entry ported here).
//
// Subject: creating a record with a String field containing a date-format string
// does not mangle or coerce the value — the memo field returns exactly as entered.
//
// Disposition:
//   'should not throw error when using d1 adapter and creating with string field
//    that contains date string' → passing

describe('ports/prisma/functional/issues-25404', () => {
  it(
    'does not mangle a String field containing a date-format string on create',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const result = await db.public.User.create({
          id: 'user1',
          memo: 'This is user input, 2024-10-09T16:05:08.547Z ',
        });

        expect(result.memo).toEqual('This is user input, 2024-10-09T16:05:08.547Z ');
      }),
    timeouts.spinUpPpgDev,
  );
});
