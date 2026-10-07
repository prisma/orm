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

describe('list membership checks in Postgres', () => {
  it(
    'compares members in the element type and reads quoted members back exactly',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          const columns = {
            hosts: { type: 'inet', members: ['127.0.0.1', '10.0.0.0/8', '::1'] },
            ratios: { type: 'numeric', members: ['0.5', '1.50'] },
            labels: { type: 'varchar(20)', members: ['say "hi"', 'back\\slash', "o'brien"] },
          };
          const checks = Object.entries(columns).flatMap(([columnName, { members }]) =>
            postgresRenderCheckExpressions({
              tableName: 'lists',
              columnName,
              many: { elementNullable: false },
              memberValues: members,
            }),
          );
          await client.query(
            `CREATE TABLE lists (id int, ${Object.entries(columns)
              .map(([name, { type }]) => `${name} ${type}[]`)
              .join(', ')}, ${checks.map(({ expression }) => `CHECK (${expression})`).join(', ')})`,
          );
          await client.query('INSERT INTO lists VALUES ($1, $2, $3, $4)', [
            1,
            ['127.0.0.1', '10.0.0.0/8', '::1'],
            ['0.5', '1.50'],
            ['say "hi"', 'back\\slash', "o'brien"],
          ]);
          await client.query('INSERT INTO lists VALUES ($1, $2, $3, $4)', [
            2,
            ['127.0.0.1/32'],
            ['0.50'],
            [],
          ]);
          const refused = await Promise.all(
            [
              [['10.0.0.1'], [], []],
              [['10.0.0.0/16'], [], []],
              [[], ['0.7'], []],
              [[], [], ['say hi']],
            ].map((values, index) =>
              client
                .query('INSERT INTO lists VALUES ($1, $2, $3, $4)', [10 + index, ...values])
                .then(
                  () => 'accepted',
                  (error: { code?: string }) => error.code,
                ),
            ),
          );
          const { rows } = await client.query(
            'SELECT id, hosts::text, ratios::text, labels FROM lists ORDER BY id',
          );
          expect({ rows, refused }).toEqual({
            rows: [
              {
                id: 1,
                hosts: '{127.0.0.1,10.0.0.0/8,::1}',
                ratios: '{0.5,1.50}',
                labels: ['say "hi"', 'back\\slash', "o'brien"],
              },
              { id: 2, hosts: '{127.0.0.1}', ratios: '{0.50}', labels: [] },
            ],
            refused: ['23514', '23514', '23514', '23514'],
          });
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'takes text members that need array-literal quoting, on a scalar and a list column, and refuses a near miss of each',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          const members = ['a,b', '{brace}', '', 'NULL', ' lead'];
          const nearMisses = ['a', 'brace', ' ', 'Null', 'lead'];
          const checks = [false, true].flatMap((many) =>
            postgresRenderCheckExpressions({
              tableName: 'labels',
              columnName: many ? 'list' : 'scalar',
              many: many ? { elementNullable: false } : false,
              memberValues: members,
            }),
          );
          await client.query(
            `CREATE TABLE labels (id serial, scalar text, list text[], ${checks.map(({ expression }) => `CHECK (${expression})`).join(', ')})`,
          );
          for (const member of members) {
            await client.query('INSERT INTO labels (scalar, list) VALUES ($1, $2)', [
              member,
              [member],
            ]);
          }
          await client.query('INSERT INTO labels (scalar, list) VALUES ($1, $2)', ['a,b', members]);
          const refused = await Promise.all(
            nearMisses.flatMap((nearMiss) =>
              [
                [nearMiss, []],
                ['a,b', [nearMiss]],
              ].map((values) =>
                client.query('INSERT INTO labels (scalar, list) VALUES ($1, $2)', values).then(
                  () => `accepted ${JSON.stringify(values)}`,
                  (error: { code?: string }) => error.code,
                ),
              ),
            ),
          );
          const { rows } = await client.query('SELECT scalar, list FROM labels ORDER BY id');

          expect({ rows, refused }).toEqual({
            rows: [
              ...members.map((member) => ({ scalar: member, list: [member] })),
              { scalar: 'a,b', list: members },
            ],
            refused: nearMisses.flatMap(() => ['23514', '23514']),
          });
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
