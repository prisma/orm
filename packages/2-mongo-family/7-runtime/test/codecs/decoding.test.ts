import { isRuntimeError } from '@internal/framework-components/runtime';
import { type MongoCodecRegistry, mongoCodec, newMongoCodecRegistry } from '@internal/mongo-codec';
import type { MongoFieldShape, MongoResultShape } from '@internal/mongo-query-ast/execution';
import { buildStandardCodecRegistry } from '@internal/target-mongo/codecs';
import { structuredError } from '@internal/utils/structured-error';
import { ObjectId } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { decodeMongoRow } from '../../src/codecs/decoding';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function registryWithDefaults(): MongoCodecRegistry {
  const registry = newMongoCodecRegistry();
  registry.register(
    mongoCodec({
      typeId: 'mongo/string@1',
      encode: (v: string) => v,
      decode: (w: string) => w,
    }),
  );
  registry.register(
    mongoCodec({
      typeId: 'mongo/objectId@1',
      encode: (v: string) => new ObjectId(v),
      decode: (w: { toHexString: () => string }) => w.toHexString(),
    }),
  );
  return registry;
}

describe('decodeMongoRow', () => {
  it('decodes top-level scalar fields by codecId', async () => {
    const registry = registryWithDefaults();
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        _id: { kind: 'leaf', codecId: 'mongo/objectId@1', nullable: false },
        name: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
      },
    };
    const row = {
      _id: { toHexString: () => 'abc123' },
      name: 'Ada',
    };
    const out = await decodeMongoRow(row, shape, registry, 'users');
    expect(out).toEqual({ _id: 'abc123', name: 'Ada' });
  });

  it('short-circuits null and undefined without calling decode', async () => {
    const registry = registryWithDefaults();
    const decodeSpy = vi.fn((w: string) => w);
    registry.register(
      mongoCodec({
        typeId: 'test/spy@1',
        encode: (v: string) => v,
        decode: decodeSpy,
      }),
    );
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        a: { kind: 'leaf', codecId: 'test/spy@1', nullable: true },
        b: { kind: 'leaf', codecId: 'test/spy@1', nullable: true },
      },
    };
    const row = { a: null, b: undefined };
    const out = await decodeMongoRow(row, shape, registry, 'c');
    expect(out).toEqual({ a: null, b: undefined });
    expect(decodeSpy).not.toHaveBeenCalled();
  });

  it('decodes array elements in lockstep with element shape', async () => {
    const registry = registryWithDefaults();
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        tags: {
          kind: 'array',
          nullable: false,
          element: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
        },
      },
    };
    const row = { tags: ['a', 'b'] };
    const out = await decodeMongoRow(row, shape, registry, 'c');
    expect(out).toEqual({ tags: ['a', 'b'] });
  });

  it('recurses into document fields with dot-joined paths on failure context', async () => {
    const registry = registryWithDefaults();
    const inner: MongoFieldShape = {
      kind: 'document',
      nullable: false,
      fields: {
        city: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
      },
    };
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        address: inner,
      },
    };
    const row = { address: { city: 'Paris' } };
    const out = await decodeMongoRow(row, shape, registry, 'c');
    expect(out).toEqual({ address: { city: 'Paris' } });
  });

  it('uses numeric indices in paths for arrays', async () => {
    const registry = registryWithDefaults();
    registry.register(
      mongoCodec({
        typeId: 'throws-on-b@1',
        encode: (v: string) => v,
        decode: (w: string) => {
          if (w === 'bad') throw new Error('boom');
          return w;
        },
      }),
    );
    const shapeThrow: MongoResultShape = {
      kind: 'document',
      fields: {
        tags: {
          kind: 'array',
          nullable: false,
          element: { kind: 'leaf', codecId: 'throws-on-b@1', nullable: false },
        },
      },
    };
    await expect(
      decodeMongoRow({ tags: ['ok', 'bad'] }, shapeThrow, registry, 'col'),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      details: expect.objectContaining({ path: 'tags.1', collection: 'col' }),
    });
  });

  it('top-level non-object rows pass through unchanged', async () => {
    const registry = registryWithDefaults();
    const shape: MongoResultShape = { kind: 'document', fields: {} };
    expect(await decodeMongoRow(null, shape, registry, 'c')).toBe(null);
    expect(await decodeMongoRow('not-an-object', shape, registry, 'c')).toBe('not-an-object');
    expect(await decodeMongoRow(42, shape, registry, 'c')).toBe(42);
  });

  it('top-level kind unknown short-circuits the entire row', async () => {
    const registry = registryWithDefaults();
    const sentinel = { anything: true };
    const out = await decodeMongoRow(sentinel, { kind: 'unknown' }, registry, 'c');
    expect(out).toBe(sentinel);
  });

  it('document field whose driver value is not an object is yielded as-is', async () => {
    const registry = registryWithDefaults();
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        addr: {
          kind: 'document',
          nullable: false,
          fields: {
            city: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
          },
        },
      },
    };
    // A driver row where `addr` came back as an array (e.g. an unexpanded `$lookup` pre-`$unwind`) is yielded verbatim rather than walked into.
    const arrayRow = { addr: [{ city: 'X' }] };
    const arrayOut = await decodeMongoRow(arrayRow, shape, registry, 'c');
    expect(arrayOut).toEqual({ addr: [{ city: 'X' }] });
    // A primitive value at a `document`-shaped slot is yielded as-is too.
    const stringRow = { addr: 'inline-string' };
    const stringOut = await decodeMongoRow(stringRow, shape, registry, 'c');
    expect(stringOut).toEqual({ addr: 'inline-string' });
  });

  it('null and undefined at array-shaped slots short-circuit without iteration', async () => {
    const registry = registryWithDefaults();
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        nullableTags: {
          kind: 'array',
          nullable: true,
          element: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
        },
      },
    };
    const nullOut = await decodeMongoRow({ nullableTags: null }, shape, registry, 'c');
    expect(nullOut).toEqual({ nullableTags: null });
    const undefOut = await decodeMongoRow({ nullableTags: undefined }, shape, registry, 'c');
    expect(undefOut).toEqual({ nullableTags: undefined });
  });

  it('null and undefined at document-shaped slots short-circuit without recursion', async () => {
    const registry = registryWithDefaults();
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        addr: {
          kind: 'document',
          nullable: true,
          fields: {
            city: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
          },
        },
      },
    };
    const nullOut = await decodeMongoRow({ addr: null }, shape, registry, 'c');
    expect(nullOut).toEqual({ addr: null });
    const undefOut = await decodeMongoRow({ addr: undefined }, shape, registry, 'c');
    expect(undefOut).toEqual({ addr: undefined });
  });

  it('array field whose driver value is not an array is yielded as-is', async () => {
    const registry = registryWithDefaults();
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        tags: {
          kind: 'array',
          nullable: false,
          element: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
        },
      },
    };
    const row = { tags: 'not-actually-an-array' };
    const out = await decodeMongoRow(row, shape, registry, 'c');
    expect(out).toEqual({ tags: 'not-actually-an-array' });
  });

  it('coerces non-Error throw values into the wrapper message', async () => {
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'throws-string@1',
        encode: (v: string) => v,
        decode: () => {
          // Codec authors throwing a non-Error happens — the wrapper has to render something for the message. The cast is a deliberate exercise of `wrapDecodeFailure`'s `error instanceof Error` false-branch (pure type-system: `throw` accepts `unknown`).
          throw 'string-error' as unknown as Error;
        },
      }),
    );
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        f: { kind: 'leaf', codecId: 'throws-string@1', nullable: false },
      },
    };
    try {
      await decodeMongoRow({ f: 'wire' }, shape, registry, 'c');
      expect.fail('expected throw');
    } catch (e) {
      if (!isRuntimeError(e)) throw e;
      expect(e.message).toContain('string-error');
      expect(e.cause).toBe('string-error');
    }
  });

  it('serialises non-string wire values for wirePreview when decode throws', async () => {
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'throws@1',
        encode: (v: string) => v,
        decode: () => {
          throw new Error('boom');
        },
      }),
    );
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        f: { kind: 'leaf', codecId: 'throws@1', nullable: false },
      },
    };
    try {
      await decodeMongoRow({ f: { nested: 1 } }, shape, registry, 'c');
      expect.fail('expected throw');
    } catch (e) {
      if (!isRuntimeError(e)) throw e;
      const preview = (e.details as { wirePreview: string }).wirePreview;
      // String([object Object]) = '[object Object]'.
      expect(preview).toBe('[object Object]');
    }
  });

  it('truncates long string wirePreviews to 100 chars with an ellipsis', async () => {
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'throws@1',
        encode: (v: string) => v,
        decode: () => {
          throw new Error('boom');
        },
      }),
    );
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        f: { kind: 'leaf', codecId: 'throws@1', nullable: false },
      },
    };
    const longString = 'x'.repeat(200);
    try {
      await decodeMongoRow({ f: longString }, shape, registry, 'c');
      expect.fail('expected throw');
    } catch (e) {
      if (!isRuntimeError(e)) throw e;
      const preview = (e.details as { wirePreview: string }).wirePreview;
      expect(preview.length).toBe(103); // 100 chars + '...'
      expect(preview.endsWith('...')).toBe(true);
    }
  });

  it('passes through row fields the shape does not describe', async () => {
    // Polymorphic variants and sidecar fields the contract does not enumerate round-trip verbatim. The shape is a partial lane-vouched description; drop semantics belongs to projection, not to structural decode.
    const registry = registryWithDefaults();
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        type: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
      },
    };
    const row = {
      type: 'view-product',
      productId: 'prod-1',
      brand: 'TestBrand',
      sub: { nested: true },
    };
    const out = await decodeMongoRow(row, shape, registry, 'events');
    expect(out).toEqual(row);
    expect((out as { sub: object }).sub).toBe(row.sub);
  });

  it('passes through subdocument keys the nested document shape does not describe', async () => {
    // The pass-through invariant is structurally additive at every depth, not just the top level. A nested `kind: 'document'` slot decodes the keys its `fields` enumerates and round-trips the rest. ADR 209 promises future lane work threading concrete value-object subtrees is purely additive, which requires this.
    const registry = registryWithDefaults();
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        address: {
          kind: 'document',
          nullable: false,
          fields: {
            city: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
          },
        },
      },
    };
    const row = {
      address: { city: 'Paris', zip: '75001', country: 'FR' },
    };
    const out = await decodeMongoRow(row, shape, registry, 'users');
    const addr = (out as { address: { city: string; zip: string; country: string } }).address;
    expect(addr.city).toBe('Paris');
    expect(addr.zip).toBe('75001');
    expect(addr.country).toBe('FR');
  });

  it('passes values through for kind unknown anywhere in the tree', async () => {
    const registry = registryWithDefaults();
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        raw: { kind: 'unknown' },
      },
    };
    const sentinel = { x: 1 };
    const row = { raw: sentinel };
    const out = await decodeMongoRow(row, shape, registry, 'c');
    expect(out).toEqual({ raw: sentinel });
    expect((out as { raw: object }).raw).toBe(sentinel);
  });

  it('passes through when registry has no entry for codecId', async () => {
    const registry = newMongoCodecRegistry();
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        mystery: { kind: 'leaf', codecId: 'no/such@1', nullable: false },
      },
    };
    const row = { mystery: { keep: true } };
    const out = await decodeMongoRow(row, shape, registry, 'c');
    expect(out).toEqual(row);
  });

  it('wraps codec errors in RUNTIME.DECODE_FAILED with details and cause', async () => {
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'throws@1',
        encode: (v: string) => v,
        decode: () => {
          throw new Error('inner');
        },
      }),
    );
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        f: { kind: 'leaf', codecId: 'throws@1', nullable: false },
      },
    };
    try {
      await decodeMongoRow({ f: 'wire' }, shape, registry, 'items');
      expect.fail('expected throw');
    } catch (e) {
      expect(isRuntimeError(e)).toBe(true);
      if (!isRuntimeError(e)) return;
      expect(e.code).toBe('RUNTIME.DECODE_FAILED');
      expect(e.details).toMatchObject({
        collection: 'items',
        path: 'f',
        codec: 'throws@1',
      });
      expect(
        String((e.details as { wirePreview?: string }).wirePreview).length,
      ).toBeLessThanOrEqual(100);
      expect(e.cause).toBeInstanceOf(Error);
      expect((e.cause as Error).message).toBe('inner');
    }
  });

  it('adds the collection and field to a structured RUNTIME.DECODE_FAILED from a codec, keeping its details', async () => {
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        price: { kind: 'leaf', codecId: 'mongo/decimal128@1', nullable: false },
      },
    };
    try {
      await decodeMongoRow({ price: 19.99 }, shape, buildStandardCodecRegistry(), 'posts');
      expect.fail('expected throw');
    } catch (e) {
      expect(isRuntimeError(e)).toBe(true);
      if (!isRuntimeError(e)) return;
      expect({ code: e.code, message: e.message, details: e.details }).toEqual({
        code: 'RUNTIME.DECODE_FAILED',
        message:
          "Failed to decode field price in collection 'posts' with codec 'mongo/decimal128@1': mongo/decimal128@1 wire value must be a Decimal128",
        details: {
          codecId: 'mongo/decimal128@1',
          received: 'number',
          collection: 'posts',
          path: 'price',
          codec: 'mongo/decimal128@1',
          wirePreview: '19.99',
        },
      });
      expect(e.cause).toEqual(expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' }));
    }
  });

  it('passes any structured envelope from a codec through without wrapping', async () => {
    const envelope = structuredError('EXT.CODEC_BROKEN', 'extension codec envelope');
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'structured-ext@1',
        encode: (v: string) => v,
        decode: () => {
          throw envelope;
        },
      }),
    );
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        f: { kind: 'leaf', codecId: 'structured-ext@1', nullable: false },
      },
    };
    try {
      await decodeMongoRow({ f: 'wire' }, shape, registry, 'items');
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBe(envelope);
    }
  });

  it('dispatches all leaf decodes for one row via a single Promise.all', async () => {
    const dA = deferred<string>();
    const dB = deferred<string>();
    const callOrder: string[] = [];
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'slow-a@1',
        encode: (v: string) => v,
        decode: (w: string) => {
          callOrder.push('a-start');
          return dA.promise.then((s) => `${w}:${s}`);
        },
      }),
    );
    registry.register(
      mongoCodec({
        typeId: 'slow-b@1',
        encode: (v: string) => v,
        decode: (w: string) => {
          callOrder.push('b-start');
          return dB.promise.then((s) => `${w}:${s}`);
        },
      }),
    );
    const shape: MongoResultShape = {
      kind: 'document',
      fields: {
        a: { kind: 'leaf', codecId: 'slow-a@1', nullable: false },
        b: { kind: 'leaf', codecId: 'slow-b@1', nullable: false },
      },
    };
    const p = decodeMongoRow({ a: 'A', b: 'B' }, shape, registry, 'c');
    expect(callOrder).toEqual(['a-start', 'b-start']);
    dB.resolve('B2');
    dA.resolve('A2');
    const out = await p;
    expect(out).toEqual({ a: 'A:A2', b: 'B:B2' });
  });
});
