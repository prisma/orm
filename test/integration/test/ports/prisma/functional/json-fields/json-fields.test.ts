import type { JsonValue } from '@internal/target-postgres/codec-types';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/json-fields
// (postgres matrix entry; sqlserver opted out as it does not support JSON).
//
// Upstream seeds entries with various json shapes and asserts the round-trip.
// prisma-next maps Json → jsonb; round-trips go through JSON serialisation.
//
// object with no prototype (Object.create(null)): serialises to `{}` because
// JSON.stringify treats null-prototype objects the same as regular objects.
//
// object with .toJSON method: prisma-next passes the value through JSON
// serialisation; .toJSON is called by JSON.stringify, so the stored value is
// whatever .toJSON returns. `url.toJSON()` returns the URL's href string.
//
// API translation: `prisma.entry.create({ data: { json } })` →
//   `db.public.Entry.create({ id, json })` (id is String @id, provided explicitly).

describe('ports/prisma/functional/json-fields', () => {
  it(
    'simple object',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const result = await db.public.Entry.create({ id: '1', json: { x: 1 } });
        expect(result).toMatchObject({
          json: { x: 1 },
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'empty object',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const result = await db.public.Entry.create({ id: '1', json: {} });
        expect(result).toMatchObject({
          json: {},
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'object with no prototype',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const result = await db.public.Entry.create({ id: '1', json: Object.create(null) });
        expect(result).toMatchObject({
          json: {},
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'object with .toJSON method',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const value = {
          toJSON: () => 'some value',
        };
        const url = new URL('http://example.com/');

        // cast: upstream Prisma accepts objects with .toJSON() in its InputJsonValue
        // type; prisma-next's JsonValue does not include function-valued properties.
        // Test files are cast-exempt; the cast preserves the subject (toJSON dispatch).
        const result = await db.public.Entry.create({
          id: '1',
          json: { value, url } as unknown as JsonValue,
        });

        expect(result).toMatchObject({
          json: {
            value: 'some value',
            url: 'http://example.com/',
          },
        });
      }),
    timeouts.spinUpPpgDev,
  );
});
