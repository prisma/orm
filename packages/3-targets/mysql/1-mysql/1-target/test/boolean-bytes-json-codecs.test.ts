import type { JsonValue } from '@internal/contract/types';
import type { DataTypeValue } from '@internal/framework-components/codec';
import { CastExpr, ColumnRef, FunctionCallExpr } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { mysqlBooleanDescriptor } from '../src/core/boolean-codec';
import { mysqlBoolean, mysqlJson, mysqlLongblob } from '../src/core/data-types';
import { mysqlJsonDescriptor } from '../src/core/json-codec';
import { mysqlLongblobDescriptor } from '../src/core/longblob-codec';

const instance = { name: 'test' };
const column = { table: 'Flag', name: 'on' };
const ctx = { column };
const value = <T extends JsonValue>(
  type: { valueFrom(json: never, params: object): DataTypeValue },
  json: T,
): DataTypeValue<T> => type.valueFrom(json as never, {}) as DataTypeValue<T>;

describe('mysql/boolean@1', () => {
  const codec = mysqlBooleanDescriptor.factory()(instance);

  it('reads 0 as false and 1 as true, from a row as text and from an include as a number', async () => {
    expect({
      rowFalse: await codec.fromWire('0', ctx),
      rowTrue: await codec.fromWire('1', ctx),
      includeFalse: await codec.fromWire(0, ctx),
      includeTrue: await codec.fromWire(1, ctx),
    }).toEqual({ rowFalse: false, rowTrue: true, includeFalse: false, includeTrue: true });
  });

  it.each(['2', '-1', '127', 2, -1])(
    'refuses to read the stored value %j, naming the column',
    async (stored) => {
      await expect(codec.fromWire(stored, ctx)).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        message: `Column "Flag"."on" holds ${stored}, which is not 0 or 1. mysql/boolean@1 reads 0 as false and 1 as true.`,
        meta: { codecId: 'mysql/boolean@1', table: 'Flag', column: 'on', received: String(stored) },
      });
    },
  );

  it('writes true as 1 and false as 0', async () => {
    expect([await codec.toWire(true, ctx), await codec.toWire(false, ctx)]).toEqual([1, 0]);
  });

  it.each([1, 0, 'true', null])('refuses to write %j, which is not a boolean', async (written) => {
    await expect(codec.toWire(written as never, ctx)).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: `Cannot write ${JSON.stringify(written)} to column "Flag"."on", which holds true or false, stored as 1 or 0.`,
    });
  });

  it('stores a default as the JSON boolean', () => {
    expect({
      toDataTypeValue: codec.toDataTypeValue(true),
      fromDataTypeValue: codec.fromDataTypeValue(value(mysqlBoolean, false)),
    }).toEqual({ toDataTypeValue: value(mysqlBoolean, true), fromDataTypeValue: false });
  });

  it('projects the column into an include unchanged, a JSON number the codec checks as it checks a row', () => {
    const expression = ColumnRef.of('Flag', 'on');
    expect(mysqlBooleanDescriptor.projectJson(expression, { codecId: 'mysql/boolean@1' })).toBe(
      expression,
    );
  });

  it('offers equality and marks its values as conditions', () => {
    expect(mysqlBooleanDescriptor.traits).toEqual(['equality', 'boolean']);
  });
});

/** Base64 as MySQL's TO_BASE64 writes it: a line break after every 76 characters. */
function base64AsMysqlWritesIt(bytes: Uint8Array): string {
  return (
    Buffer.from(bytes)
      .toString('base64')
      .match(/.{1,76}/g)
      ?.join('\n') ?? ''
  );
}

