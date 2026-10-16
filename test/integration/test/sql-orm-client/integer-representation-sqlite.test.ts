import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { orm } from '@internal/sql-orm-client';
import type { SqliteClient } from '@internal/sqlite/runtime';
import sqlite from '@internal/sqlite/runtime';
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { rejectionShape } from './error-shape';
import type { Contract } from './fixtures/integer-representation-sqlite/generated/contract';
import contractJson from './fixtures/integer-representation-sqlite/generated/contract.json' with {
  type: 'json',
};

/**
 * End-to-end proof of the `BigIntNumber` type on SQLite, driven through the
 * real emitted fixture (`fixtures/integer-representation-sqlite/generated/`):
 * `Meter.peak` and `Sample.reading` are `sqlite/bigintnumber@1` — INTEGER
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
        reading integer not null
      );
    `);

    client = sqlite<Contract>({ contractJson, path, verifyMarker: false });
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
      },
    });
  });

  afterAll(async () => {
    await client?.close();
    database?.close();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  });

  it('writes and reads BigIntNumber at both safe-range boundaries', async () => {
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

  it('carries a BigIntNumber column through an include at the safe-range boundary', async () => {
    const samples = db![UNBOUND_NAMESPACE_ID].Sample;
    await samples.create({ id: 1, meterId: 1, reading: MAX_SAFE });
    await samples.create({ id: 2, meterId: 1, reading: -MAX_SAFE });

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
      `insert into int_repr_samples (id, meter_id, reading) values (10, 1, ${FIRST_UNSAFE})`,
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
      message: `Failed to decode column int_repr_samples.reading with codec 'sqlite/bigintnumber@1': sqlite/bigintnumber@1 value must be an integer within the safe integer range, got ${FIRST_UNSAFE}`,
      code: 'RUNTIME.DECODE_FAILED',
      category: 'RUNTIME',
      severity: 'error',
      details: {
        table: 'int_repr_samples',
        column: 'reading',
        codec: 'sqlite/bigintnumber@1',
      },
      cause: {
        name: 'StructuredError',
        message: `sqlite/bigintnumber@1 value must be an integer within the safe integer range, got ${FIRST_UNSAFE}`,
        code: 'RUNTIME.DECODE_FAILED',
        meta: { codecId: 'sqlite/bigintnumber@1', received: String(FIRST_UNSAFE) },
      },
    });

    database!.exec('delete from int_repr_samples where id = 10');
  });

  it('writing past the safe range through BigIntNumber raises RUNTIME.ENCODE_FAILED', async () => {
    const shape = await rejectionShape(
      db![UNBOUND_NAMESPACE_ID].Meter.create({ id: 20, peak: FIRST_UNSAFE }),
    );
    expect(shape).toEqual({
      name: 'StructuredError',
      message: `sqlite/bigintnumber@1 value must be an integer within the safe integer range, got ${FIRST_UNSAFE}`,
      code: 'RUNTIME.ENCODE_FAILED',
      meta: { codecId: 'sqlite/bigintnumber@1', received: String(FIRST_UNSAFE) },
    });
  });

  it('writing a non-integral number through BigIntNumber raises RUNTIME.ENCODE_FAILED', async () => {
    const shape = await rejectionShape(
      db![UNBOUND_NAMESPACE_ID].Meter.create({ id: 21, peak: 1.5 }),
    );
    expect(shape).toEqual({
      name: 'StructuredError',
      message:
        'sqlite/bigintnumber@1 value must be an integer within the safe integer range, got 1.5',
      code: 'RUNTIME.ENCODE_FAILED',
      meta: { codecId: 'sqlite/bigintnumber@1', received: '1.5' },
    });
  });
});
