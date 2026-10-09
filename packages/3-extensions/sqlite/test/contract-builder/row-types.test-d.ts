import type { DefaultModelRow } from '@internal/sql-orm-client';
import { expectTypeOf, test } from 'vitest';
import { defineContract, enumType, member } from '../../src/exports/contract-builder';
import sqlite from '../../src/exports/runtime';

const Level = enumType(
  'Level',
  { codecId: 'sqlite/bigint@1', nativeType: 'integer' },
  member('Low', 1n),
  member('High', 10n),
);

const contract = defineContract({ enums: { Level } }, ({ field, model, type }) => ({
  models: {
    Reading: model('Reading', {
      fields: {
        id: field.column({ codecId: 'sqlite/integer@1', nativeType: 'integer' }).id(),
        label: field.column(type.sql.String(50)),
        note: field.column(type.sql.String(50)).optional(),
        count: field.column(type.BigIntNumber()),
        seen: field.temporal.datetime(),
        score: field.column({ codecId: 'sqlite/real@1', nativeType: 'real' }),
        at: field.column({ codecId: 'sqlite/datetime@1', nativeType: 'text' }),
        level: field.namedType(Level),
        uuid: field.id.uuidv4String(),
      },
    }).sql({ table: 'readings' }),
  },
}));

type ReadingRow = DefaultModelRow<typeof contract, 'Reading'>;

test('fields typed with authoring helpers read as the codec output type', () => {
  expectTypeOf<ReadingRow['label']>().toEqualTypeOf<string>();
  expectTypeOf<ReadingRow['note']>().toEqualTypeOf<string | null>();
  expectTypeOf<ReadingRow['count']>().toEqualTypeOf<number>();
  expectTypeOf<ReadingRow['seen']>().toEqualTypeOf<Date>();
  expectTypeOf<ReadingRow['uuid']>().toEqualTypeOf<string>();
});

test('fields typed with field.column read as the codec output type', () => {
  expectTypeOf<ReadingRow['id']>().toEqualTypeOf<number>();
  expectTypeOf<ReadingRow['score']>().toEqualTypeOf<number>();
  expectTypeOf<ReadingRow['at']>().toEqualTypeOf<Date>();
});

test('an enum field reads as its value set', () => {
  expectTypeOf<ReadingRow['level']>().toEqualTypeOf<1n | 10n>();
});

test('the client returns rows with the codec output types', async () => {
  const client = sqlite({ contract, path: ':memory:', verifyMarker: false });
  const row = await client.orm.Reading.first();
  expectTypeOf(row).toEqualTypeOf<{
    id: number;
    label: string;
    note: string | null;
    count: number;
    seen: Date;
    score: number;
    at: Date;
    level: 1n | 10n;
    uuid: string;
  } | null>();
});
