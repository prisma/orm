import type { JsonValue } from '@internal/target-postgres/codec-types';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/29174-jsonb-parameter-regression
// (postgres matrix entry; allProviders minus sqlserver — this is the postgres port).
//
// Subject: `Date` objects embedded in a Json field are serialised to ISO-8601
// strings on write and surface as those strings on read. prisma-next's JSON codec
// serialises via `JSON.stringify`, so a `Date` goes through `Date#toJSON` → ISO
// string, matching upstream.
//
// The `$type: 'Json'` case: Prisma treats `{ $type: 'Json', ... }` as a protocol
// tagged value. prisma-next has no such tagged-value protocol, so the object is a
// plain JSON object; the `$type` key is stored and read back verbatim, and the
// embedded Date still serialises to an ISO string — the same observable result the
// upstream assertion checks.
//
// `Date` is not part of prisma-next's `JsonValue`, so Date-bearing inputs are cast
// (test files are cast-exempt); the cast preserves the subject (Date → ISO string).

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('ports/prisma/functional/issues-29174-jsonb-parameter-regression', () => {
  it(
    'correctly deserializes Date objects in JSON fields',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const user = await db.public.User.create({
          properties: { dateField: new Date() } as unknown as JsonValue,
        });
        expect(user).toMatchObject({
          properties: { dateField: expect.stringMatching(ISO_RE) },
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'correctly deserializes Date array objects in JSON fields',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const user = await db.public.User.create({
          properties: { dateArrayField: [new Date(), new Date()] } as unknown as JsonValue,
        });
        expect(user).toMatchObject({
          properties: {
            dateArrayField: [expect.stringMatching(ISO_RE), expect.stringMatching(ISO_RE)],
          },
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'correctly deserializes Date objects in JSON fields with $type',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const user = await db.public.User.create({
          properties: { $type: 'Json', dateField: new Date() } as unknown as JsonValue,
        });
        expect(user).toMatchObject({
          properties: { $type: 'Json', dateField: expect.stringMatching(ISO_RE) },
        });
      }),
    timeouts.spinUpPpgDev,
  );
});
