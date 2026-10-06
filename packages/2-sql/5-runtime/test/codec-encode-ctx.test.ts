import { coreHash } from '@internal/contract/types';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  type Codec,
  ColumnRef,
  ParamRef,
  SelectAst,
  type SqlCodecCallContext,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { describe, expect, it } from 'vitest';
import { encodeParam, encodeParams } from '../src/codecs/encoding';
import { defineTestCodec } from './test-codec';
import { buildTestContractCodecs } from './utils';

const TEST_HASH = coreHash('test');

interface ParamSpec {
  readonly value: unknown;
  readonly codecId?: string;
  readonly name?: string;
}

function paramRefFromSpec(spec: ParamSpec): ParamRef {
  const options: { name?: string; codec?: { codecId: string } } = {};
  if (spec.name !== undefined) options.name = spec.name;
  if (spec.codecId !== undefined) options.codec = { codecId: spec.codecId };
  return ParamRef.of(spec.value, options);
}

function buildPlan(params: readonly ParamSpec[]): SqlExecutionPlan {
  const refs = params.map(paramRefFromSpec);
  let ast = SelectAst.from(TableSource.named('user'));
  if (refs.length > 0) {
    const eqs: AnyExpression[] = refs.map((ref) =>
      BinaryExpr.eq(ColumnRef.of('user', ref.name ?? 'id'), ref),
    );
    ast = ast.withWhere(eqs.length === 1 ? eqs[0]! : AndExpr.of(eqs));
  }

  return {
    sql: 'SELECT 1',
    params: refs.map((ref) => ref.value),
    ast,
    meta: {
      target: 'postgres',
      storageHash: TEST_HASH,
      lane: 'dsl',
    },
  };
}

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

