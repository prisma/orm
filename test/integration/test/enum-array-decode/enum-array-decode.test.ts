import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function withEnumArrayDecode(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('decoding a native-enum array column', () => {
  it(
    'reads a row with a native-enum array column',
    () =>
      withEnumArrayDecode(async ({ db }) => {
        const created = await db.public.Probe.create({
          id: '1',
          moods: ['URGENT', 'LOW'],
          note: '{"a": 1}',
        });

        expect(created).toEqual({ id: '1', moods: ['URGENT', 'LOW'], note: '{"a": 1}' });

        const found = await db.public.Probe.first({ id: '1' });

        expect(found).toEqual({ id: '1', moods: ['URGENT', 'LOW'], note: '{"a": 1}' });
      }),
    timeouts.spinUpPpgDev,
  );
});
