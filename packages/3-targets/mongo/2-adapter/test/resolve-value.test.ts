import { runInNewContext } from 'node:vm';
import { type DataTypeValue, dataType, readJsonString } from '@internal/framework-components/codec';
import {
  assembleMongoCodecRegistry,
  mongoCodec,
  newMongoCodecRegistry,
} from '@internal/mongo-codec';
import { MongoParamRef, MongoPreparedParamRef, type MongoValue } from '@internal/mongo-value';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { isStructuredError, structuredError } from '@internal/utils/structured-error';
import { Binary, BSON, BSONRegExp, Decimal128, Double, Long, MinKey, ObjectId } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { resolveDraftDoc, resolveValue } from '../src/resolve-value';

const textType = dataType('test/text', { read: (json) => readJsonString('test/text', json) });

interface RuntimeErrorShape extends Error {
  code?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

const uppercaseCodec = mongoCodec({
  typeId: 'test/uppercase@1',
  fromWire: (wire: string) => wire.toLowerCase(),
  toWire: (value: string) => value.toUpperCase(),
  dataType: textType,
  fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
});

function testRegistry() {
  const registry = newMongoCodecRegistry();
  registry.register(uppercaseCodec);
  return registry;
}

function emptyRegistry() {
  return newMongoCodecRegistry();
}

const noCtx = {} as const;

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
} {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('resolveValue', () => {
  it('unwraps MongoParamRef without codec registry', async () => {
    const ref = new MongoParamRef('hello');
    expect(await resolveValue(ref, emptyRegistry(), noCtx)).toBe('hello');
  });

  it('unwraps MongoParamRef without codecId even when registry is provided', async () => {
    const ref = new MongoParamRef('hello');
    expect(await resolveValue(ref, testRegistry(), noCtx)).toBe('hello');
  });

  it('applies codec encode when MongoParamRef has codecId and registry has codec', async () => {
    const ref = new MongoParamRef('hello', { codecId: 'test/uppercase@1' });
    expect(await resolveValue(ref, testRegistry(), noCtx)).toBe('HELLO');
  });

  it('falls back to raw value when codecId is set but registry is empty', async () => {
    const ref = new MongoParamRef('hello', { codecId: 'test/uppercase@1' });
    expect(await resolveValue(ref, emptyRegistry(), noCtx)).toBe('hello');
  });

  it('falls back to raw value when codecId is not in registry', async () => {
    const ref = new MongoParamRef('hello', { codecId: 'test/unknown@1' });
    expect(await resolveValue(ref, testRegistry(), noCtx)).toBe('hello');
  });

  it('encodes nested MongoParamRef with codecId inside object', async () => {
    const doc = {
      name: new MongoParamRef('alice'),
      label: new MongoParamRef('greeting', { codecId: 'test/uppercase@1' }),
    };
    const result = (await resolveValue(doc, testRegistry(), noCtx)) as Record<string, unknown>;
    expect(result['name']).toBe('alice');
    expect(result['label']).toBe('GREETING');
  });

  it('encodes MongoParamRef with codecId inside array', async () => {
    const arr = [new MongoParamRef('a', { codecId: 'test/uppercase@1' }), new MongoParamRef('b')];
    const result = (await resolveValue(arr, testRegistry(), noCtx)) as unknown[];
    expect(result[0]).toBe('A');
    expect(result[1]).toBe('b');
  });

  it('passes the driver`s BSON values, bytes and regular expressions through unchanged, at any depth', async () => {
    const values = {
      id: new ObjectId('65f0000000000000000000ab'),
      long: Long.fromBigInt(2n ** 60n),
      decimal: Decimal128.fromString('1.5'),
      double: new Double(2),
      binary: new Binary(new Uint8Array([1])),
      bytes: new Uint8Array([2]),
      pattern: /a+/i,
      bsonPattern: new BSONRegExp('b', 'm'),
      nested: [{ min: new MinKey() }],
    };
    const resolved = (await resolveValue(
      values as unknown as MongoValue,
      emptyRegistry(),
      noCtx,
    )) as typeof values;
    expect(resolved).not.toBe(values);
    for (const key of Object.keys(values) as (keyof typeof values)[]) {
      if (key === 'nested') continue;
      expect(resolved[key]).toBe(values[key]);
    }
    expect(resolved.nested[0]?.min).toBe(values.nested[0]?.min);
  });

  it('preserves $in array shape and encodes each operator-owned ref exactly once', async () => {
    const toWire = vi.fn((value: string) => `wire:${value}`);
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'test/in-operand@1',
        fromWire: (wire: string) => wire,
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
        toWire,
      }),
    );
    const input = {
      tags: {
        $in: [
          new MongoParamRef('admin', { codecId: 'test/in-operand@1' }),
          null,
          new MongoParamRef('editor', { codecId: 'test/in-operand@1' }),
        ],
      },
    };

    expect(await resolveValue(input, registry, noCtx)).toEqual({
      tags: { $in: ['wire:admin', null, 'wire:editor'] },
    });
    expect(toWire).toHaveBeenCalledTimes(2);
    expect(toWire).toHaveBeenNthCalledWith(1, 'admin', noCtx);
    expect(toWire).toHaveBeenNthCalledWith(2, 'editor', noCtx);
  });

  it('preserves null, primitive, and Date values', async () => {
    expect(await resolveValue(null, emptyRegistry(), noCtx)).toBeNull();
    expect(await resolveValue(42, emptyRegistry(), noCtx)).toBe(42);
    expect(await resolveValue('raw', emptyRegistry(), noCtx)).toBe('raw');
    const d = new Date();
    expect(await resolveValue(d, emptyRegistry(), noCtx)).toBe(d);
  });

  it('passes a Date created in another realm through unchanged', async () => {
    const d: Date = runInNewContext('new Date(0)');
    expect(await resolveValue({ at: d }, emptyRegistry(), noCtx)).toEqual({ at: d });
  });

  it('gives the driver a Date it serializes as a date, even one from another realm with its own string tag', async () => {
    const d: Date = runInNewContext(
      'Object.defineProperty(new Date(0), Symbol.toStringTag, { value: "Tagged" })',
    );
    const resolved = await resolveValue({ at: d }, emptyRegistry(), noCtx);
    expect(BSON.deserialize(BSON.serialize(resolved as BSON.Document))).toEqual({
      at: new Date(0),
    });
  });

  describe('async dispatch — codec encode + concurrent encoding', () => {
    it('returns a Promise', () => {
      const result = resolveValue(new MongoParamRef('x'), emptyRegistry(), noCtx);
      expect(typeof (result as { then?: unknown }).then).toBe('function');
    });

    it('dispatches multiple codec-encoded leaves concurrently via Promise.all', async () => {
      const dA = deferred<string>();
      const dB = deferred<string>();
      const callOrder: string[] = [];

      const asyncACodec = mongoCodec({
        typeId: 'test/async-a@1',
        fromWire: (wire: string) => wire,
        toWire: (value: string) => {
          callOrder.push('encode-a-start');
          return dA.promise.then((suffix) => `${value}:${suffix}`);
        },
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      });
      const asyncBCodec = mongoCodec({
        typeId: 'test/async-b@1',
        fromWire: (wire: string) => wire,
        toWire: (value: string) => {
          callOrder.push('encode-b-start');
          return dB.promise.then((suffix) => `${value}:${suffix}`);
        },
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      });

      const registry = newMongoCodecRegistry();
      registry.register(asyncACodec);
      registry.register(asyncBCodec);

      const doc = {
        a: new MongoParamRef('alpha', { codecId: 'test/async-a@1' }),
        b: new MongoParamRef('beta', { codecId: 'test/async-b@1' }),
      };

      const resultPromise = resolveValue(doc, registry, noCtx);

      // Both encode functions must have started before either resolves — i.e. dispatch is concurrent, not sequential.
      await new Promise((r) => setImmediate(r));
      expect(callOrder).toEqual(['encode-a-start', 'encode-b-start']);

      dB.resolve('B-WIRE');
      dA.resolve('A-WIRE');

      const result = (await resultPromise) as Record<string, unknown>;
      expect(result['a']).toBe('alpha:A-WIRE');
      expect(result['b']).toBe('beta:B-WIRE');
    });

    it('dispatches concurrently across array elements via Promise.all', async () => {
      const d1 = deferred<string>();
      const d2 = deferred<string>();
      const callOrder: string[] = [];

      const codec = mongoCodec({
        typeId: 'test/seq@1',
        fromWire: (w: string) => w,
        toWire: async (value: string) => {
          callOrder.push(`start:${value}`);
          if (value === 'one') return d1.promise;
          return d2.promise;
        },
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      });

      const registry = newMongoCodecRegistry();
      registry.register(codec);

      const arr = [
        new MongoParamRef('one', { codecId: 'test/seq@1' }),
        new MongoParamRef('two', { codecId: 'test/seq@1' }),
      ];

      const resultPromise = resolveValue(arr, registry, noCtx);

      await new Promise((r) => setImmediate(r));
      expect(callOrder).toEqual(['start:one', 'start:two']);

      d1.resolve('1');
      d2.resolve('2');

      const result = (await resultPromise) as unknown[];
      expect(result).toEqual(['1', '2']);
    });

    it('passes through non-MongoParamRef values unchanged (identity passthrough)', async () => {
      // A plain value with no MongoParamRef inside should round-trip identical structure.
      const input = { x: 1, y: [2, 3], z: { nested: 'leaf' } };
      const result = await resolveValue(input, emptyRegistry(), noCtx);
      expect(result).toEqual(input);
    });
  });

  describe('error envelope (RUNTIME.ENCODE_FAILED)', () => {
    it('wraps codec.toWire failures in RUNTIME.ENCODE_FAILED with cause and codec id', async () => {
      const failingCodec = mongoCodec({
        typeId: 'test/failing@1',
        fromWire: (w: string) => w,
        toWire: async (_v: string) => {
          throw new Error('kms-key-resolution-failed');
        },
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      });
      const registry = newMongoCodecRegistry();
      registry.register(failingCodec);

      const ref = new MongoParamRef('plaintext', { codecId: 'test/failing@1' });
      const rejection = (await resolveValue(ref, registry, noCtx).catch(
        (e: unknown) => e,
      )) as Error;
      expect(rejection).toBeInstanceOf(Error);
      const err = rejection as RuntimeErrorShape;
      expect(err.code).toBe('RUNTIME.ENCODE_FAILED');
      expect(err.message).toContain('test/failing@1');
      expect(err.message).toContain('kms-key-resolution-failed');
      expect(err.details?.['codec']).toBe('test/failing@1');
      expect((err.cause as Error | undefined)?.message).toBe('kms-key-resolution-failed');
    });

    it('uses MongoParamRef.name as the envelope label when available', async () => {
      const failingCodec = mongoCodec({
        typeId: 'test/failing@1',
        fromWire: (w: string) => w,
        toWire: async (_v: string) => {
          throw new Error('boom');
        },
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      });
      const registry = newMongoCodecRegistry();
      registry.register(failingCodec);

      const ref = new MongoParamRef('plaintext', {
        codecId: 'test/failing@1',
        name: 'user.email',
      });
      const rejection = (await resolveValue(ref, registry, noCtx).catch(
        (e: unknown) => e,
      )) as Error;
      const err = rejection as RuntimeErrorShape;
      expect(err.details?.['label']).toBe('user.email');
      expect(err.message).toContain('user.email');
    });

    it('falls back to codec id as the envelope label when MongoParamRef has no name', async () => {
      const failingCodec = mongoCodec({
        typeId: 'test/failing@1',
        fromWire: (w: string) => w,
        toWire: async (_v: string) => {
          throw new Error('boom');
        },
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      });
      const registry = newMongoCodecRegistry();
      registry.register(failingCodec);

      const ref = new MongoParamRef('plaintext', { codecId: 'test/failing@1' });
      const rejection = (await resolveValue(ref, registry, noCtx).catch(
        (e: unknown) => e,
      )) as Error;
      const err = rejection as RuntimeErrorShape;
      expect(err.details?.['label']).toBe('test/failing@1');
    });

    it('adds the parameter label to a structured RUNTIME.ENCODE_FAILED from a codec, keeping its details', async () => {
      const ref = new MongoParamRef('12.5E', { codecId: 'mongo/decimal128@1', name: 'price' });
      const rejection = await resolveValue(
        ref,
        assembleMongoCodecRegistry([mongoRuntimeTarget]),
        noCtx,
      ).catch((e: unknown) => e);
      const err = rejection as RuntimeErrorShape;
      expect({ code: err.code, message: err.message, details: err.details }).toEqual({
        code: 'RUNTIME.ENCODE_FAILED',
        message:
          "Failed to encode parameter price with codec 'mongo/decimal128@1': mongo/decimal128@1 value must be decimal text without an exponent, or NaN, Infinity or -Infinity",
        details: {
          codecId: 'mongo/decimal128@1',
          received: '12.5E',
          label: 'price',
          codec: 'mongo/decimal128@1',
        },
      });
      expect(err.cause).toEqual(expect.objectContaining({ code: 'RUNTIME.ENCODE_FAILED' }));
    });

    it('names the field and collection when the parameter carries them', async () => {
      const ref = new MongoParamRef('12.5E', {
        codecId: 'mongo/decimal128@1',
        name: 'price',
        collection: 'products',
      });
      const rejection = await resolveValue(
        ref,
        assembleMongoCodecRegistry([mongoRuntimeTarget]),
        noCtx,
      ).catch((e: unknown) => e);
      const err = rejection as RuntimeErrorShape;
      expect({ code: err.code, message: err.message, details: err.details }).toEqual({
        code: 'RUNTIME.ENCODE_FAILED',
        message:
          "Failed to encode field price in collection 'products' with codec 'mongo/decimal128@1': mongo/decimal128@1 value must be decimal text without an exponent, or NaN, Infinity or -Infinity",
        details: {
          codecId: 'mongo/decimal128@1',
          received: '12.5E',
          label: 'price',
          collection: 'products',
          codec: 'mongo/decimal128@1',
        },
      });
    });

    it('passes any structured envelope through unchanged instead of re-wrapping', async () => {
      const envelope = structuredError('EXT.CODEC_BROKEN', 'codec-owned envelope');
      const innerCodec = mongoCodec({
        typeId: 'test/structured@1',
        fromWire: (w: string) => w,
        toWire: async (_v: string) => {
          throw envelope;
        },
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      });
      const registry = newMongoCodecRegistry();
      registry.register(innerCodec);

      const ref = new MongoParamRef('x', { codecId: 'test/structured@1' });
      const rejection = await resolveValue(ref, registry, noCtx).catch((e: unknown) => e);
      expect(rejection).toBe(envelope);
      expect(isStructuredError(rejection)).toBe(true);
    });

    it('rethrows an InternalError from a codec unchanged', async () => {
      const original = new InternalError('codec invariant broke');
      const registry = newMongoCodecRegistry();
      registry.register(
        mongoCodec({
          typeId: 'test/internal-error@1',
          fromWire: (w: string) => w,
          toWire: (_v: string) => {
            throw original;
          },
          dataType: textType,
          fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
        }),
      );

      const ref = new MongoParamRef('x', { codecId: 'test/internal-error@1' });
      await expect(resolveValue(ref, registry, noCtx)).rejects.toBe(original);
    });

    it('wraps a plain codec failure in RUNTIME.ENCODE_FAILED', async () => {
      const innerCodec = mongoCodec({
        typeId: 'test/plain-failure@1',
        fromWire: (w: string) => w,
        toWire: async (_v: string) => {
          throw new Error('plain failure');
        },
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      });
      const registry = newMongoCodecRegistry();
      registry.register(innerCodec);

      const ref = new MongoParamRef('x', { codecId: 'test/plain-failure@1' });
      const rejection = await resolveValue(ref, registry, noCtx).catch((e: unknown) => e);
      expect(isStructuredError(rejection)).toBe(true);
      const err = rejection as RuntimeErrorShape;
      expect(err.code).toBe('RUNTIME.ENCODE_FAILED');
      expect((err.cause as Error).message).toBe('plain failure');
    });
  });

  describe('null values', () => {
    function spyRegistry() {
      const toWire = vi.fn((value: string) => {
        if (value === null) throw new Error('null is not a string');
        return value.toUpperCase();
      });
      const registry = newMongoCodecRegistry();
      registry.register(
        mongoCodec({
          typeId: 'test/spy@1',
          fromWire: (wire: string) => wire,
          toWire,
          dataType: textType,
          fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
        }),
      );
      return { registry, toWire };
    }

    it('sends null without the codec when the ref is nullable', async () => {
      const { registry, toWire } = spyRegistry();
      const ref = new MongoParamRef(null, { codecId: 'test/spy@1', nullable: true });
      expect(await resolveValue(ref, registry, noCtx)).toBeNull();
      expect(toWire).not.toHaveBeenCalled();
    });

    it('passes null to the codec when the ref is not nullable', async () => {
      const { registry } = spyRegistry();
      const ref = new MongoParamRef(null, { codecId: 'test/spy@1' });
      await expect(resolveValue(ref, registry, noCtx)).rejects.toMatchObject({
        code: 'RUNTIME.ENCODE_FAILED',
      });
    });
  });
});

describe('placeholders outside prepare', () => {
  const placeholder = new MongoPreparedParamRef('email', 'mongo/string@1', false);
  const expected = { code: 'RUNTIME.PREPARE_BIND_ON_ADHOC', details: { name: 'email' } };

  it('resolveValue refuses a placeholder', async () => {
    await expect(resolveValue(placeholder, emptyRegistry(), noCtx)).rejects.toMatchObject(expected);
  });

  it('resolveValue refuses a nested placeholder', async () => {
    await expect(
      resolveValue({ email: { $in: [placeholder] } }, emptyRegistry(), noCtx),
    ).rejects.toMatchObject(expected);
  });

  it('resolveDraftDoc refuses a placeholder in a stage slot', async () => {
    await expect(
      resolveDraftDoc({ $limit: placeholder }, emptyRegistry(), noCtx),
    ).rejects.toMatchObject(expected);
  });
});