describe('mysql/longblob@1', () => {
  const codec = mysqlLongblobDescriptor.factory()(instance);
  const long = new Uint8Array(Array.from({ length: 300 }, (_, index) => index % 256));

  it('reads the bytes of a row as a plain Uint8Array, empty and not UTF-8 included', async () => {
    const read = await codec.fromWire(Buffer.from([0xc3, 0x28]), ctx);
    expect({
      notUtf8: read,
      constructor: read.constructor,
      empty: await codec.fromWire(new Uint8Array(), ctx),
    }).toEqual({
      notUtf8: new Uint8Array([0xc3, 0x28]),
      constructor: Uint8Array,
      empty: new Uint8Array(),
    });
  });

  it('reads the base64 text an include carries, with the line breaks TO_BASE64 writes', async () => {
    const text = base64AsMysqlWritesIt(long);
    expect(text).toContain('\n');
    expect({
      long: await codec.fromWire(text, ctx),
      empty: await codec.fromWire('', ctx),
    }).toEqual({ long, empty: new Uint8Array() });
  });

  it.each(['not base64!', 'abc'])(
    'refuses to read %j, which is not base64, naming the column',
    async (text) => {
      await expect(codec.fromWire(text, ctx)).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        meta: { codecId: 'mysql/longblob@1', table: 'Flag', column: 'on' },
      });
    },
  );

  it('writes a Uint8Array as it is, and refuses anything else', async () => {
    const bytes = new Uint8Array([0, 255]);
    expect(await codec.toWire(bytes, ctx)).toBe(bytes);
    await expect(codec.toWire('00ff' as never, ctx)).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message:
        'Cannot write "00ff" to column "Flag"."on", which holds bytes, written as a Uint8Array.',
    });
  });

  it('stores a default as upper-case hex text', () => {
    expect({
      toDataTypeValue: codec.toDataTypeValue(new Uint8Array([0, 0xab])),
      fromDataTypeValue: codec.fromDataTypeValue(value(mysqlLongblob, '00AB')),
    }).toEqual({
      toDataTypeValue: value(mysqlLongblob, '00AB'),
      fromDataTypeValue: new Uint8Array([0, 0xab]),
    });
  });

  it('projects the column into an include as TO_BASE64, which both servers write as plain base64', () => {
    const expression = ColumnRef.of('Flag', 'on');
    expect(
      mysqlLongblobDescriptor.projectJson(expression, { codecId: 'mysql/longblob@1' }),
    ).toEqual(FunctionCallExpr.of('TO_BASE64', [expression]));
  });

  it('offers equality and ordering, which both servers compare bytewise', () => {
    expect(mysqlLongblobDescriptor.traits).toEqual(['equality', 'order']);
  });
});

describe('mysql/json@1', () => {
  const codec = mysqlJsonDescriptor.factory()(instance);

  it.each([
    ['{"a": 1, "b": [true, null]}', { a: 1, b: [true, null] }],
    ['[1, "two"]', [1, 'two']],
    ['"text"', 'text'],
    ['12.5', 12.5],
    ['true', true],
    ['null', null],
  ] as const)('reads the JSON text %s as the document it holds', async (text, document) => {
    expect(await codec.fromWire(text, ctx)).toEqual(document);
  });

  it('refuses to read text that is not JSON, naming the column', async () => {
    await expect(codec.fromWire('{oops', ctx)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message:
        'Column "Flag"."on" holds "{oops", which is not JSON text. mysql/json@1 reads JSON text as the document it holds.',
    });
  });

  it.each([
    [{ a: 1 }, '{"a":1}'],
    [[1, 'two'], '[1,"two"]'],
    ['text', '"text"'],
    [0, '0'],
    [false, 'false'],
  ] as const)('writes %j as the JSON text %s', async (document, text) => {
    expect(await codec.toWire(document, ctx)).toBe(text);
  });

  it.each([
    [{ a: { b: undefined } }, 'undefined', 'a.b'],
    [{ when: new Date(0) }, 'Date', 'when'],
    [[1, Number.NaN], 'NaN', '1'],
    [{ big: 1n }, 'bigint', 'big'],
  ])('refuses to write %o, naming what is not JSON and where', async (document, received, path) => {
    await expect(codec.toWire(document as never, ctx)).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: `Cannot write ${received} at ${path} to column "Flag"."on", which holds a JSON document.`,
      meta: { codecId: 'mysql/json@1', table: 'Flag', column: 'on', valuePath: path },
    });
  });

  it('stores a default as the document itself', () => {
    expect({
      toDataTypeValue: codec.toDataTypeValue({ a: [1] }),
      fromDataTypeValue: codec.fromDataTypeValue(value(mysqlJson, { a: [1] })),
    }).toEqual({ toDataTypeValue: value(mysqlJson, { a: [1] }), fromDataTypeValue: { a: [1] } });
  });

  it('projects the column into an include as its JSON text, which the codec reads as it reads a row', () => {
    const expression = ColumnRef.of('Flag', 'on');
    expect(mysqlJsonDescriptor.projectJson(expression, { codecId: 'mysql/json@1' })).toEqual(
      CastExpr.as(expression, 'CHAR'),
    );
  });

  it('offers no equality and no ordering', () => {
    expect(mysqlJsonDescriptor.traits).toEqual([]);
  });
});
