import { createRequire } from 'node:module';
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
import { MONGO_BSON_CODEC_ID } from '../src/core/codec-ids';
import { mongoBsonCodec, mongoDescriptorById, mongoStandardCodecs } from '../src/core/codecs';
import type { BsonValue } from '../src/exports/codec-types';

const driverBson: typeof import('bson') = createRequire(import.meta.url)('bson');

function notBson(value: unknown): BsonValue {
  return value as BsonValue;
}

function encodeRefusal(received: string, path: string) {
  return expect.objectContaining({
    code: 'RUNTIME.ENCODE_FAILED',
    message: `mongo/bson@1 value must be a BSON value; received ${received} at ${path}`,
  });
}

const scalars: ReadonlyArray<readonly [string, BsonValue]> = [
  ['string', 'text'],
  ['number', 1.5],
  ['boolean', true],
  ['null', null],
  ['Date', new Date(0)],
  ['ObjectId', new ObjectId('64b7f0c2a1b2c3d4e5f60718')],
  ['Long', Long.fromBigInt(2n ** 60n)],
  ['Decimal128', Decimal128.fromString('1234.5600')],
  ['Binary', new Binary(new Uint8Array(16).fill(7), 4)],
  ['BSONRegExp', new BSONRegExp('^a', 'i')],
  ['Timestamp', new Timestamp({ t: 1, i: 2 })],
  ['Int32', new Int32(7)],
  ['Double', new Double(2.5)],
  ['Code', new Code('function () { return x; }', { x: 1 })],
  ['MinKey', new MinKey()],
  ['MaxKey', new MaxKey()],
  ['BSONSymbol', new BSONSymbol('s')],
];

describe('mongoBsonCodec encode', () => {
  it.each(scalars)(
    'passes a %s nested in an object and an array through unchanged',
    async (_, value) => {
      const document = notBson({ outer: { items: [0, { value }] } });
      const encoded = await mongoBsonCodec.encode(document, {});
      expect(encoded).toBe(document);
    },
  );

  it.each([
    ['undefined', undefined],
    ['bigint', 1n],
    ['symbol', Symbol('s')],
    ['function', () => 1],
    ['DBRef', new DBRef('c', new ObjectId())],
  ])('refuses %s nested in an object and an array, naming the path', async (received, value) => {
    await expect(
      mongoBsonCodec.encode(notBson({ outer: { items: [0, { value }] } }), {}),
    ).rejects.toThrow(encodeRefusal(received, 'outer.items.1.value'));
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a native RegExp', /^a/i],
    ['a Uint8Array', new Uint8Array([1, 2])],
    ['a Buffer', Buffer.from([1, 2])],
  ])('passes %s nested in an object and an array through unchanged', async (_, value) => {
    const document = notBson({ outer: { items: [0, { value }] } });
    expect(await mongoBsonCodec.encode(document, {})).toBe(document);
  });

  class Point {
    constructor(readonly x: number) {}
  }

  it.each([
    ['Map', new Map([['k', 1]])],
    ['Set', new Set([1])],
    ['Point', new Point(1)],
    ['Int16Array', new Int16Array([1])],
  ])('refuses a %s nested in an object and an array, naming the path', async (received, value) => {
    await expect(
      mongoBsonCodec.encode(notBson({ outer: { items: [0, { value }] } }), {}),
    ).rejects.toThrow(encodeRefusal(received, 'outer.items.1.value'));
  });

  class OtherBsonObjectId {
    readonly _bsontype = 'ObjectId';
    constructor() {
      Reflect.set(this, Symbol.for('@@mdb.bson.version'), 6);
    }
    toHexString(): string {
      return '64b7f0c2a1b2c3d4e5f60718';
    }
  }

  it.each([
    ['MinKey not created by bson 7', { _bsontype: 'MinKey' }],
    ['Decimal128 not created by bson 7', { _bsontype: 'Decimal128', toString: () => '1' }],
    ['ObjectId not created by bson 7', new OtherBsonObjectId()],
  ])('refuses %s nested in an object and an array, naming the path', async (received, value) => {
    await expect(
      mongoBsonCodec.encode(notBson({ outer: { items: [0, { value }] } }), {}),
    ).rejects.toThrow(encodeRefusal(received, 'outer.items.1.value'));
  });

  it('refuses a circular reference, naming the path where it repeats', async () => {
    const outer: { inner: { list: unknown[] } } = { inner: { list: [] } };
    outer.inner.list.push(outer);
    await expect(mongoBsonCodec.encode(notBson(outer), {})).rejects.toThrow(
      encodeRefusal('circular reference', 'inner.list.0'),
    );
  });

  it('accepts the same object at two places', async () => {
    const shared = { a: 1 };
    const value = notBson({ left: shared, right: [shared] });
    expect(await mongoBsonCodec.encode(value, {})).toBe(value);
  });

  it('refuses a hole in a sparse array', async () => {
    const sparse: unknown[] = [1];
    sparse[2] = 3;
    await expect(mongoBsonCodec.encode(notBson({ list: sparse }), {})).rejects.toThrow(
      encodeRefusal('sparse array hole', 'list.1'),
    );
  });

  it('says "the root" when the value itself is not BSON', async () => {
    await expect(mongoBsonCodec.encode(notBson(undefined), {})).rejects.toThrow(
      encodeRefusal('undefined', 'the root'),
    );
  });
});

