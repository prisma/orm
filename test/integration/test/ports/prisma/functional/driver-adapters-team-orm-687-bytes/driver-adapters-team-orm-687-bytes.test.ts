import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function withBytesEncoding(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/driver-adapters/team-orm-687-bytes', () => {
  it(
    'Bytes encoding is preserved',
    () =>
      withBytesEncoding(async ({ db, transaction }) => {
        const inputStrings = ['AQID', 'FSDF', 'AA', 'BB'];
        const inputBtoas = inputStrings.map((value) => btoa(value));
        const inputs = [...inputStrings, ...inputBtoas];
        const inputBuffers = inputs.map((value) => Buffer.from(value));
        const inputData = inputBuffers.map((bytes, index) => ({
          id: `${index + 1}`,
          bytes: new Uint8Array(bytes),
        }));

        await transaction(async (tx) => {
          for (const data of inputData) {
            await tx.orm.public.A.create(data);
          }
        });

        const outputData = await db.public.A.select('id', 'bytes').all();

        expect(outputData).toEqual(inputData);
      }),
    timeouts.spinUpPpgDev,
  );
});