describe('encodeParams — SqlCodecCallContext threading', () => {
  it('forwards the same ctx instance to every per-param codec.encode', async () => {
    const observed: (SqlCodecCallContext | undefined)[] = [];
    const registry = [
      defineTestCodec({
        typeId: 'test/observe@1',
        encode: (value: string, ctx?: SqlCodecCallContext) => {
          observed.push(ctx);
          return value;
        },
        decode: (wire: string) => wire,
      }),
    ];

    const p = buildPlan([
      { value: 'a', codecId: 'test/observe@1', name: 'p0' },
      { value: 'b', codecId: 'test/observe@1', name: 'p1' },
      { value: 'c', codecId: 'test/observe@1', name: 'p2' },
    ]);

    const controller = new AbortController();
    const ctx: SqlCodecCallContext = { signal: controller.signal };
    await encodeParams(p, ctx, buildTestContractCodecs(registry));

    expect(observed).toHaveLength(3);
    for (const seen of observed) {
      expect(seen).toBe(ctx);
    }
  });

  it('leaves ctx.column undefined on encode call sites (encode-time column-context is the middleware domain)', async () => {
    let observed: SqlCodecCallContext | undefined;
    const registry = [
      defineTestCodec({
        typeId: 'test/observe-column@1',
        encode: (value: string, ctx?: SqlCodecCallContext) => {
          observed = ctx;
          return value;
        },
        decode: (wire: string) => wire,
      }),
    ];

    const p = buildPlan([{ value: 'x', codecId: 'test/observe-column@1' }]);

    await encodeParams(
      p,
      { signal: new AbortController().signal },
      buildTestContractCodecs(registry),
    );
    expect(observed?.column).toBeUndefined();
  });

  it('regression — omitting ctx is bit-for-bit identical to today (no-ctx case)', async () => {
    const registry = [
      defineTestCodec({
        typeId: 'test/passthrough@1',
        encode: (value: string) => `wire:${value}`,
        decode: (wire: string) => wire,
      }),
    ];

    const p = buildPlan([
      { value: 'x', codecId: 'test/passthrough@1' },
      { value: 'y', codecId: 'test/passthrough@1' },
    ]);

    expect(await encodeParams(p, {}, buildTestContractCodecs(registry))).toEqual([
      'wire:x',
      'wire:y',
    ]);
  });

  it('already-aborted signal at entry short-circuits before any codec call', async () => {
    let callCount = 0;
    const registry = [
      defineTestCodec({
        typeId: 'test/counter@1',
        encode: (value: string) => {
          callCount += 1;
          return value;
        },
        decode: (wire: string) => wire,
      }),
    ];

    const p = buildPlan([
      { value: 'a', codecId: 'test/counter@1' },
      { value: 'b', codecId: 'test/counter@1' },
    ]);

    const controller = new AbortController();
    const reason = new Error('user cancelled');
    controller.abort(reason);

    await expect(
      encodeParams(p, { signal: controller.signal }, buildTestContractCodecs(registry)),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'encode' },
      cause: reason,
    });
    expect(callCount).toBe(0);
  });

  it('already-aborted signal short-circuits even for empty param lists', async () => {
    const registry: ReadonlyArray<Codec<string>> = [];
    const controller = new AbortController();
    const reason = new Error('encode short-circuit');
    controller.abort(reason);

    await expect(
      encodeParams(buildPlan([]), { signal: controller.signal }, buildTestContractCodecs(registry)),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'encode' },
      cause: reason,
    });
  });

  it('mid-encode abort surfaces RUNTIME.ABORTED { phase: encode } via abortable race', async () => {
    const release = deferred<string>();
    const registry = [
      defineTestCodec({
        typeId: 'test/blocking@1',
        encode: (value: string) => release.promise.then((suffix) => `${value}:${suffix}`),
        decode: (wire: string) => wire,
      }),
    ];

    const p = buildPlan([{ value: 'v', codecId: 'test/blocking@1' }]);

    const controller = new AbortController();
    const reason = new Error('mid-encode abort');
    const promise = encodeParams(
      p,
      { signal: controller.signal },
      buildTestContractCodecs(registry),
    );

    // Let the codec start, then abort.
    queueMicrotask(() => controller.abort(reason));

    await expect(promise).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'encode' },
      cause: reason,
    });

    // Release the in-flight body so the test can clean up; cooperative cancellation lets it complete in the background without leaks.
    release.resolve('done');
  });

  it('passes through RUNTIME.ENCODE_FAILED when the codec body throws before the runtime sees the abort (no double-wrap)', async () => {
    const cause = new Error('codec specific failure');
    const registry = [
      defineTestCodec({
        typeId: 'test/explody@1',
        encode: () => {
          throw cause;
        },
        decode: (wire: string) => wire,
      }),
    ];

    const p = buildPlan([{ value: 'x', codecId: 'test/explody@1' }]);

    await expect(
      encodeParams(p, { signal: new AbortController().signal }, buildTestContractCodecs(registry)),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      cause,
    });
  });
});

describe('encodeParam — ctx forwarded to codec.encode', () => {
  it('forwards ctx (signal) to a codec body that accepts (value, ctx)', async () => {
    let observedSignal: AbortSignal | undefined;
    const registry = [
      defineTestCodec({
        typeId: 'test/single-cell@1',
        encode: (value: string, ctx?: SqlCodecCallContext) => {
          observedSignal = ctx?.signal;
          return value;
        },
        decode: (wire: string) => wire,
      }),
    ];

    const controller = new AbortController();
    await encodeParam(
      'x',
      { codec: { codecId: 'test/single-cell@1' } },
      0,
      { signal: controller.signal },
      buildTestContractCodecs(registry),
    );

    expect(observedSignal).toBe(controller.signal);
  });

  it('null/undefined values still bypass the codec when ctx is provided', async () => {
    const registry = [
      defineTestCodec({
        typeId: 'test/never@1',
        encode: () => {
          throw new Error('must not be invoked for null/undefined');
        },
        decode: (wire: string) => wire,
      }),
    ];

    const ctx: SqlCodecCallContext = { signal: new AbortController().signal };
    await expect(
      encodeParam(
        null,
        { codec: { codecId: 'test/never@1' } },
        0,
        ctx,
        buildTestContractCodecs(registry),
      ),
    ).resolves.toBeNull();
    await expect(
      encodeParam(
        undefined,
        { codec: { codecId: 'test/never@1' } },
        0,
        ctx,
        buildTestContractCodecs(registry),
      ),
    ).resolves.toBeNull();
  });
});
