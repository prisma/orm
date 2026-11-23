import { type DataTypeValue, dataType, readJsonString } from '@internal/framework-components/codec';
import { type MongoCodecRegistry, mongoCodec, newMongoCodecRegistry } from '@internal/mongo-codec';
import type { MongoFieldShape, MongoResultShape } from '@internal/mongo-query-ast/execution';
import { BSON } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { decodeMongoRow } from '../../src/codecs/decoding';

const textType = dataType('test/text', { read: (json) => readJsonString('test/text', json) });

function stringRegistry(): MongoCodecRegistry {
  const registry = newMongoCodecRegistry();
  registry.register(
    mongoCodec({
      typeId: 'mongo/string@1',
      toWire: (v: string) => v,
      fromWire: (w: string) => {
        if (typeof w !== 'string') throw new Error(`not a string: ${typeof w}`);
        return w;
      },
      dataType: textType,
      fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
    }),
  );
  return registry;
}

const nullableString: MongoFieldShape = {
  kind: 'leaf',
  codecId: 'mongo/string@1',
  nullable: true,
};
const requiredString: MongoFieldShape = { ...nullableString, nullable: false };

function withOwnProtoKey(value: unknown): Record<string, unknown> {
  const document: Record<string, unknown> = { name: 'Ada' };
  Object.defineProperty(document, '__proto__', {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return document;
}

describe('decodeMongoRow with field names Object.prototype also has', () => {
  it('reads a stored __proto__ field from BSON as an own key', () => {
    const decoded = BSON.deserialize(BSON.serialize(withOwnProtoKey({ isAdmin: true })));
    expect({
      ownProto: Object.hasOwn(decoded, '__proto__'),
      prototypeIsPlain: Object.getPrototypeOf(decoded) === Object.prototype,
      keys: Object.keys(decoded),
    }).toEqual({ ownProto: true, prototypeIsPlain: true, keys: ['name', '__proto__'] });
  });

  it('keeps an unshaped stored __proto__ field as an own key without changing the prototype', async () => {
    const row = BSON.deserialize(BSON.serialize(withOwnProtoKey({ isAdmin: true })));
    const shape: MongoResultShape = {
      kind: 'document',
      fields: { name: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false } },
    };
    const out = await decodeMongoRow(row, shape, stringRegistry(), 'users');
    expect({
      prototypeIsPlain: Object.getPrototypeOf(out) === Object.prototype,
      ownProto: Object.getOwnPropertyDescriptor(out, '__proto__')?.value,
      keys: Object.keys(out as object).sort(),
    }).toEqual({
      prototypeIsPlain: true,
      ownProto: { isAdmin: true },
      keys: ['__proto__', 'name'],
    });
  });

  it('keeps a __proto__ field of a subdocument as an own key without changing the prototype', async () => {
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        address: {
          kind: 'document',
          nullable: false,
          fields: { name: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false } },
        },
      },
    };
    const row = BSON.deserialize(BSON.serialize({ address: withOwnProtoKey({ isAdmin: true }) }));
    const out = await decodeMongoRow(row, shape, stringRegistry(), 'users');
    const address = (out as { address: object }).address;
    expect({
      prototypeIsPlain: Object.getPrototypeOf(address) === Object.prototype,
      ownProto: Object.getOwnPropertyDescriptor(address, '__proto__')?.value,
    }).toEqual({ prototypeIsPlain: true, ownProto: { isAdmin: true } });
  });

  it('reads a shaped constructor field the document leaves out as absent, at any depth', async () => {
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        constructor: nullableString,
        address: {
          kind: 'document',
          nullable: false,
          fields: {
            toString: nullableString,
          },
        },
      },
    };
    const out = await decodeMongoRow({ address: {} }, shape, stringRegistry(), 'users');
    expect(out).toStrictEqual({ constructor: null, address: { toString: null } });
  });

  it('decodes a shaped constructor field the document stores', async () => {
    const shape: MongoResultShape = {
      kind: 'document',
      fields: { constructor: requiredString },
    };
    const out = await decodeMongoRow({ constructor: 'Ada' }, shape, stringRegistry(), 'users');
    expect(out).toStrictEqual({ constructor: 'Ada' });
  });
});
