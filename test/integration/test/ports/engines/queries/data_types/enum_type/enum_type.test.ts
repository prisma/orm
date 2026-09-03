import { defineContract, enumType, field, member, model } from '@internal/mongo/contract-builder';
import { MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { timeouts as mongoTimeouts, withMongoPort } from '../../../../../_harness/mongo';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract as PostgresContract } from './_fixture/postgres/generated/contract';
import postgresContractJson from './_fixture/postgres/generated/contract.json' with {
  type: 'json',
};

function withEnum(fn: Parameters<typeof withPostgresPort<PostgresContract>>[1]) {
  return withPostgresPort<PostgresContract>({ contractJson: postgresContractJson }, fn);
}

const MyEnum = enumType(
  'MyEnum',
  { codecId: 'mongo/string@1', nativeType: 'string' },
  member('A'),
  member('B'),
  member('C'),
);

const mongoContract = defineContract({
  enums: { MyEnum },
  models: {
    TestModel: model('TestModel', {
      collection: 'TestModel',
      fields: {
        _id: field.int32(),
        my_enum: field.namedType(MyEnum).optional(),
      },
    }),
  },
});

describe('ports/engines/queries/data_types/enum_type', () => {
  it(
    'read_one',
    () =>
      withEnum(async ({ db }) => {
        await db.public.TestModel.create({ id: 1, my_enum: 'A' });
        await db.public.TestModel.create({ id: 2, my_enum: 'B' });
        await db.public.TestModel.create({ id: 3 });
        const result = await db.public.TestModel.select('my_enum').first({ id: 1 });
        expect(result).toEqual({ my_enum: 'A' });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'read_many',
    () =>
      withEnum(async ({ db }) => {
        await db.public.TestModel.create({ id: 1, my_enum: 'A' });
        await db.public.TestModel.create({ id: 2, my_enum: 'B' });
        await db.public.TestModel.create({ id: 3 });
        const result = await db.public.TestModel.select('my_enum').all();
        expect(result).toEqual([{ my_enum: 'A' }, { my_enum: 'B' }, { my_enum: null }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'read_one_invalid_mongo',
    () =>
      withMongoPort<typeof mongoContract>(
        { contractJson: mongoContract },
        async ({ db, mongoDb }) => {
          await mongoDb
            .collection<{ _id: number; my_enum: string }>('TestModel')
            .insertOne({ _id: 1, my_enum: 'D' }, { bypassDocumentValidation: true });

          await expect(
            db.TestModel.where(MongoFieldFilter.eq('_id', 1)).select('my_enum').first(),
          ).rejects.toThrow();
        },
      ),
    mongoTimeouts.spinUpMongoMemoryServer,
  );
});
