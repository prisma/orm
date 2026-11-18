import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { integerBigIntColumn, integerNumberColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import { soleDomainNamespaceId } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { defineContract, field, model, rel } from '@internal/sqlite/contract-builder';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIN_INT64 = -9223372036854775808n;
const MAX_INT64 = 9223372036854775807n;
const WIDE = 2n ** 60n + 1n;

const Entry = model('Entry', {
  fields: {
    id: field.column(integerNumberColumn).id(),
    ledgerId: field.column(integerNumberColumn).column('ledger_id'),
    amount: field.column(integerBigIntColumn),
  },
}).sql({ table: 'wide_entries' });

const Ledger = model('Ledger', {
  fields: { id: field.column(integerNumberColumn).id() },
  relations: { entries: rel.hasMany(() => Entry, { by: 'ledgerId' }) },
}).sql({ table: 'wide_ledgers' });

const contract = defineContract({ models: { Ledger, Entry } });
const stack = createSqlExecutionStack({
  target: sqliteTarget,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
});
const context = createExecutionContext({ contract, stack });

describe('a SQLite BigInt column holding integers past the safe range', () => {
  let directory: string | undefined;
  let path: string | undefined;
  let runtime: SqliteRuntimeImpl | undefined;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-wide-integers-'));
    path = join(directory, 'test.db');
    const database = new DatabaseSync(path);
    database.exec(`
      create table wide_ledgers (id integer primary key);
      create table wide_entries (
        id integer primary key,
        ledger_id integer not null,
        amount integer not null
      );
      insert into wide_ledgers (id) values (1), (2);
    `);
    database.close();
    const instance = instantiateExecutionStack(stack);
    if (instance.adapter === undefined || instance.driver === undefined) {
      throw new InternalError('SQLite execution stack is missing its adapter or driver');
    }
    await instance.driver.connect({ kind: 'path', path });
    runtime = new SqliteRuntimeImpl({
      context,
      adapter: instance.adapter,
      driver: instance.driver,
    });
  });

  afterAll(async () => {
    await runtime?.close();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  });

  function collections() {
    const namespace = { namespaceId: soleDomainNamespaceId(contract.domain) };
    return {
      ledgers: new Collection({ runtime: runtime!, context }, 'Ledger', namespace),
      entries: new Collection({ runtime: runtime!, context }, 'Entry', namespace),
    };
  }

  it('writes and reads them back exactly through create, a read, a filter and an include', async () => {
    const { entries, ledgers } = collections();
    const created = [
      await entries.create({ id: 1, ledgerId: 1, amount: WIDE }),
      await entries.create({ id: 2, ledgerId: 1, amount: MAX_INT64 }),
      await entries.create({ id: 3, ledgerId: 1, amount: MIN_INT64 }),
    ];
    const read = await entries
      .select('id', 'amount')
      .orderBy((entry) => entry['id']!.asc())
      .all();
    const filtered = await entries
      .where((entry) => entry['amount']!.eq(WIDE))
      .select('id', 'amount')
      .all();
    const included = await ledgers
      .where((ledger) => ledger['id']!.eq(1))
      .select('id')
      .include('entries', (entry) => entry.select('id', 'amount').orderBy((e) => e['id']!.asc()))
      .all();

    const stored = [
      { id: 1, amount: WIDE },
      { id: 2, amount: MAX_INT64 },
      { id: 3, amount: MIN_INT64 },
    ];
    expect({ created, read, filtered, included }).toEqual({
      created: stored.map((row) => ({ ...row, ledgerId: 1 })),
      read: stored,
      filtered: [{ id: 1, amount: WIDE }],
      included: [{ id: 1, entries: stored }],
    });
  });

  it('sums and finds the greatest exactly', async () => {
    const { entries } = collections();
    await entries.create({ id: 10, ledgerId: 2, amount: WIDE });
    await entries.create({ id: 11, ledgerId: 2, amount: WIDE });

    const aggregates = await entries
      .where((entry) => entry['ledgerId']!.eq(2))
      .aggregate((aggregate) => ({
        total: aggregate.sumBigInt('amount'),
        greatest: aggregate.max('amount'),
      }));

    expect(aggregates).toEqual({ total: 2n * WIDE, greatest: WIDE });
  });

  describe.each([
    ['2^63', 2n ** 63n],
    ['2^64', 2n ** 64n],
    ['-(2^63) - 1', -(2n ** 63n) - 1n],
  ])('a value past the 64-bit range, %s', (_name, value) => {
    const refusal = {
      code: 'RUNTIME.ENCODE_FAILED',
      message: `sqlite/bigint@1 value must be an integer from -9223372036854775808 to 9223372036854775807, which SQLite stores, got ${value}`,
      meta: { codecId: 'sqlite/bigint@1', received: String(value) },
    };

    it('is refused by create', async () => {
      await expect(
        collections().entries.create({ id: 20, ledgerId: 2, amount: value }),
      ).rejects.toMatchObject(refusal);
    });

    it('is refused by update', async () => {
      const { entries } = collections();
      await entries.create({ id: 21, ledgerId: 2, amount: 1n });
      await expect(
        entries.where((entry) => entry['id']!.eq(21)).update({ amount: value }),
      ).rejects.toMatchObject(refusal);
      await entries.where((entry) => entry['id']!.eq(21)).delete();
    });

    it('is refused by a filter', async () => {
      await expect(
        collections()
          .entries.where((entry) => entry['amount']!.eq(value))
          .all(),
      ).rejects.toMatchObject(refusal);
    });
  });

  it('leaves no lock behind, so another connection can write after the read', async () => {
    await collections().entries.select('id', 'amount').all();
    const other = new DatabaseSync(path!);
    try {
      other.exec('PRAGMA busy_timeout = 0');
      expect(() => other.exec('insert into wide_ledgers (id) values (3)')).not.toThrow();
    } finally {
      other.close();
    }
  });
});
