// Type-level only: defineContract refuses a mongo/decimal128 enum when it runs, because a collection validator cannot list BSON decimals. The builder's types still follow the shared member rule.
import type { ExtractMongoFieldOutputTypes } from '@internal/mongo-contract';
import { expectTypeOf, test } from 'vitest';
import {
  defineContract,
  enumType,
  field,
  member,
  model,
  type,
} from '../src/exports/contract-builder';
import mongoStatic, { contractFromJson } from '../src/exports/static';

const Ratio = enumType(
  'Ratio',
  { codecId: 'mongo/decimal128@1' } as const,
  member('Half', '0.5'),
  member('Whole', '1.50'),
);
const Level = enumType('Level', { codecId: 'mongo/int32@1' } as const, member('Low', 1));

const contract = defineContract({
  enums: { Ratio, Level },
  models: {
    Reading: model('Reading', {
      collection: 'readings',
      fields: {
        _id: field.scalar(type.ObjectId()),
        ratio: field.namedType(Ratio),
        level: field.namedType(Level),
      },
    }),
  },
});
const { enums } = mongoStatic({ contract: contractFromJson<typeof contract>({}) });

test("a mongo/decimal128 enum's members, has() and column keep the codec's type, because a read can return a member in another scale", () => {
  expectTypeOf(enums.Ratio.members.Half).toEqualTypeOf<string>();
  expectTypeOf<Parameters<typeof enums.Ratio.nameOf>[0]>().toEqualTypeOf<string>();
  expectTypeOf<
    ExtractMongoFieldOutputTypes<typeof contract>['__unbound__']['Reading']['ratio']
  >().toEqualTypeOf<string>();
});

test('a mongo/int32 enum still narrows to its members', () => {
  expectTypeOf(enums.Level.members.Low).toEqualTypeOf<1>();
});
