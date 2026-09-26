import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqliteBigintDescriptor, sqliteDatetimeDescriptor } from '../src/core/codecs';
import { buildColumnDefaultSql } from '../src/core/migrations/planner-ddl-builders';

describe('SQLite codec JSON representations', () => {
  const bigintCodec = sqliteBigintDescriptor.factory()({ name: 'test' });

  it('uses decimal text for bigint values, so the int64 range survives', () => {
    expect(bigintCodec.encodeJson(42n)).toBe('42');
    expect(bigintCodec.decodeJson('42')).toBe(42n);
    expect(bigintCodec.encodeJson(9223372036854775807n)).toBe('9223372036854775807');
    expect(bigintCodec.decodeJson('9223372036854775807')).toBe(9223372036854775807n);
  });

  it('rejects a JSON number, which has already lost digits', () => {
    expect(() => bigintCodec.decodeJson(42)).toThrow(
      'sqlite/bigint@1 database JSON value must be a decimal string',
    );
  });

  it('decodes number, bigint, and decimal-text wires to the same bigint', async () => {
    expect(await bigintCodec.decode(42, {})).toBe(42n);
    expect(await bigintCodec.decode(42n, {})).toBe(42n);
    expect(await bigintCodec.decode('9223372036854775807', {})).toBe(9223372036854775807n);
    expect(await bigintCodec.decode('-42', {})).toBe(-42n);
  });

  it('rejects a malformed string wire with a structured decode error', async () => {
    await expect(bigintCodec.decode('not-a-number', {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: 'sqlite/bigint@1 wire value must be a decimal string',
      meta: { codecId: 'sqlite/bigint@1' },
    });
  });
});

describe('SQLite datetime codec', () => {
  const datetimeCodec = sqliteDatetimeDescriptor.factory()({ name: 'test' });
  const originalTimeZone = process.env['TZ'];

  beforeAll(() => {
    process.env['TZ'] = 'America/New_York';
  });

  afterAll(() => {
    if (originalTimeZone === undefined) {
      delete process.env['TZ'];
    } else {
      process.env['TZ'] = originalTimeZone;
    }
  });

  it('reads the UTC text a now() default writes as UTC, whatever the process time zone', async () => {
    const db = new DatabaseSync(':memory:');
    const nowDefault = buildColumnDefaultSql({ kind: 'function', expression: 'now()' });
    db.exec(`CREATE TABLE post (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL ${nowDefault})`);
    db.exec('INSERT INTO post (id) VALUES (1)');
    const row = db
      .prepare('SELECT created_at, unixepoch(created_at) AS epoch FROM post WHERE id = 1')
      .get() as { created_at: string; epoch: number };
    db.close();

    const decoded = await datetimeCodec.decode(row.created_at, {});

    expect(decoded.getTime()).toBe(row.epoch * 1000);
  });

  it('decodes SQLite datetime text, with or without fractional seconds, as UTC', async () => {
    expect(await datetimeCodec.decode('2026-07-23 12:34:56', {})).toEqual(
      new Date('2026-07-23T12:34:56Z'),
    );
    expect(await datetimeCodec.decode('2026-07-23 12:34:56.789', {})).toEqual(
      new Date('2026-07-23T12:34:56.789Z'),
    );
    expect(datetimeCodec.decodeJson('2026-07-23 12:34:56')).toEqual(
      new Date('2026-07-23T12:34:56Z'),
    );
  });

  it('keeps decoding ISO-8601 text with a designator unchanged', async () => {
    expect(await datetimeCodec.decode('2026-07-23T12:34:56.789Z', {})).toEqual(
      new Date('2026-07-23T12:34:56.789Z'),
    );
    expect(await datetimeCodec.decode('2026-07-23T14:34:56+02:00', {})).toEqual(
      new Date('2026-07-23T12:34:56Z'),
    );
  });
});