describe('mongoBsonCodec refusal details', () => {
  it('name the codec, the refused kind and the path inside the value', async () => {
    await expect(mongoBsonCodec.encode(notBson({ a: [undefined] }), {})).rejects.toMatchObject({
      meta: { codecId: 'mongo/bson@1', received: 'undefined', valuePath: 'a.0' },
    });
  });
});

describe('mongoBsonCodec decode', () => {
  it('is tested against a separate load of bson, as the driver has', () => {
    expect(driverBson.Code).not.toBe(Code);
  });

  it('returns the wire value unchanged, whatever it holds', async () => {
    const wire = notBson({
      id: new ObjectId(),
      code: new Code('x'),
      big: Long.fromBigInt(2n ** 60n),
      promoted: 42,
      nested: [new MinKey(), { at: new Date(0) }],
    });
    expect(await mongoBsonCodec.decode(wire, {})).toBe(wire);
  });

  it.each([['DBRef', { _bsontype: 'DBRef' }]])(
    'returns a stored subdocument whose _bsontype key says %s unchanged',
    async (_, subdocument) => {
      const wire = JSON.parse(JSON.stringify({ a: subdocument }));
      expect(await mongoBsonCodec.decode(wire, {})).toBe(wire);
    },
  );

  it('rebuilds a DBRef that bson read from a $ref/$id subdocument, keeping member BSON types', async () => {
    const id = new ObjectId('64b7f0c2a1b2c3d4e5f60718');
    const stored = BSON.deserialize(
      BSON.serialize({
        link: { $ref: 'posts', $id: id, $db: 'blog', extra: { at: new Date(0) } },
        list: [{ $ref: 'posts', $id: 1 }],
      }),
    );
    expect(stored['link']).toBeInstanceOf(DBRef);

    const decoded = (await mongoBsonCodec.decode(notBson(stored), {})) as Record<string, unknown>;
    expect(decoded).toEqual({
      link: { $ref: 'posts', $id: id, $db: 'blog', extra: { at: new Date(0) } },
      list: [{ $ref: 'posts', $id: 1 }],
    });
    expect(decoded['link']).not.toBeInstanceOf(DBRef);
    expect((decoded['link'] as { $id: unknown }).$id).toBeInstanceOf(ObjectId);
  });

  it('rebuilds a DBRef inside a Code scope that the driver read', async () => {
    const stored = driverBson.BSON.deserialize(
      driverBson.BSON.serialize({
        code: new driverBson.Code('x', { link: { $ref: 'posts', $id: 1 } }),
      }),
    );
    expect(stored['code'].scope.link).toBeInstanceOf(driverBson.DBRef);

    const decoded = (await mongoBsonCodec.decode(notBson(stored), {})) as {
      code: { _bsontype: string; code: string; scope: Record<string, unknown> };
    };
    expect(decoded.code).toMatchObject({ _bsontype: 'Code', code: 'x' });
    expect(decoded.code.scope).toEqual({ link: { $ref: 'posts', $id: 1 } });
    expect(decoded.code.scope['link']).not.toBeInstanceOf(driverBson.DBRef);
  });
});

