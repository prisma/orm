import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { sqliteBooleanColumn, sqliteBooleanDescriptor } from '../src/core/boolean-codec';
import { sqliteBoolean, sqliteInteger } from '../src/core/data-types';
import { fromContractJson, toContractJson } from './contract-json';

const instanceCtx: CodecInstanceContext = { name: 'test' };
const codec = sqliteBooleanDescriptor.factory()(instanceCtx);

const notBoolean = (value: unknown): never => value as never;

describe('sqlite/boolean', () => {
  it('is stored as an integer, and reads a boolean from a contract', () => {
    expect(sqliteBoolean.sql.storedAs).toBe(sqliteInteger.id);
    expect({
      true: sqliteBoolean.toContract(sqliteBoolean.fromContract(true, {})),
      false: sqliteBoolean.toContract(sqliteBoolean.fromContract(false, {})),
    }).toEqual({ true: true, false: false });
  });

  it.each([1, 0, '1', 'true'])('reads no boolean from the contract value %j', (json) => {
    expect(() => sqliteBoolean.fromContract(json, {})).toThrow(
      expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' }),
    );
  });

  it('takes a value of no other type', () => {
    expect(sqliteBoolean.casts).toEqual({});
  });
});

describe('sqlite/boolean@1', () => {
  it('compares by equality, on an integer column read as a boolean', () => {
    expect({
      dataType: sqliteBooleanDescriptor.dataType,
      traits: sqliteBooleanDescriptor.traits,
      jsonType: sqliteBooleanDescriptor.jsonType,
    }).toEqual({
      dataType: 'sqlite/boolean',
      traits: ['equality', 'boolean'],
      jsonType: 'boolean',
    });
  });

  it('writes 1 for true and 0 for false, because node:sqlite binds no boolean', async () => {
    expect({
      true: await codec.toWire(true, {}),
      false: await codec.toWire(false, {}),
    }).toEqual({ true: 1, false: 0 });
  });

  it.each([1, 0, 'true', null])('refuses to write %j, which is not a boolean', async (value) => {
    await expect(codec.toWire(notBoolean(value), {})).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: `sqlite/boolean@1 value must be a boolean, got ${JSON.stringify(value)}`,
      meta: { codecId: 'sqlite/boolean@1', received: String(value) },
    });
  });

  it.each([
    [0, false],
    [1, true],
    [0n, false],
    [1n, true],
    ['0', false],
    ['1', true],
  ])('reads %o as %s', async (wire, value) => {
    expect(await codec.fromWire(notBoolean(wire), {})).toBe(value);
  });

  it.each([
    [2, '2'],
    [-1, '-1'],
    [2n, '2'],
    ['yes', '"yes"'],
    ['', '""'],
  ])('raises a decode error naming the column for the stored value %o', async (wire, shown) => {
    await expect(
      codec.fromWire(notBoolean(wire), { column: { table: 'user', name: 'active' } }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: `Column "user"."active" holds ${shown}, which is not 0 or 1. sqlite/boolean@1 reads 0 as false and 1 as true.`,
      meta: {
        codecId: 'sqlite/boolean@1',
        table: 'user',
        column: 'active',
        received: String(wire),
      },
    });
  });

  it.each([
    ['one byte a row carries', new Uint8Array([0x01]), '01'],
    ['the hex text of bytes an include carries', ['01'], '01'],
  ])('raises a decode error naming the column for %s', async (_name, wire, hex) => {
    await expect(
      codec.fromWire(notBoolean(wire), { column: { table: 'user', name: 'active' } }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: `Column "user"."active" holds bytes x'${hex}', which is not 0 or 1. sqlite/boolean@1 reads 0 as false and 1 as true.`,
      meta: { codecId: 'sqlite/boolean@1', table: 'user', column: 'active', received: `x'${hex}'` },
    });
  });

  it('raises a decode error for a stored value it cannot read where no column is known', async () => {
    await expect(codec.fromWire(notBoolean(2), {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message:
        'A sqlite/boolean@1 value is 2, which is not 0 or 1. sqlite/boolean@1 reads 0 as false and 1 as true.',
      meta: { codecId: 'sqlite/boolean@1', received: '2' },
    });
  });

  it('round-trips its contract form', () => {
    expect({
      true: toContractJson(codec, true),
      false: toContractJson(codec, false),
      read: fromContractJson(codec, true),
    }).toEqual({ true: true, false: false, read: true });
    expect(() => toContractJson(codec, notBoolean(1))).toThrow(
      expect.objectContaining({ code: 'RUNTIME.ENCODE_FAILED' }),
    );
  });

  it('renders a value literal as a boolean', () => {
    expect(sqliteBooleanDescriptor.renderValueLiteral(true)).toBe('true');
  });

  it('has a column helper on its codec', () => {
    expect(sqliteBooleanColumn()).toMatchObject({ codecId: 'sqlite/boolean@1' });
  });
});
