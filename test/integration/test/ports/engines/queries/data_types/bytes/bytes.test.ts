import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract as RelationContract } from './_fixture/relations/generated/contract';
import relationContractJson from './_fixture/relations/generated/contract.json' with {
  type: 'json',
};
import type { Contract as ScalarContract } from './_fixture/scalars/generated/contract';
import scalarContractJson from './_fixture/scalars/generated/contract.json' with { type: 'json' };

const bytes = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));

describe('ports/engines/queries/data_types/bytes', () => {
  it(
    'common_types',
    () =>
      withPostgresPort<RelationContract>({ contractJson: relationContractJson }, async ({ db }) => {
        await db.public.Parent.create({ id: 1 });
        await db.public.Child.create({ childId: 1, parentId: 1, bytes: bytes('AQID') });
        await db.public.Child.create({ childId: 2, parentId: 1, bytes: bytes('FDSF') });
        const result = await db.public.Parent.select('id')
          .include('children', (children) => children.select('childId', 'bytes'))
          .all();
        expect(result).toEqual([
          {
            id: 1,
            children: [
              { childId: 1, bytes: bytes('AQID') },
              { childId: 2, bytes: bytes('FDSF') },
            ],
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'read_one',
    () =>
      withPostgresPort<ScalarContract>({ contractJson: scalarContractJson }, async ({ db }) => {
        await db.public.TestModel.create({ id: 1, bytes: bytes('FSDF') });
        await db.public.TestModel.create({ id: 2, bytes: bytes('dGVzdA==') });
        await db.public.TestModel.create({ id: 3 });
        const result = await db.public.TestModel.select('bytes').first({ id: 1 });
        expect(result).toEqual({ bytes: bytes('FSDF') });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'read_many',
    () =>
      withPostgresPort<ScalarContract>({ contractJson: scalarContractJson }, async ({ db }) => {
        await db.public.TestModel.create({ id: 1, bytes: bytes('FSDF') });
        await db.public.TestModel.create({ id: 2, bytes: bytes('dGVzdA==') });
        await db.public.TestModel.create({ id: 3 });
        const result = await db.public.TestModel.select('bytes').all();
        expect(result).toEqual([
          { bytes: bytes('FSDF') },
          { bytes: bytes('dGVzdA==') },
          { bytes: null },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
