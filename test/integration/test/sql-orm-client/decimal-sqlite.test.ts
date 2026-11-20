import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { orm } from '@internal/sql-orm-client';
import { activitySource, delegatingActivitySource } from '@internal/sql-runtime';
import type { SqliteClient } from '@internal/sqlite/runtime';
import sqlite from '@internal/sqlite/runtime';
import { contractFromJson } from '@internal/sqlite/static';
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rejectionShape } from './error-shape';
import type { Contract } from './fixtures/decimal-sqlite/generated/contract';
import contractJson from './fixtures/decimal-sqlite/generated/contract.json' with { type: 'json' };

describe('integration/Decimal and BigIntNumber on sqlite', () => {
  let directory: string | undefined;
  let database: DatabaseSync | undefined;
  let client: SqliteClient<Contract> | undefined;
  let db: ReturnType<typeof orm<Contract>> | undefined;

  const invoices = () => db![UNBOUND_NAMESPACE_ID].Invoice;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-decimal-'));
    const path = join(directory, 'test.db');
    database = new DatabaseSync(path);
    database.exec(`
      create table invoice (
        id integer primary key,
        total text not null,
        rebate text,
        visits integer not null
      );
      create table invoice_line (
        id integer primary key,
        invoice_id integer not null references invoice(id),
        amount text not null
      );
    `);

    client = sqlite({
      contract: contractFromJson<Contract>(contractJson),
      path,
      verifyMarker: false,
    });
    const runtime = await client.connect();
    db = orm({
      context: client.context,
      runtime: {
        query(plan) {
          return runtime.query(plan);
        },
        execute(plan) {
          return runtime.execute(plan);
        },
        connection() {
          return runtime.connection();
        },
        [activitySource]: delegatingActivitySource(() => runtime),
      },
    });
  });

  afterAll(async () => {
    await client?.close();
    database?.close();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  });

  it('emits sqlite/decimal@1 for Decimal and sqlite/integer@1 for BigIntNumber', () => {
    const columns = contractJson.storage.namespaces.__unbound__.entries.table.invoice.columns;
    expect({
      total: columns.total.codecId,
      rebate: columns.rebate.codecId,
      visits: columns.visits.codecId,
    }).toEqual({
      total: 'sqlite/decimal@1',
      rebate: 'sqlite/decimal@1',
      visits: 'sqlite/integer@1',
    });
  });

  it('writes decimal text in its stored form and reads it back as a string', async () => {
    await invoices().create({ id: 1, total: '12.50', rebate: null, visits: 3 });
    await invoices().create({ id: 2, total: '007.10', rebate: '-0.0', visits: 9007199254740991 });

    const rows = await invoices()
      .select('id', 'total', 'rebate', 'visits')
      .orderBy((invoice) => invoice.id.asc())
      .all();

    expect(rows).toEqual([
      { id: 1, total: '12.50', rebate: null, visits: 3 },
      { id: 2, total: '7.10', rebate: '0.0', visits: 9007199254740991 },
    ]);
    expect(
      database!.prepare('select total, typeof(total) as storage from invoice order by id').all(),
    ).toEqual([
      { total: '12.50', storage: 'text' },
      { total: '7.10', storage: 'text' },
    ]);
  });

  it('filters by equality, and compares the stored text by its characters', async () => {
    const matched = await invoices()
      .select('id')
      .where((invoice) => invoice.total.eq('12.50'))
      .all();
    const sameNumberOtherText = await invoices()
      .select('id')
      .where((invoice) => invoice.total.eq('12.5'))
      .all();
    expect({ matched, sameNumberOtherText }).toEqual({
      matched: [{ id: 1 }],
      sameNumberOtherText: [],
    });
  });

  it('carries a Decimal column through an include', async () => {
    await db![UNBOUND_NAMESPACE_ID].InvoiceLine.create({ id: 1, invoiceId: 1, amount: '0.25' });
    const rows = await invoices()
      .select('id')
      .where((invoice) => invoice.id.eq(1))
      .include('lines', (line) => line.select('id', 'amount'))
      .all();
    expect(rows).toEqual([{ id: 1, lines: [{ id: 1, amount: '0.25' }] }]);
  });

  it('refuses to write text that is not a decimal', async () => {
    const shape = await rejectionShape(
      invoices().create({ id: 3, total: 'twelve', rebate: null, visits: 0 }),
    );
    expect(shape).toEqual({
      name: 'StructuredError',
      message: 'sqlite/decimal@1 value must be decimal text, such as "12.50", got "twelve"',
      code: 'RUNTIME.ENCODE_FAILED',
      meta: { codecId: 'sqlite/decimal@1', received: 'twelve' },
    });
  });

  it('refuses to write a BigIntNumber past the safe integer range', async () => {
    const shape = await rejectionShape(
      invoices().create({ id: 3, total: '1', rebate: null, visits: 9007199254740992 }),
    );
    expect(shape).toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message:
        'sqlite/integer@1 value must be an integer within the safe integer range, got 9007199254740992',
    });
  });

  it('raises a decode error naming the column when the stored text is not a decimal', async () => {
    database!.exec(`insert into invoice (id, total, visits) values (10, '', 0)`);

    const shape = await rejectionShape(
      invoices()
        .select('id', 'total')
        .where((invoice) => invoice.id.eq(10))
        .all(),
    );
    expect(shape).toEqual({
      name: 'StructuredError',
      message:
        'Column "invoice"."total" holds "", which is not decimal text. sqlite/decimal@1 reads decimal text, such as "12.50".',
      code: 'RUNTIME.DECODE_FAILED',
      meta: { codecId: 'sqlite/decimal@1', table: 'invoice', column: 'total', received: '' },
    });

    database!.exec('delete from invoice where id = 10');
  });
});
