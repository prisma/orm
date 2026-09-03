import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/27455-bytes-id
// (postgres matrix entry; sqlserver opted-out upstream).
//
// Subject: records with Bytes @id are retrievable after create — the prisma-next
// Bytes type is Uint8Array (not Buffer).
//
// Upstream uses `timeTables: { createMany: { data: [...] } }` inside the
// parent create. In prisma-next this translates to a nested relation callback
// `timeTables: (tts) => tts.create([...])`.
//
// Note: `accommodationId` must be provided explicitly in the nested rows
// because prisma-next nested mutations do not automatically inject the parent FK.

describe('ports/prisma/functional/issues-27455-bytes-id', () => {
  it(
    'retrieves records after a create with Bytes IDs',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const id1 = new Uint8Array(16).fill(0);
        const id2 = new Uint8Array(16).fill(1);
        const id3 = new Uint8Array(16).fill(2);

        const result = await db.public.Accommodation.select('id', 'name')
          .include('timeTables', (timeTables) => timeTables.select('id'))
          .create({
            id: id1,
            name: 'Test Accommodation',
            timeTables: (timeTables) =>
              timeTables.create([
                { id: id2, accommodationId: id1 },
                { id: id3, accommodationId: id1 },
              ]),
          });

        expect(result).toEqual({
          id: id1,
          name: 'Test Accommodation',
          timeTables: [{ id: id2 }, { id: id3 }],
        });
      }),
    timeouts.spinUpPpgDev,
  );
});
