import type { InferModelRow } from '@internal/mongo-contract';
import type { CreateInput } from '@internal/mongo-orm';
import type { CodecTypes } from '@internal/target-mongo/codec-types';
import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';

const contract = defineContract({}, ({ field, model }) => ({
  models: {
    Sample: model('Sample', {
      collection: 'samples',
      fields: {
        _id: field.objectId(),
        string: field.string(),
        double: field.double(),
        int32: field.int32(),
        bool: field.bool(),
        date: field.date(),
        int64: field.int64(),
        int64Number: field.int64Number(),
        decimal128: field.decimal128(),
        binary: field.binary(),
        json: field.json(),
        bson: field.bson(),
      },
    }),
  },
}));

type Row = InferModelRow<typeof contract, 'Sample'>;
type Input = CreateInput<typeof contract, 'Sample'>;

test("the builder's copy of the codec types reads what the target's codec types read", () => {
  expectTypeOf<Row['_id']>().toEqualTypeOf<CodecTypes['mongo/objectId@1']['output']>();
  expectTypeOf<Row['string']>().toEqualTypeOf<CodecTypes['mongo/string@1']['output']>();
  expectTypeOf<Row['double']>().toEqualTypeOf<CodecTypes['mongo/double@1']['output']>();
  expectTypeOf<Row['int32']>().toEqualTypeOf<CodecTypes['mongo/int32@1']['output']>();
  expectTypeOf<Row['bool']>().toEqualTypeOf<CodecTypes['mongo/bool@1']['output']>();
  expectTypeOf<Row['date']>().toEqualTypeOf<CodecTypes['mongo/date@1']['output']>();
  expectTypeOf<Row['int64']>().toEqualTypeOf<CodecTypes['mongo/int64@1']['output']>();
  expectTypeOf<Row['int64Number']>().toEqualTypeOf<CodecTypes['mongo/int64Number@1']['output']>();
  expectTypeOf<Row['decimal128']>().toEqualTypeOf<CodecTypes['mongo/decimal128@1']['output']>();
  expectTypeOf<Row['binary']>().toEqualTypeOf<CodecTypes['mongo/binary@1']['output']>();
  expectTypeOf<Row['json']>().toEqualTypeOf<CodecTypes['mongo/json@1']['output']>();
  expectTypeOf<Row['bson']>().toEqualTypeOf<CodecTypes['mongo/bson@1']['output']>();
});

test("the builder's copy of the codec types writes what the target's codec types write", () => {
  expectTypeOf<Input['string']>().toEqualTypeOf<CodecTypes['mongo/string@1']['input']>();
  expectTypeOf<Input['int32']>().toEqualTypeOf<CodecTypes['mongo/int32@1']['input']>();
  expectTypeOf<Input['int64']>().toEqualTypeOf<CodecTypes['mongo/int64@1']['input']>();
  expectTypeOf<Input['int64Number']>().toEqualTypeOf<CodecTypes['mongo/int64Number@1']['input']>();
  expectTypeOf<Input['decimal128']>().toEqualTypeOf<CodecTypes['mongo/decimal128@1']['input']>();
  expectTypeOf<Input['binary']>().toEqualTypeOf<CodecTypes['mongo/binary@1']['input']>();
  expectTypeOf<Input['bson']>().toEqualTypeOf<CodecTypes['mongo/bson@1']['input']>();
});

test('an int64Number field reads and writes a number', () => {
  expectTypeOf<Row['int64Number']>().toEqualTypeOf<number>();
  expectTypeOf<Input['int64Number']>().toEqualTypeOf<number>();
});
