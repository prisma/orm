import {
  type CodecCallContext,
  type DataTypeValue,
  dataType,
  readJsonString,
} from '@internal/framework-components/codec';
import { mongoCodec, newMongoCodecRegistry } from '@internal/mongo-codec';
import { MongoParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import { resolveValue } from '../src/resolve-value';

const textType = dataType('test/text', { read: (json) => readJsonString('test/text', json) });

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

describe('resolveValue — CodecCallContext threading', () => {
  it('forwards the same ctx instance to every codec.toWire (root-level leaf)', async () => {
    const observed: (CodecCallContext | undefined)[] = [];
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'test/observe@1',
        fromWire: (w: string) => w,
        toWire: (v: string, ctx?: CodecCallContext) => {
          observed.push(ctx);
          return v;
        },
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      }),
    );

    const ctx: CodecCallContext = { signal: new AbortController().signal };
    await resolveValue(new MongoParamRef('hello', { codecId: 'test/observe@1' }), registry, ctx);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(ctx);
  });

  it('preserves ctx identity across nested object/array branches (recursive walk)', async () => {
    const observed: (CodecCallContext | undefined)[] = [];
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'test/observe-recursive@1',
        fromWire: (w: string) => w,
        toWire: (v: string, ctx?: CodecCallContext) => {
          observed.push(ctx);
          return v;
        },
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      }),
    );

    const doc = {
      a: new MongoParamRef('a', { codecId: 'test/observe-recursive@1' }),
      nested: {
        b: new MongoParamRef('b', { codecId: 'test/observe-recursive@1' }),
        deeper: [
          new MongoParamRef('c', { codecId: 'test/observe-recursive@1' }),
          new MongoParamRef('d', { codecId: 'test/observe-recursive@1' }),
        ],
      },
    };

    const ctx: CodecCallContext = { signal: new AbortController().signal };
    await resolveValue(doc, registry, ctx);

    expect(observed).toHaveLength(4);
    for (const seen of observed) {
      expect(seen).toBe(ctx);
    }
  });

  it('1-arg codec authors observe no behavioral change when the ctx has no signal', async () => {
    let invoked = 0;
    let receivedValue: unknown;
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'test/single-arg-author@1',
        fromWire: (w: string) => w,
        toWire: (v: string) => {
          invoked += 1;
          receivedValue = v;
          return v;
        },
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      }),
    );

    const result = await resolveValue(
      new MongoParamRef('x', { codecId: 'test/single-arg-author@1' }),
      registry,
      {},
    );
    expect(result).toBe('x');
    expect(invoked).toBe(1);
    expect(receivedValue).toBe('x');
  });

  it('already-aborted signal at entry short-circuits before any codec.encode call', async () => {
    let callCount = 0;
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'test/counter@1',
        fromWire: (w: string) => w,
        toWire: (v: string) => {
          callCount += 1;
          return v;
        },
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      }),
    );

    const controller = new AbortController();
    const reason = new Error('mongo encode short-circuit');
    controller.abort(reason);

    const doc = {
      a: new MongoParamRef('a', { codecId: 'test/counter@1' }),
      b: new MongoParamRef('b', { codecId: 'test/counter@1' }),
    };

    await expect(resolveValue(doc, registry, { signal: controller.signal })).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'encode' },
      cause: reason,
    });
    expect(callCount).toBe(0);
  });

  it('mid-encode abort surfaces RUNTIME.ABORTED { phase: encode } via the framework race helper', async () => {
    const release = deferred<string>();
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'test/blocking@1',
        fromWire: (w: string) => w,
        toWire: (v: string) => release.promise.then((suffix) => `${v}:${suffix}`),
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      }),
    );

    const controller = new AbortController();
    const reason = new Error('mid-encode abort (mongo)');
    const promise = resolveValue(
      { x: new MongoParamRef('v', { codecId: 'test/blocking@1' }) },
      registry,
      { signal: controller.signal },
    );

    queueMicrotask(() => controller.abort(reason));

    await expect(promise).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'encode' },
      cause: reason,
    });

    release.resolve('done');
  });

  it('passes RUNTIME.ENCODE_FAILED from a codec body through unchanged when the body throws before the runtime sees the abort', async () => {
    const cause = new Error('codec specific failure');
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'test/explody@1',
        fromWire: (w: string) => w,
        toWire: () => {
          throw cause;
        },
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      }),
    );

    await expect(
      resolveValue(new MongoParamRef('x', { codecId: 'test/explody@1' }), registry, {
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      cause,
    });
  });

  it('races each per-level Promise.all against the signal — abort wins even when sibling leaves block forever', async () => {
    const blockingLeaf = deferred<string>();
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'test/level-blocker@1',
        fromWire: (w: string) => w,
        toWire: (v: string) => blockingLeaf.promise.then((s) => `${v}:${s}`),
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      }),
    );

    const controller = new AbortController();
    const reason = new Error('level race wins');

    // Top-level object with two leaves at the same level — Promise.all races against the abort signal at this level.
    const doc = {
      a: new MongoParamRef('a', { codecId: 'test/level-blocker@1' }),
      b: new MongoParamRef('b', { codecId: 'test/level-blocker@1' }),
    };
    const promise = resolveValue(doc, registry, { signal: controller.signal });

    queueMicrotask(() => controller.abort(reason));

    await expect(promise).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'encode' },
      cause: reason,
    });

    blockingLeaf.resolve('done');
  });

  it('races inside arrays too — abort wins even when array leaves block forever', async () => {
    const blockingLeaf = deferred<string>();
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'test/array-blocker@1',
        fromWire: (w: string) => w,
        toWire: (v: string) => blockingLeaf.promise.then((s) => `${v}:${s}`),
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      }),
    );

    const controller = new AbortController();
    const reason = new Error('array race wins');
    const arr = [
      new MongoParamRef('a', { codecId: 'test/array-blocker@1' }),
      new MongoParamRef('b', { codecId: 'test/array-blocker@1' }),
    ];

    const promise = resolveValue(arr, registry, { signal: controller.signal });
    queueMicrotask(() => controller.abort(reason));

    await expect(promise).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'encode' },
      cause: reason,
    });

    blockingLeaf.resolve('done');
  });
});
