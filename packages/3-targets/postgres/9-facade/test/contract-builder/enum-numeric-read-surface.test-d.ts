import type { NamespacedEnums } from '@internal/contract/enum-accessor';
import type { CreateInput, DefaultModelRow } from '@internal/sql-orm-client';
import { expectTypeOf, test } from 'vitest';
import { defineContract, enumType, member } from '../../src/exports/contract-builder';

const pgNumeric = { codecId: 'pg/numeric@1' } as const;
const pgInt = { codecId: 'pg/int4@1' } as const;

const Ratio = enumType('Ratio', pgNumeric, member('Half', '0.5'), member('Whole', '1.50'));
const Level = enumType('Level', pgInt, member('Low', 1), member('High', 10));

const contract = defineContract({ enums: { Ratio, Level } }, ({ field, model, gen, type }) => ({
  models: {
    Reading: model('Reading', {
      fields: {
        id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
        ratio: field.namedType(Ratio),
        level: field.namedType(Level),
      },
    }),
  },
}));

type ReadingRow = DefaultModelRow<typeof contract, 'Reading'>;
type ReadingCreate = CreateInput<typeof contract, 'Reading'>;

test("a numeric enum column keeps the codec's type, because a read can return a member in another scale", () => {
  expectTypeOf<ReadingRow['ratio']>().toEqualTypeOf<string>();
  expectTypeOf<ReadingCreate['ratio']>().toEqualTypeOf<string>();
});

test('an int4 enum column still narrows to its members', () => {
  expectTypeOf<ReadingRow['level']>().toEqualTypeOf<1 | 10>();
});

type Enums = NamespacedEnums<typeof contract>['public'];

test("a numeric enum's members keep the codec's type, so has() and nameOf() take any value a read returns", () => {
  expectTypeOf<Enums['Ratio']['members']['Half']>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<Enums['Ratio']['nameOf']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<Enums['Level']['members']['Low']>().toEqualTypeOf<1>();
});
