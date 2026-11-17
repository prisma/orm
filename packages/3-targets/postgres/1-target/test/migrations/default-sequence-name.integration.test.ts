import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { defaultSequenceName } from '../../src/core/migrations/default-sequence-name';
import { quoteIdentifier } from '../../src/core/sql-utils';

const cases = [
  { schema: 'public', table: 'Post', column: 'serialNumber' },
  { schema: 'public', table: 'a'.repeat(60), column: 'id' },
  { schema: 'public', table: 't'.repeat(40), column: 'c'.repeat(40) },
  { schema: 'public', table: `a${'ü'.repeat(31)}`, column: 'id' },
  { schema: 'public', table: 'ü'.repeat(30), column: 'naïveColumn' },
  { schema: 'Billing', table: 'Invoice', column: 'number' },
] as const;

describe('defaultSequenceName against Postgres', () => {
  it(
    'names the sequence of each SERIAL column as Postgres does',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          await client.query('CREATE SCHEMA "Billing"');
          const named: { schema: string; name: string }[] = [];
          for (const { schema, table, column } of cases) {
            const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
            await client.query(`CREATE TABLE ${qualified} (${quoteIdentifier(column)} SERIAL)`);
            const sequence = await client.query<{ schema: string; name: string }>(
              `SELECT n.nspname AS schema, c.relname AS name FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE c.oid = pg_get_serial_sequence($1, $2)::regclass`,
              [qualified, column],
            );
            named.push(...sequence.rows);
          }

          expect(named).toEqual(
            cases.map(({ schema, table, column }) => ({
              schema,
              name: defaultSequenceName(table, column),
            })),
          );
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
