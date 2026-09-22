import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  bigintColumn,
  blobColumn,
  integerColumn,
  jsonColumn,
  textColumn,
} from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import { soleDomainNamespaceId } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { type AggregateSpec, Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { defineContract, field, model, rel } from '@internal/sqlite/contract-builder';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rejectionShape } from './error-shape';

/**
 * SQLite's side of the cut, through a real ORM include.
 *
 * The include nests the child row set through a derived table, which is where
 * SQLite drops the JSON subtype — so this is the shape that exercises the retag,
 * rather than a flat projection over a base table.
 */

/** Past 2^53, where a JSON number stops carrying an int64. */
const WIDE_BIGINT = 9007199254740993n;
/** 80 bytes, and letter-bearing hex, since `hex()` emits uppercase. */
const WIDE_BLOB = Uint8Array.from({ length: 80 }, (_, index) => (index * 7) % 256);
/**
 * A document, and a text value whose characters happen to look like one. The
 * pair separates retagging by codec identity from retagging by content: only
 * the first is a `sqlite/json@1` column, so only the first may come back as a
 * parsed object.
 */
const DOCUMENT = { nested: { list: [1, 2, 3] }, flag: true };
const STRING_CONTAINING_JSON = '{"not":"a document"}';

const Reading = model('Reading', {
  fields: {
    id: field.column(integerColumn).id(),
    counter: field.column(bigintColumn).optional(),
    payload: field.column(blobColumn).optional(),
    document: field.column(jsonColumn).optional(),
    label: field.column(textColumn).optional(),
  },
}).sql({ table: 'canon_readings' });

const Station = model('Station', {
  fields: {
    id: field.column(integerColumn).id(),
    readingId: field.column(integerColumn).column('reading_id'),
    // A per-station tally past a double's integers, so an aggregate over it has
    // something to lose.
    weight: field.column(bigintColumn).optional(),
  },
  relations: {
    reading: rel.belongsTo(Reading, { from: 'readingId', to: 'id' }).sql({ fk: {} }),
  },
}).sql({ table: 'canon_stations' });

const ReadingWithStations = Reading.relations({
  stations: rel.hasMany(() => Station, { by: 'readingId' }),
}).sql({ table: 'canon_readings' });

const contract = defineContract({ models: { Reading: ReadingWithStations, Station } });

