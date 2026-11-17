/**
 * Wire-level proof that NamedCursor combines named-prepared-statement reuse
 * with row-by-row streaming.
 */

import { createDevDatabase, timeouts } from '@repo/test-utils';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { NamedCursor } from '../src/named-cursor';

async function readAll<Row>(cursor: NamedCursor<Row>, batch: number): Promise<Row[]> {
  const all: Row[] = [];
  while (true) {
    const rows = await cursor.read(batch);
    if (rows.length === 0) {
      return all;
    }
    all.push(...rows);
  }
}

describe('NamedCursor: wire-level Parse reuse + streaming', () => {
  it(
    'sends Parse once across two cursor executions of the same handle name',
    async () => {
      const database = await createDevDatabase();
      const client = new pg.Client({ connectionString: database.connectionString });
      await client.connect();

      let parseCompleteCount = 0;
      // biome-ignore lint/suspicious/noExplicitAny: pg.Connection internals are untyped
      const connection = (client as any).connection;
      connection.on('parseComplete', () => {
        parseCompleteCount++;
      });

      try {
        await client.query('create table items (id serial primary key, n int)');
        const insertValues = Array.from({ length: 50 }, (_, i) => `(${i})`).join(', ');
        await client.query(`insert into items (n) values ${insertValues}`);

        const sql = 'select id, n from items where n >= $1 order by id';

        const baseline = parseCompleteCount;

        const c1 = new NamedCursor<{ id: number; n: number }>({
          name: 'nc_1',
          text: sql,
          values: [0],
        });
        client.query(c1);
        const rows1 = await readAll(c1, 8);
        expect(rows1).toHaveLength(50);

        const c2 = new NamedCursor<{ id: number; n: number }>({
          name: 'nc_1',
          text: sql,
          values: [40],
        });
        client.query(c2);
        const rows2 = await readAll(c2, 8);
        expect(rows2).toHaveLength(10);
        expect(rows2[0]?.n).toBe(40);

        // c1 sent Parse; c2 saw the name in connection.parsedStatements and
        // skipped it.
        expect(parseCompleteCount - baseline).toBe(1);

        const prepared = await client.query<{ name: string }>(
          'select name from pg_prepared_statements order by name',
        );
        expect(prepared.rows.map((r) => r.name)).toEqual(['nc_1']);
      } finally {
        await client.end();
        await database.close();
      }
    },
    timeouts.spinUpPpgDev,
  );
});
