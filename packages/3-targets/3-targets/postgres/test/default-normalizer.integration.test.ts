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
