import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import mysql from '../../src/runtime/mysql';
import { contractFromJson } from '../../src/static/contract-from-json';
import type { Contract } from '../fixtures/generated/contract.d';
import contractJson from '../fixtures/generated/contract.json' with { type: 'json' };
import { exampleDatabase, withSeededDatabase } from './live-database';

const contract = contractFromJson<Contract>(contractJson);

describe('MySQL raw SQL with integer values', { timeout: timeouts.databaseOperation }, () => {
  it('compares and builds JSON from int values as integers, and adds bigint values, sent as decimal text, as integers once one is cast, as on Postgres', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      const [row] = await db.query(
        db.raw
          .sql`SELECT ${10} < ${9} AS lt, GREATEST(${10}, ${9}) AS greatest, CAST(JSON_ARRAY(${5}) AS CHAR) AS arr, CAST(${9007199254740993n} AS SIGNED) + ${1n} AS sum`
          .returnsRow({
            lt: 'mysql/int@1',
            greatest: 'mysql/int@1',
            arr: 'mysql/text@1',
            sum: 'mysql/bigint@1',
          })
          .build(),
      );
      expect(row).toEqual({ lt: 0, greatest: 10, arr: '[5]', sum: 9007199254740994n });
    });
  });

  it('compares a varchar column with an integer value as a number', async (test) => {
    await withSeededDatabase(
      test,
      [...exampleDatabase, 'UPDATE `Post` SET `title` = CAST(`id` * 5 AS CHAR)'],
      async (url) => {
        await using db = mysql({ contract, url, verifyMarker: false });
        const rows = await db.query(
          db.raw.sql`SELECT id FROM Post WHERE title > ${9} ORDER BY id`
            .returnsRow({ id: 'mysql/int@1' })
            .build(),
        );
        expect(rows).toEqual([{ id: 2 }, { id: 3 }, { id: 4 }]);
      },
    );
  });

  it('takes integer values as the operands of LIMIT and OFFSET', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      const ids = (plan: Parameters<typeof db.query>[0]) => db.query(plan);
      expect({
        limit: await ids(
          db.raw.sql`SELECT id FROM Post ORDER BY id LIMIT ${2}`
            .returnsRow({ id: 'mysql/int@1' })
            .build(),
        ),
        offset: await ids(
          db.raw.sql`SELECT id FROM Post ORDER BY id LIMIT ${2} OFFSET ${1}`
            .returnsRow({ id: 'mysql/int@1' })
            .build(),
        ),
        pair: await ids(
          db.raw.sql`SELECT id FROM Post ORDER BY id LIMIT ${1}, ${2}`
            .returnsRow({ id: 'mysql/int@1' })
            .build(),
        ),
      }).toEqual({
        limit: [{ id: 1 }, { id: 2 }],
        offset: [{ id: 2 }, { id: 3 }],
        pair: [{ id: 2 }, { id: 3 }],
      });
    });
  });

  it('runs a query awaited inside the loop over a large result in a transaction, because a query reads its whole result first, as on Postgres', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      const seen = await db.transaction(async (tx) => {
        let total = 0;
        for await (const row of tx.query(
          tx.raw
            .sql`WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < ${500}) SELECT n, REPEAT('x', 4000) AS pad FROM s`
            .returnsRow({ n: 'mysql/int@1', pad: 'mysql/text@1' })
            .build(),
        )) {
          const [echo] = await tx.query(
            tx.raw.sql`SELECT ${row.n} AS m`.returnsRow({ m: 'mysql/int@1' }).build(),
          );
          total += echo?.m ?? 0;
        }
        return total;
      });
      expect(seen).toBe((500 * 501) / 2);
    });
  });
});
