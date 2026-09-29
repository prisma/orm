import type { JsonValue } from '@internal/contract/types';
import {
  Binary,
  BSON,
  BSONRegExp,
  BSONSymbol,
  Code,
  DBRef,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
} from 'bson';
import { describe, expect, it } from 'vitest';
import { mongoJsonCodec } from '../src/core/codecs';

function notJson(value: unknown): JsonValue {
  return value as JsonValue;
}

function wire(value: unknown): JsonValue {
  return value as JsonValue;
}

function encodeRefusal(received: string, path: string) {
  return expect.objectContaining({
    code: 'RUNTIME.ENCODE_FAILED',
    message: `mongo/json@1 value must be a JSON value; received ${received} at ${path}`,
  });
}

function decodeRefusal(type: string, path: string) {
  return expect.objectContaining({
    code: 'RUNTIME.DECODE_FAILED',
    message: `mongo/json@1 wire value contains a non-JSON BSON ${type} at ${path}`,
  });
}

class Point {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
}

describe('mongoJsonCodec encode', () => {
  it('passes a plain JSON value through unchanged, whatever its key names', async () => {
    const nullPrototype = Object.assign(Object.create(null), { a: 1 });
    const value = notJson({
      $set: { 'a.b': [1, 'two', null, true, { c: 1.5 }] },
      empty: {},
      nullPrototype,
    });
    expect(await mongoJsonCodec.encode(value, {})).toBe(value);
  });

  it.each([
    ['undefined', undefined],
    ['bigint', 1n],
    ['symbol', Symbol('s')],
    ['function', () => 1],
    ['Date', new Date(0)],
    ['ObjectId', new ObjectId()],
    ['Long', Long.fromNumber(1)],
    ['Decimal128', Decimal128.fromString('1')],
    ['Binary', new Binary(new Uint8Array([1]))],
    ['BSONRegExp', new BSONRegExp('a', 'i')],
    ['Timestamp', new Timestamp({ t: 1, i: 1 })],
    ['Int32', new Int32(1)],
    ['Double', new Double(1)],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['Map', new Map()],
    ['Set', new Set()],
    ['RegExp', /a/],
    ['Uint8Array', new Uint8Array([1])],
    ['Point', new Point(1, 2)],
  ])('refuses %s nested in an object and an array, naming the path', async (received, value) => {
    await expect(
      mongoJsonCodec.encode(notJson({ outer: { items: [0, { value }] } }), {}),
    ).rejects.toThrow(encodeRefusal(received, 'outer.items.1.value'));
  });

  it('refuses a circular reference, naming the path where it repeats', async () => {
    const outer: { inner: { list: unknown[] } } = { inner: { list: [] } };
    outer.inner.list.push(outer);
    await expect(mongoJsonCodec.encode(notJson(outer), {})).rejects.toThrow(
      encodeRefusal('circular reference', 'inner.list.0'),
    );
  });

  it('accepts the same object at two places', async () => {
    const shared = { a: 1 };
    const value = notJson({ left: shared, right: [shared] });
    expect(await mongoJsonCodec.encode(value, {})).toBe(value);
  });

  it('refuses a hole in a sparse array', async () => {
    const sparse: unknown[] = [1];
    sparse[2] = 3;
    await expect(mongoJsonCodec.encode(notJson({ list: sparse }), {})).rejects.toThrow(
      encodeRefusal('sparse array hole', 'list.1'),
    );
  });

  it('says "the root" when the value itself is not JSON', async () => {
    await expect(mongoJsonCodec.encode(notJson(new Date(0)), {})).rejects.toThrow(
      encodeRefusal('Date', 'the root'),
    );
  });
});

