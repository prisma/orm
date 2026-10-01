import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { parsePostgresDefault } from '../src/core/default-normalizer';

const columns = [
  { name: 'a', storageType: 'real', written: "'1e20'::real", value: 1e20 },
  { name: 'b', storageType: 'real', written: "'1.5e-40'::real", value: 1.5e-40 },
  {
    name: 'c',
    storageType: 'double precision',
    written: "'1e300'::float8",
    value: 1e300,
  },
  {
    name: 'd',
    storageType: 'double precision',
    written: "'1e-320'::float8",
    value: 1e-320,
  },
  {
    name: 'e',
    storageType: 'double precision',
    written: '1e-7::double precision',
    value: 1e-7,
  },
] as const;

const storageTypeName: Record<string, string> = {
  real: 'float4',
  'double precision': 'float8',
};

describe('float defaults as Postgres prints them', () => {
  it(
    'reads each printed default back as the number it stands for',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          await client.query(
            `CREATE TABLE floats (${columns
              .map((column) => `${column.name} ${column.storageType} DEFAULT ${column.written}`)
              .join(', ')})`,
          );
          const printed = await client.query<{ column_name: string; column_default: string }>(
            `SELECT column_name, column_default FROM information_schema.columns
             WHERE table_name = 'floats' ORDER BY ordinal_position`,
          );
          const read = printed.rows.map((row) => {
            const column = columns.find((candidate) => candidate.name === row.column_name);
            const nativeType = storageTypeName[column?.storageType ?? ''] ?? '';
            return parsePostgresDefault(row.column_default, nativeType);
          });
          expect(read).toEqual(columns.map((column) => ({ kind: 'literal', value: column.value })));
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});

const uuidColumns = [
  { name: 'upper', storageType: 'uuid', written: "'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'::uuid" },
  { name: 'braced', storageType: 'uuid', written: "'{A0EEBC99-9C0B4EF8-BB6D6BB9-BD380A11}'::uuid" },
  { name: 'bare_digits', storageType: 'uuid', written: "'A0EEBC999C0B4EF8BB6D6BB9BD380A11'" },
  {
    name: 'array_literal',
    storageType: 'uuid[]',
    written:
      '\'{A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11,"{B0EEBC99-9C0B4EF8-BB6D6BB9-BD380A11}"}\'::uuid[]',
  },
  {
    name: 'array_constructor',
    storageType: 'uuid[]',
    written:
      "ARRAY['A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'::uuid, 'B0EEBC999C0B4EF8BB6D6BB9BD380A11']",
  },
] as const;

describe('uuid defaults as Postgres stores them', () => {
  it(
    'reads each default, as written and as Postgres prints it, as the value Postgres stores',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          await client.query(
            `CREATE TABLE uuids (${uuidColumns
              .map((column) => `${column.name} ${column.storageType} DEFAULT ${column.written}`)
              .join(', ')})`,
          );
          await client.query('INSERT INTO uuids DEFAULT VALUES');
          const stored = await client.query<{ row: Record<string, unknown> }>(
            'SELECT to_jsonb(u) AS row FROM uuids u',
          );
          const printed = await client.query<{ column_name: string; column_default: string }>(
            `SELECT column_name, column_default FROM information_schema.columns
             WHERE table_name = 'uuids'`,
          );
          const printedDefault = new Map(
            printed.rows.map((row) => [row.column_name, row.column_default]),
          );
          const storedRow = stored.rows[0]?.row ?? {};

          expect(
            uuidColumns.map((column) => ({
              name: column.name,
              written: parsePostgresDefault(column.written, column.storageType),
              printed: parsePostgresDefault(
                printedDefault.get(column.name) ?? '',
                column.storageType,
              ),
            })),
          ).toEqual(
            uuidColumns.map((column) => ({
              name: column.name,
              written: { kind: 'literal', value: storedRow[column.name] },
              printed: { kind: 'literal', value: storedRow[column.name] },
            })),
          );
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
