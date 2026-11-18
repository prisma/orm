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
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { rejectionShape } from './error-shape';
import type { Contract } from './fixtures/integer-representation-sqlite/generated/contract';
import contractJson from './fixtures/integer-representation-sqlite/generated/contract.json' with {
  type: 'json',
};

/**
 * End-to-end proof of the `BigInt(as: number)` type on SQLite, driven through the
 * real emitted fixture (`fixtures/integer-representation-sqlite/generated/`):
 * `Meter.peak` and `Sample.reading` are `sqlite/integer@1` — INTEGER
 * storage read as a JS number. Boundary values only — a value inside the safe
 * range proves nothing about the guard.
 *
 * The decode guard is proven through an include: the nested-document path
 * carries the column as a canonical JSON number, which is where a stored
 * out-of-range INTEGER reaches the codec (a flat read of such a value is
 * refused by `node:sqlite` before any codec runs).
 */

/** 2^53 − 1, the largest integer a JS number holds exactly. */
const MAX_SAFE = 9007199254740991;
/** 2^53, the first integer past the safe range on either side. */
const FIRST_UNSAFE = 9007199254740992;

describe('integration/integer representation type on sqlite', () => {
  let directory: string | undefined;
  let database: DatabaseSync | undefined;
  let client: SqliteClient<Contract> | undefined;
  let db: ReturnType<typeof orm<Contract>> | undefined;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-int-repr-'));
    const path = join(directory, 'test.db');
    database = new DatabaseSync(path);
    database.exec(`
      create table int_repr_meters (
        id integer primary key,
        peak integer not null
      );
      create table int_repr_samples (
        id integer primary key,
        meter_id integer not null references int_repr_meters(id),
        reading integer not null,
        rank integer not null
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

  it('writes and reads BigInt(as: number) at both safe-range boundaries', async () => {
    const meters = db![UNBOUND_NAMESPACE_ID].Meter;
    await meters.create({ id: 1, peak: MAX_SAFE });
    await meters.create({ id: 2, peak: -MAX_SAFE });

    const rows = await meters
      .select('id', 'peak')
      .orderBy((meter) => meter.id.asc())
      .all();

    expect(rows).toEqual([
      { id: 1, peak: MAX_SAFE },
      { id: 2, peak: -MAX_SAFE },
    ]);

    type Row = (typeof rows)[number];
    expectTypeOf<Row['peak']>().toEqualTypeOf<number>();
  });

  it('carries a BigInt(as: number) column through an include at the safe-range boundary', async () => {
    const samples = db![UNBOUND_NAMESPACE_ID].Sample;
    await samples.create({ id: 1, meterId: 1, reading: MAX_SAFE, rank: 1 });
    await samples.create({ id: 2, meterId: 1, reading: -MAX_SAFE, rank: 2 });

    const rows = await db![UNBOUND_NAMESPACE_ID].Meter.select('id')
      .where((meter) => meter.id.eq(1))
      .include('samples', (sample) => sample.select('id', 'reading').orderBy((s) => s.id.asc()))
      .all();

    expect(rows).toEqual([
      {
        id: 1,
        samples: [
          { id: 1, reading: MAX_SAFE },
          { id: 2, reading: -MAX_SAFE },
        ],
      },
    ]);
  });

  it('reading a stored value past the safe range through an include raises RUNTIME.DECODE_FAILED', async () => {
    // Out of band on purpose: the encode guard refuses to write this value,
    // so only raw SQL can arrange the stored state the decode guard exists
    // for.
    database!.exec(
      `insert into int_repr_samples (id, meter_id, reading, rank) values (10, 1, ${FIRST_UNSAFE}, 0)`,
    );

    const shape = await rejectionShape(
      db![UNBOUND_NAMESPACE_ID].Meter.select('id')
        .where((meter) => meter.id.eq(1))
        .include('samples', (sample) => sample.select('id', 'reading'))
        .all(),
    );
    // The include decode wraps the codec's structured error in the
    // runtime's column-context envelope, with the codec error on `cause`.
    expect(shape).toEqual({
      name: 'RuntimeError',
      message: `Failed to decode column int_repr_samples.reading with codec 'sqlite/integer@1': Column "int_repr_samples"."reading" holds "${FIRST_UNSAFE}", which is not an integer within the safe integer range. sqlite/integer@1 reads integers from -9007199254740991 to 9007199254740991.`,
      code: 'RUNTIME.DECODE_FAILED',
      category: 'RUNTIME',
      severity: 'error',
      details: {
        table: 'int_repr_samples',
        column: 'reading',
        codec: 'sqlite/integer@1',
      },
      cause: {
        name: 'StructuredError',
        message: `Column "int_repr_samples"."reading" holds "${FIRST_UNSAFE}", which is not an integer within the safe integer range. sqlite/integer@1 reads integers from -9007199254740991 to 9007199254740991.`,
        code: 'RUNTIME.DECODE_FAILED',
        meta: {
          codecId: 'sqlite/integer@1',
          table: 'int_repr_samples',
          column: 'reading',
          received: String(FIRST_UNSAFE),
        },
      },
    });

    database!.exec('delete from int_repr_samples where id = 10');
  });

  it('writing past the safe range through BigInt(as: number) raises RUNTIME.ENCODE_FAILED', async () => {
    const shape = await rejectionShape(
      db![UNBOUND_NAMESPACE_ID].Meter.create({ id: 20, peak: FIRST_UNSAFE }),
    );
    expect(shape).toEqual({
      name: 'StructuredError',
      message: `sqlite/integer@1 value must be an integer within the safe integer range, got ${FIRST_UNSAFE}`,
      code: 'RUNTIME.ENCODE_FAILED',
      meta: { codecId: 'sqlite/integer@1', received: String(FIRST_UNSAFE) },
    });
  });

  it('writing a non-integral number through BigInt(as: number) raises RUNTIME.ENCODE_FAILED', async () => {
    const shape = await rejectionShape(
      db![UNBOUND_NAMESPACE_ID].Meter.create({ id: 21, peak: 1.5 }),
    );
    expect(shape).toEqual({
      name: 'StructuredError',
      message: 'sqlite/integer@1 value must be an integer within the safe integer range, got 1.5',
      code: 'RUNTIME.ENCODE_FAILED',
      meta: { codecId: 'sqlite/integer@1', received: '1.5' },
    });
  });

  describe('a stored value an Int column cannot read', () => {
    const PAST_SAFE = '9007199254740993';
    const sampleRank = (id: number) =>
      db![UNBOUND_NAMESPACE_ID].Sample.select('id', 'rank')
        .where((sample) => sample.id.eq(id))
        .all();
    const includedRank = () =>
      db![UNBOUND_NAMESPACE_ID].Meter.select('id')
        .where((meter) => meter.id.eq(30))
        .include('samples', (sample) => sample.select('id', 'rank'))
        .all();

    beforeAll(() => {
      database!.exec('insert into int_repr_meters (id, peak) values (30, 0)');
    });

    afterEach(async () => {
      await db![UNBOUND_NAMESPACE_ID].Sample.where((sample) =>
        sample.meterId.eq(30),
      ).deleteAndCount();
    });

    it.each([
      ['a real', '1.5', '1.5'],
      ['a text', `'abc'`, '"abc"'],
    ])('names the table and column when the row holds %s', async (_kind, stored, shown) => {
      database!.exec(
        `insert into int_repr_samples (id, meter_id, reading, rank) values (31, 30, 0, ${stored})`,
      );
      const received = shown.replaceAll('"', '');

      expect({
        topLevel: await rejectionShape(sampleRank(31)),
        include: await rejectionShape(includedRank()),
      }).toEqual({
        topLevel: {
          name: 'StructuredError',
          message: `Column "int_repr_samples"."rank" holds ${shown}, which is not an integer within the safe integer range. sqlite/integer@1 reads integers from -9007199254740991 to 9007199254740991.`,
          code: 'RUNTIME.DECODE_FAILED',
          meta: {
            codecId: 'sqlite/integer@1',
            table: 'int_repr_samples',
            column: 'rank',
            received,
          },
        },
        include: {
          name: 'RuntimeError',
          message: `Failed to decode column int_repr_samples.rank with codec 'sqlite/integer@1': Column "int_repr_samples"."rank" holds "${received}", which is not an integer within the safe integer range. sqlite/integer@1 reads integers from -9007199254740991 to 9007199254740991.`,
          code: 'RUNTIME.DECODE_FAILED',
          category: 'RUNTIME',
          severity: 'error',
          details: { table: 'int_repr_samples', column: 'rank', codec: 'sqlite/integer@1' },
          cause: {
            name: 'StructuredError',
            message: `Column "int_repr_samples"."rank" holds "${received}", which is not an integer within the safe integer range. sqlite/integer@1 reads integers from -9007199254740991 to 9007199254740991.`,
            code: 'RUNTIME.DECODE_FAILED',
            meta: {
              codecId: 'sqlite/integer@1',
              table: 'int_repr_samples',
              column: 'rank',
              received,
            },
          },
        },
      });
    });

    it('an integer past the safe range fails in node:sqlite, naming no column, at the top level, and in the codec through an include', async () => {
      database!.exec(
        `insert into int_repr_samples (id, meter_id, reading, rank) values (32, 30, 0, ${PAST_SAFE})`,
      );

      expect({
        topLevel: await rejectionShape(sampleRank(32)),
        include: await rejectionShape(includedRank()),
      }).toEqual({
        topLevel: {
          name: 'RangeError',
          message: `Value is too large to be represented as a JavaScript number: ${PAST_SAFE}`,
          code: 'ERR_OUT_OF_RANGE',
        },
        include: {
          name: 'RuntimeError',
          message: `Failed to decode column int_repr_samples.rank with codec 'sqlite/integer@1': Column "int_repr_samples"."rank" holds "${PAST_SAFE}", which is not an integer within the safe integer range. sqlite/integer@1 reads integers from -9007199254740991 to 9007199254740991.`,
          code: 'RUNTIME.DECODE_FAILED',
          category: 'RUNTIME',
          severity: 'error',
          details: { table: 'int_repr_samples', column: 'rank', codec: 'sqlite/integer@1' },
          cause: {
            name: 'StructuredError',
            message: `Column "int_repr_samples"."rank" holds "${PAST_SAFE}", which is not an integer within the safe integer range. sqlite/integer@1 reads integers from -9007199254740991 to 9007199254740991.`,
            code: 'RUNTIME.DECODE_FAILED',
            meta: {
              codecId: 'sqlite/integer@1',
              table: 'int_repr_samples',
              column: 'rank',
              received: PAST_SAFE,
            },
          },
        },
      });
    });
  });
});
