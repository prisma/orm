import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { postgresRenderCheckExpressions } from '../src/core/check-expressions';

describe('numeric membership checks in Postgres', () => {
  it.each(['smallint', 'integer', 'real', 'double precision', 'numeric'])(
    'enforces scalar and array membership for %s storage',
    async (storageType) => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          const fractional = !['smallint', 'integer'].includes(storageType);
          const memberValues = fractional ? [-3, 1, 2.5] : [-3, 1, 2];
          for (const many of [false, true]) {
            const checks = postgresRenderCheckExpressions({
              tableName: 'members',
              columnName: 'value',
              many,
              memberValues,
            });
            await client.query(
              `CREATE TABLE members (value ${storageType}${many ? '[]' : ''}, ${checks.map(({ expression }) => `CHECK (${expression})`).join(', ')})`,
            );
            const accepted = fractional ? '2.50' : '2';
            await client.query(
              `INSERT INTO members VALUES (${many ? `ARRAY[-3, 1, ${accepted}]` : accepted})`,
            );
            await expect(
              client.query(`INSERT INTO members VALUES (${many ? 'ARRAY[7]' : '7'})`),
            ).rejects.toMatchObject({ code: '23514' });
            if (many) {
              await client.query('INSERT INTO members VALUES (ARRAY[]::numeric[])');
              await expect(
                client.query('INSERT INTO members VALUES (ARRAY[1, NULL])'),
              ).rejects.toMatchObject({ code: '23514' });
            }
            await client.query('DROP TABLE members');
          }
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