describe('mongoJsonCodec decode', () => {
  it('returns a JSON wire value as the same JSON value', async () => {
    const document = { a: [1, 'two', null, true, { c: 1.5 }], $d: { 'e.f': [] } };
    expect(await mongoJsonCodec.decode(wire(document), {})).toBe(document);
  });

  it.each([
    ['date', new Date(0)],
    ['objectId', new ObjectId()],
    ['decimal', Decimal128.fromString('1.5')],
    ['binData', new Binary(new Uint8Array([1]))],
    ['regex', /a/i],
    ['regex', new BSONRegExp('a', 'i')],
    ['timestamp', new Timestamp({ t: 1, i: 1 })],
    ['long', Long.fromBigInt(2n ** 53n)],
    ['long', 2n ** 53n],
    ['double', Number.NaN],
    ['double', Number.POSITIVE_INFINITY],
    ['double', new Double(Number.NEGATIVE_INFINITY)],
    ['undefined', undefined],
    ['symbol', new BSONSymbol('s')],
    ['javascript', new Code('x')],
    ['minKey', new MinKey()],
    ['maxKey', new MaxKey()],
  ])('refuses a BSON %s nested in an object and an array, naming the path', async (type, value) => {
    await expect(
      mongoJsonCodec.decode(wire({ outer: { items: [0, { value }] } }), {}),
    ).rejects.toThrow(decodeRefusal(type, 'outer.items.1.value'));
  });

  it('refuses an object the driver does not produce instead of dropping its contents', async () => {
    await expect(mongoJsonCodec.decode(wire({ m: new Map([['k', 1]]) }), {})).rejects.toThrow(
      decodeRefusal('Map', 'm'),
    );
  });

  describe('a subdocument that bson reads as a DBRef', () => {
    function throughBson(document: Record<string, unknown>): JsonValue {
      return wire(BSON.deserialize(BSON.serialize(document)));
    }

    it('decodes back to the document it was stored as', async () => {
      const document = {
        link: { $ref: 'posts', $id: 7, $db: 'blog', extra: { tags: ['a'] } },
        noDb: { $ref: 'posts', $id: 'abc' },
      };
      const stored = throughBson(document);
      expect((stored as Record<string, unknown>)['link']).toBeInstanceOf(DBRef);
      expect(await mongoJsonCodec.decode(stored, {})).toEqual(document);
    });

    it('decodes each member with its own path', async () => {
      await expect(
        mongoJsonCodec.decode(throughBson({ link: { $ref: 'posts', $id: new ObjectId() } }), {}),
      ).rejects.toThrow(decodeRefusal('objectId', 'link.$id'));
      await expect(
        mongoJsonCodec.decode(
          throughBson({ link: { $ref: 'posts', $id: 1, extra: { at: new Date(0) } } }),
          {},
        ),
      ).rejects.toThrow(decodeRefusal('date', 'link.extra.at'));
    });
  });

  it.each([
    ['Long', { _bsontype: 'Long' }],
    ['DBRef', { _bsontype: 'DBRef' }],
    ['ObjectId', { _bsontype: 'ObjectId', x: 1 }],
    ['Int32', { _bsontype: 'Int32' }],
  ])(
    'reads a stored subdocument whose _bsontype key says %s as that document',
    async (_, subdocument) => {
      const document = JSON.parse(JSON.stringify({ a: subdocument }));
      expect(await mongoJsonCodec.decode(wire(document), {})).toEqual({ a: subdocument });
    },
  );

  it('says "the root" when the wire value itself is not JSON', async () => {
    await expect(mongoJsonCodec.decode(wire(new Date(0)), {})).rejects.toThrow(
      decodeRefusal('date', 'the root'),
    );
  });

  it('decodes a long at 2^53 - 1 as a number and refuses one at 2^53', async () => {
    const largestSafe = 2n ** 53n - 1n;
    expect(await mongoJsonCodec.decode(wire({ n: Long.fromBigInt(largestSafe) }), {})).toEqual({
      n: Number(largestSafe),
    });
    expect(await mongoJsonCodec.decode(wire({ n: largestSafe }), {})).toEqual({
      n: Number(largestSafe),
    });
    await expect(
      mongoJsonCodec.decode(wire({ n: Long.fromBigInt(largestSafe + 1n) }), {}),
    ).rejects.toThrow(decodeRefusal('long', 'n'));
  });

  it('unwraps Int32 and Double wrappers to numbers', async () => {
    expect(
      await mongoJsonCodec.decode(wire({ i: new Int32(7), d: [new Double(1.5)] }), {}),
    ).toEqual({ i: 7, d: [1.5] });
  });

  it('copies only the objects and arrays around a value it converts', async () => {
    const untouched = { b: [1] };
    const document = { untouched, changed: { n: new Int32(7) } };
    const decoded = (await mongoJsonCodec.decode(wire(document), {})) as Record<string, unknown>;
    expect(decoded).toEqual({ untouched: { b: [1] }, changed: { n: 7 } });
    expect(decoded['untouched']).toBe(untouched);
  });

  it('keeps a "__proto__" key as an own property', async () => {
    const document = JSON.parse('{"__proto__": {"polluted": true}}');
    const decoded = await mongoJsonCodec.decode(wire(document), {});
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(Object.hasOwn(decoded as object, '__proto__')).toBe(true);
  });
});

describe('mongoJsonCodec refusal details', () => {
  it('name the codec, the refused kind and the path inside the value', async () => {
    await expect(mongoJsonCodec.encode(notJson({ a: [undefined] }), {})).rejects.toMatchObject({
      meta: { codecId: 'mongo/json@1', received: 'undefined', valuePath: 'a.0' },
    });
    await expect(mongoJsonCodec.decode(wire({ a: [new Date(0)] }), {})).rejects.toMatchObject({
      meta: { codecId: 'mongo/json@1', received: 'date', valuePath: 'a.0' },
    });
  });
});
