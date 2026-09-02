import type { JsonValue } from '@internal/target-postgres/codec-types';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/29267-uint8array-in-json
// (postgres matrix entry; allProviders minus sqlserver — this is the postgres port).
//
// Subject: a `Uint8Array` embedded anywhere inside a Json field is serialised to a
// base64 string. Prisma special-cases `Uint8Array` in its JSON serialiser.
//
// prisma-next's JSON codec serialises via plain `JSON.stringify`, which turns a
// `Uint8Array` into an index-keyed object (`{ "0": 72, "1": 101, ... }`), not a
// base64 string. This is a genuine prisma-next gap: there is no Uint8Array→base64
// hook in the JSON codec path. The faithful upstream assertions are ported verbatim
// and marked `it.fails` — they run but diverge on this serialisation.
//
// `Uint8Array` is not part of prisma-next's `JsonValue`, so inputs are cast
// (test files are cast-exempt); the cast preserves the subject (Uint8Array → base64).

describe('ports/prisma/functional/issues-29267-uint8array-in-json', () => {
  it.fails(
    'serializes Uint8Array nested in object as base64',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const uint8 = new Uint8Array([72, 101, 108, 108, 111]);
        const record = await db.public.TestRecord.create({
          data: { payload: uint8, label: 'test' } as unknown as JsonValue,
        });
        expect(record.data).toEqual({ payload: 'SGVsbG8=', label: 'test' });
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'serializes Uint8Array nested in array as base64',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const uint8 = new Uint8Array([72, 101, 108, 108, 111]);
        const record = await db.public.TestRecord.create({
          data: [uint8, 'hello'] as unknown as JsonValue,
        });
        expect(record.data).toEqual(['SGVsbG8=', 'hello']);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'serializes Uint8Array directly as base64',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const uint8 = new Uint8Array([72, 101, 108, 108, 111]);
        const record = await db.public.TestRecord.create({
          data: uint8 as unknown as JsonValue,
        });
        expect(record.data).toBe('SGVsbG8=');
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'serializes deeply nested Uint8Array as base64',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const uint8 = new Uint8Array([1, 2, 3]);
        const record = await db.public.TestRecord.create({
          data: { outer: { inner: uint8 } } as unknown as JsonValue,
        });
        expect(record.data).toEqual({ outer: { inner: 'AQID' } });
      }),
    timeouts.spinUpPpgDev,
  );
});
