import { expectTypeOf, test } from 'vitest';
import { defineContract, enumType, member } from '../../src/exports/contract-builder';
import postgres from '../../src/exports/runtime';

const Level = enumType(
  'Level',
  { codecId: 'pg/int8@1', nativeType: 'int8' },
  member('Low', 1n),
  member('High', 10n),
);

const contract = defineContract({ enums: { Level } }, ({ field, model, type }) => ({
  models: {
    Reading: model('Reading', {
      fields: {
        id: field.id.uuidv4String(),
        label: field.column(type.sql.String(50)),
        note: field.column(type.sql.String(50)).optional(),
        level: field.namedType(Level),
      },
    }).sql({ table: 'readings' }),
  },
}));

test('the client returns rows of a TypeScript contract with the codec output types', async () => {
  const client = postgres({ contract, url: 'postgres://localhost/db' });
  expectTypeOf<keyof typeof client.orm>().toEqualTypeOf<'public' | 'fragment'>();
  const row = await client.orm.public.Reading.first();
  expectTypeOf(row).toEqualTypeOf<{
    id: string;
    label: string;
    note: string | null;
    level: 1n | 10n;
  } | null>();
});

test('the client keeps a namespace declared on a TypeScript contract', () => {
  const withAuth = defineContract({ namespaces: ['auth'] }, ({ field, model }) => ({
    models: {
      Session: model('Session', {
        namespace: 'auth',
        fields: { id: field.id.uuidv4String() },
      }).sql({ table: 'sessions' }),
    },
  }));
  const client = postgres({ contract: withAuth, url: 'postgres://localhost/db' });
  expectTypeOf<keyof typeof client.orm>().toEqualTypeOf<'public' | 'auth' | 'fragment'>();
});
