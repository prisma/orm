import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import mysql from '../../src/runtime/mysql';
import { contractFromJson } from '../../src/static/contract-from-json';
import type { Contract } from '../fixtures/generated/contract.d';
import contractJson from '../fixtures/generated/contract.json' with { type: 'json' };
import { exampleDatabase, withSeededDatabase } from './live-database';

const contract = contractFromJson<Contract>(contractJson);

describe('MySQL raw SQL with integer values', { timeout: timeouts.databaseOperation }, () => {
  it('compares, combines and builds JSON from integer values as integers, not text', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      const [row] = await db.query(
        db.raw
          .sql`SELECT ${10} < ${9} AS lt, GREATEST(${10}, ${9}) AS greatest, CAST(JSON_ARRAY(${5}) AS CHAR) AS arr, ${9007199254740993n} + ${1n} AS sum`
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
});