describe('integration/sqlite include canonical JSON', () => {
  let directory: string | undefined;
  let database: DatabaseSync | undefined;
  let runtime: SqliteRuntimeImpl | undefined;
  let stations: Collection<typeof contract, 'Station'> | undefined;
  let readings: Collection<typeof contract, 'Reading'> | undefined;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-canonical-'));
    const path = join(directory, 'test.db');
    database = new DatabaseSync(path);
    database.exec(`
      create table canon_readings (
        id integer primary key,
        counter text,
        payload blob,
        document text,
        label text
      );
      create table canon_stations (
        id integer primary key,
        reading_id integer not null,
        weight text
      );
    `);

    const stack = createSqlExecutionStack({
      target: sqliteTarget,
      adapter: sqliteAdapter,
      driver: sqliteDriver,
    });
    const context = createExecutionContext({ contract, stack });
    const instance = instantiateExecutionStack(stack);
    const adapter = instance.adapter;
    const driver = instance.driver;
    if (adapter === undefined || driver === undefined) {
      throw new InternalError('SQLite execution stack is missing its adapter or driver');
    }
    await driver.connect({ kind: 'path', path });
    runtime = new SqliteRuntimeImpl({ context, adapter, driver });
    // SQLite has no schema namespaces, so the contract builder leaves models in
    // the unbound namespace rather than `public`.
    stations = new Collection({ runtime, context }, 'Station', {
      namespaceId: soleDomainNamespaceId(contract.domain),
    });
    readings = new Collection({ runtime, context }, 'Reading', {
      namespaceId: soleDomainNamespaceId(contract.domain),
    });
  });

  afterAll(async () => {
    await runtime?.close();
    database?.close();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  });

  function seed(id: number, values: Record<string, unknown>): void {
    const columns = Object.keys(values);
    database!
      .prepare(
        `insert into canon_readings (id${columns.map((c) => `, ${c}`).join('')}) values (?${columns.map(() => ', ?').join('')})`,
      )
      .run(id, ...(Object.values(values) as Array<string | number | null | Uint8Array>));
    database!.prepare('insert into canon_stations (id, reading_id) values (?, ?)').run(id, id);
  }

  function seedStation(id: number, readingId: number, weight: string): void {
    database!
      .prepare('insert into canon_stations (id, reading_id, weight) values (?, ?, ?)')
      .run(id, readingId, weight);
  }

  it('carries a bigint, a blob and a document through an include exactly', async () => {
    seed(1, {
      counter: WIDE_BIGINT.toString(),
      payload: WIDE_BLOB,
      document: JSON.stringify(DOCUMENT),
      label: 'present',
    });

    const rows = await stations!
      .select('id')
      .include('reading', (reading) => reading.select('counter', 'payload', 'document', 'label'))
      .all();

    expect(rows).toEqual([
      {
        id: 1,
        reading: {
          counter: WIDE_BIGINT,
          payload: WIDE_BLOB,
          document: DOCUMENT,
          label: 'present',
        },
      },
    ]);
  });

  // A document and a text value spelled the same way must not converge. The
  // retag reaches the document column because that column's codec is
  // `sqlite/json@1`, not because its stored characters look like JSON — so a
  // `sqlite/text@1` column holding those same characters stays a string. Were
  // the retag driven by content instead, both would parse and the two columns
  // would become indistinguishable.
  it('keeps a document apart from a string that merely contains JSON', async () => {
    seed(2, { document: JSON.stringify(DOCUMENT), label: STRING_CONTAINING_JSON });

    const rows = await stations!
      .select('id')
      .include('reading', (reading) => reading.select('document', 'label'))
      .all();

    expect(rows).toEqual([
      { id: 1, reading: { document: DOCUMENT, label: 'present' } },
      { id: 2, reading: { document: DOCUMENT, label: STRING_CONTAINING_JSON } },
    ]);
  });

  it('carries a NULL through as null, for every codec that projects', async () => {
    seed(3, { label: null });

    const rows = await stations!
      .select('id')
      .include('reading', (reading) => reading.select('counter', 'payload', 'document', 'label'))
      .all();

    expect(rows[2]).toEqual({
      id: 3,
      reading: { counter: null, payload: null, document: null, label: null },
    });
  });

  // An empty blob and an absent one both hex to `''`, and `decodeJson` accepts
  // `''` as a valid zero-length blob — so this is the pair the NULL guard on the
  // hex projection exists to keep apart, asserted where a user would see it.
  it('keeps an empty blob apart from an absent one', async () => {
    seed(4, { payload: new Uint8Array() });

    const rows = await stations!
      .select('id')
      .include('reading', (reading) => reading.select('payload'))
      .all();

    expect(rows.map((row) => row.reading)).toEqual([
      { payload: WIDE_BLOB },
      { payload: null },
      { payload: null },
      { payload: new Uint8Array() },
    ]);
  });

  // SQLite's canonical JSON renders a bigint as text, which is what lets an
  // aggregate past 2^53 leave the database intact: the include's envelope
  // carries '9007199254740993', and the codec reads it back as the integer it
  // is rather than the double it would have become.
  it('carries an include aggregate past 2^53 through the JSON envelope', async () => {
    seedStation(100, 1, WIDE_BIGINT.toString());

    // Same cardinality-inference gap as the PostgreSQL suite: the reducers are
    // typed away on a contract declared in this file, though the relation is
    // to-many and the shape below is what the query returns.
    const reduceToMax = (related: unknown): unknown =>
      (related as { max: (field: string) => unknown }).max('weight');
    const withStations = await readings!
      .where((reading) => reading.id.eq(1))
      .select('id')
      .include('stations', (related) => reduceToMax(related) as never)
      .all();

    expect(withStations).toEqual([{ id: 1, stations: WIDE_BIGINT }]);
    expect(BigInt(Number(WIDE_BIGINT))).not.toBe(WIDE_BIGINT);
  });

  // `count` and `sum` over integers answer as JS numbers, and a JSON number is
  // the one canonical form SQLite's JSON constructor does not reach on its own
  // here: the rows lower through a cast to text, so the driver never reads a
  // wide integer, and the codec's projection is what puts the value back into
  // JSON as a number.
  it('carries include count and sum reducers as JS numbers', async () => {
    database!.prepare('insert into canon_readings (id) values (?)').run(200);
    seedStation(200, 200, '3');
    seedStation(201, 200, '4');

    const reduceToTotals = (related: unknown): unknown => {
      const reducers = related as {
        combine: (branches: Record<string, unknown>) => unknown;
        count: () => unknown;
        sum: (column: string) => unknown;
      };
      return reducers.combine({ tally: reducers.count(), weight: reducers.sum('weight') });
    };
    const rows = await readings!
      .where((reading) => reading.id.eq(200))
      .select('id')
      .include('stations', (related) => reduceToTotals(related) as never)
      .all();

    expect(rows).toEqual([{ id: 200, stations: { tally: 2, weight: 7 } }]);
  });

  // The sum is carried as the digit text `sqlite/bigint` stores, so the exact
  // total reaches the codec and the codec refuses it: a number-valued codec
  // produces a JavaScript number, and this total is past what one holds.
  it('refuses an include sum past 2^53 rather than answering with a rounded total', async () => {
    database!.prepare('insert into canon_readings (id) values (?)').run(300);
    seedStation(300, 300, WIDE_BIGINT.toString());
    seedStation(301, 300, '2');

    const reduceToSum = (related: unknown): unknown =>
      (related as { sum: (column: string) => unknown }).sum('weight');
    const shape = await rejectionShape(
      readings!
        .where((reading) => reading.id.eq(300))
        .select('id')
        .include('stations', (related) => reduceToSum(related) as never)
        .all(),
    );

    const exactTotal = (WIDE_BIGINT + 2n).toString();
    expect(shape).toEqual({
      name: 'RuntimeError',
      message: `Failed to decode column canon_stations.stations with codec 'sqlite/bigintnumber@1': sqlite/bigintnumber@1 value must be an integer within the safe integer range, got ${exactTotal}`,
      code: 'RUNTIME.DECODE_FAILED',
      category: 'RUNTIME',
      severity: 'error',
      details: { table: 'canon_stations', column: 'stations', codec: 'sqlite/bigintnumber@1' },
      cause: {
        name: 'StructuredError',
        message: `sqlite/bigintnumber@1 value must be an integer within the safe integer range, got ${exactTotal}`,
        code: 'RUNTIME.DECODE_FAILED',
        meta: { codecId: 'sqlite/bigintnumber@1', received: exactTotal },
      },
    });
  });

  // A sum is a value SQLite computes, so it leaves the database as an INTEGER
  // rather than the text a bigint column stores — and `node:sqlite` refuses an
  // integer a JS number cannot hold. The target's descriptor answers with the
  // cast that makes the wire form text, which is what the bigint codec reads.
  it('carries a top-level sumBigInt past 2^53 through the ORM', async () => {
    // The contract is authored in this file, so its static aggregate map is
    // unknown and the typed builder surface is empty; dispatch dynamically,
    // as the include reducer above already does.
    const stats = await readings!.aggregate((aggregate) => {
      const dynamic = aggregate as Record<string, (field?: string) => AggregateSpec[string]>;
      return { total: dynamic['sumBigInt']!('counter') };
    });

    expect(stats).toEqual({ total: WIDE_BIGINT });
    expect(BigInt(Number(stats.total))).not.toBe(stats.total);
  });

  // The bare operation reads the same total as a `number`, and the same cast to
  // text is what lets the codec's guard — rather than the driver's raise — be
  // the answer a caller reads.
  it('refuses a top-level bare sum past 2^53 rather than rounding it', async () => {
    const shape = await rejectionShape(
      readings!.aggregate((aggregate) => {
        const dynamic = aggregate as Record<string, (field?: string) => AggregateSpec[string]>;
        return { total: dynamic['sum']!('counter') };
      }),
    );

    expect(shape).toEqual({
      name: 'StructuredError',
      message: `sqlite/bigintnumber@1 value must be an integer within the safe integer range, got ${WIDE_BIGINT}`,
      code: 'RUNTIME.DECODE_FAILED',
      meta: { codecId: 'sqlite/bigintnumber@1', received: WIDE_BIGINT.toString() },
    });
  });
});
