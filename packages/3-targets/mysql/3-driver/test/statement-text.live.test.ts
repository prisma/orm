import { timeouts } from '@repo/test-utils';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { describe, expect, it } from 'vitest';
import mysqlControlDriver from '../src/core/migrations/control-driver';
import mysqlRuntimeDriver from '../src/core/runtime/runtime-driver';

async function collect<Row>(rows: AsyncIterable<Row>): Promise<Row[]> {
  const out: Row[] = [];
  for await (const row of rows) out.push(row);
  return out;
}

const commentThePackageMisreads = 'SELECT 1 AS a /*/ ? */';

describe('MySQL statement text', { timeout: timeouts.databaseOperation }, () => {
  it('sends a statement without values exactly as written, through both drivers, so the package never searches it for placeholders', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const control = await mysqlControlDriver.create(url);
      const runtime = mysqlRuntimeDriver.create();
      const streaming = mysqlRuntimeDriver.create({ stream: true });
      await runtime.connect({ kind: 'url', url });
      await streaming.connect({ kind: 'url', url });
      try {
        expect({
          control: (await control.query(commentThePackageMisreads)).rows,
          runtime: await collect(runtime.query({ sql: commentThePackageMisreads })),
          stream: await collect(streaming.query({ sql: commentThePackageMisreads })),
          execute: await runtime.execute({ sql: commentThePackageMisreads, params: [] }),
        }).toEqual({
          control: [{ a: '1' }],
          runtime: [{ a: '1' }],
          stream: [{ a: '1' }],
          execute: { affectedRows: 0 },
        });
      } finally {
        await control.close();
        await runtime.close();
        await streaming.close();
      }
    });
  });
});
