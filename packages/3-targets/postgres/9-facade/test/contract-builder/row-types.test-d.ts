import { rawColumn } from '@internal/adapter-postgres/column-types';
import type { Char, Varchar } from '@internal/target-postgres/codec-types';
import { expectTypeOf, test } from 'vitest';
import { defineContract, enumType, member, sql } from '../../src/exports/contract-builder';
import postgres from '../../src/exports/runtime';

const Level = enumType('Level', { codecId: 'pg/int8@1' }, member('Low', 1n), member('High', 10n));

const contract = defineContract({ enums: { Level } }, ({ field, model, type, gen }) => ({
  models: {
    Reading: model('Reading', {
      fields: {
        id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
        label: field.column(type.sql.String(50)),
        note: field.column(type.sql.String(50)).optional(),
        level: field.namedType(Level),
        area: field.column(type.Raw(sql`circle`)),
        search: field.column(type.Raw(sql`tsvector`)).optional(),
        nets: field.column(type.Raw(sql`cidr`)).many(),
        codes: field.column(rawColumn(sql`character varying(3)`)).many(),
      },
    }).sql({ table: 'readings' }),
  },
}));

test('the client returns rows of a TypeScript contract with the codec output types', async () => {
  const client = postgres({ contract, url: 'postgres://localhost/db' });
  expectTypeOf<keyof typeof client.orm>().toEqualTypeOf<'public' | 'fragment'>();
  const row = await client.orm.public.Reading.first();
  expectTypeOf(row).toEqualTypeOf<{
    id: Char<36>;
    label: Varchar<50>;
    note: Varchar<50> | null;
    level: 1n | 10n;
    area: unknown;
    search: unknown;
    nets: readonly unknown[];
    codes: readonly unknown[];
  } | null>();
});