describe('mongoBsonCodec JSON form', () => {
  it.each(scalars)(
    'round-trips a %s through canonical Extended JSON to the same BSON',
    (_, value) => {
      const document = { value, list: [value] };
      const json = mongoBsonCodec.encodeJson(notBson(document));
      expect(JSON.parse(JSON.stringify(json))).toEqual(json);
      const decoded = mongoBsonCodec.decodeJson(json);
      expect(BSON.serialize(decoded as BSON.Document)).toEqual(
        BSON.serialize(document as BSON.Document),
      );
    },
  );

  it.each([
    ['an integer above the int32 range', 2 ** 40, new Double(2 ** 40)],
    ['an integer below the int32 range', -(2 ** 31) - 1, new Double(-(2 ** 31) - 1)],
    ['a Uint8Array', new Uint8Array([1, 2]), new Binary(new Uint8Array([1, 2]))],
    ['a Buffer', Buffer.from([1, 2]), new Binary(new Uint8Array([1, 2]))],
  ])('records %s as the BSON type the driver writes', (_, value, readBack) => {
    const document = notBson({ value, list: [value] });
    const decoded = mongoBsonCodec.decodeJson(mongoBsonCodec.encodeJson(document));
    expect(decoded).toEqual({ value: readBack, list: [readBack] });
    expect(BSON.serialize(decoded as BSON.Document)).toEqual(
      BSON.serialize(document as BSON.Document),
    );
  });

  it('records an integer above the int32 range inside a driver-loaded Code scope as a double', () => {
    const json = mongoBsonCodec.encodeJson(
      notBson({ c: new driverBson.Code('x', { n: 2 ** 40 }) }),
    );
    expect(json).toEqual({
      c: { $code: 'x', $scope: { n: { $numberDouble: '1099511627776.0' } } },
    });
  });

  it('writes a top-level scalar as its canonical Extended JSON', () => {
    expect(mongoBsonCodec.encodeJson(2 ** 40)).toEqual({ $numberDouble: '1099511627776.0' });
    expect(mongoBsonCodec.encodeJson(5)).toEqual({ $numberInt: '5' });
  });

  it('writes canonical, not relaxed, Extended JSON', () => {
    expect(mongoBsonCodec.encodeJson(notBson({ n: new Int32(1), d: new Date(0) }))).toEqual({
      n: { $numberInt: '1' },
      d: { $date: { $numberLong: '0' } },
    });
  });
});

describe('mongo/bson@1 descriptor', () => {
  it('declares no BSON type, no traits and no renderers', () => {
    const descriptor = mongoDescriptorById(MONGO_BSON_CODEC_ID);
    expect(descriptor).toMatchObject({
      codecId: 'mongo/bson@1',
      dataType: 'mongo/bson',
      targetTypes: [],
      traits: [],
    });
    expect(descriptor).not.toHaveProperty('renderOutputType');
    expect(descriptor).not.toHaveProperty('renderValueLiteral');
  });

  it('is registered in the standard codec set', () => {
    expect(mongoStandardCodecs.map((codec) => codec.id)).toContain(MONGO_BSON_CODEC_ID);
  });
});
