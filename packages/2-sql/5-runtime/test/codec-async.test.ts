import type { JsonValue } from '@internal/contract/types';
import { coreHash } from '@internal/contract/types';
import { runtimeError } from '@internal/framework-components/runtime';
import type { Codec } from '@internal/sql-relational-core/ast';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  buildDecodeContext,
  decodeRow as decodeRowBase,
  sqlNativeArrayListDecoder,
} from '../src/codecs/decoding';
import { encodeParams } from '../src/codecs/encoding';
import { createAsyncSecretCodec, decryptSecret, encryptSecret } from './seeded-secret-codec';
import { defineTestCodec } from './test-codec';
import { buildTestContractCodecs, stubAst } from './utils';

// ============================================================================= Shared helpers — AST-backed plans (ADR 205) =============================================================================

function decodeRow(
  row: Parameters<typeof decodeRowBase>[0],
  decodeCtx: Parameters<typeof decodeRowBase>[1],
  rowCtx: Parameters<typeof decodeRowBase>[2],
  listDecoder: Parameters<typeof decodeRowBase>[3] = sqlNativeArrayListDecoder,
): ReturnType<typeof decodeRowBase> {
  return decodeRowBase(row, decodeCtx, rowCtx, listDecoder);
}

interface ParamSpec {
  readonly value: unknown;
  readonly codecId?: string;
  readonly name?: string;
}

interface ProjectionSpec {
  readonly alias: string;
  readonly codecId?: string;
  readonly column?: { table: string; column: string };
}

const TEST_HASH = coreHash('test');

function paramRefFromSpec(spec: ParamSpec): ParamRef {
  const options: { name?: string; codec?: { codecId: string } } = {};
  if (spec.name !== undefined) options.name = spec.name;
  if (spec.codecId !== undefined) options.codec = { codecId: spec.codecId };
  return ParamRef.of(spec.value, options);
}

function projectionFromSpec(spec: ProjectionSpec): ProjectionItem {
  const ref = spec.column ?? { table: 'user', column: spec.alias };
  return ProjectionItem.of(
    spec.alias,
    ColumnRef.of(ref.table, ref.column),
    spec.codecId ? { codecId: spec.codecId } : undefined,
  );
}

function buildAstPlan(options: {
  params?: readonly ParamSpec[];
  projections?: readonly ProjectionSpec[];
}): SqlExecutionPlan {
  const refs = (options.params ?? []).map(paramRefFromSpec);
  const projections = (options.projections ?? []).map(projectionFromSpec);

  let ast = SelectAst.from(TableSource.named('user'));
  if (projections.length > 0) {
    ast = ast.withProjection(projections);
  }
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

function buildRawPlan(params: readonly unknown[] = []): SqlExecutionPlan {
  return {
    sql: 'SELECT 1',
    params: [...params],
    ast: stubAst(),
    meta: {
      target: 'postgres',
      storageHash: TEST_HASH,
      lane: 'raw',
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

// ============================================================================= encodeParams: concurrent dispatch + envelope (AST-backed plans) =============================================================================

describe('encodeParams — async, concurrent dispatch', () => {
  it('dispatches mixed sync/async parameter codecs concurrently via Promise.all', async () => {
    const dA = deferred<string>();
    const dB = deferred<string>();
    const callOrder: string[] = [];

    const registry = [
      defineTestCodec({
        typeId: 'test/async-a@1',
        targetTypes: ['text'],
        encode: (value: string) => {
          callOrder.push('encode-a-start');
          return dA.promise.then((wire) => `${value}:${wire}`);
        },
        decode: (wire: string) => wire,
      }),
      defineTestCodec({
        typeId: 'test/async-b@1',
        targetTypes: ['text'],
        encode: (value: string) => {
          callOrder.push('encode-b-start');
          return dB.promise.then((wire) => `${value}:${wire}`);
        },
        decode: (wire: string) => wire,
      }),
      defineTestCodec({
        typeId: 'test/sync@1',
        targetTypes: ['int4'],
        encode: (value: number) => {
          callOrder.push('encode-sync');
          return value + 1;
        },
        decode: (wire: number) => wire,
      }),
    ];

    const plan = buildAstPlan({
      params: [
        { value: 'alpha', codecId: 'test/async-a@1', name: 'a' },
        { value: 'bravo', codecId: 'test/async-b@1', name: 'b' },
        { value: 41, codecId: 'test/sync@1', name: 'n' },
      ],
    });

    const promise = encodeParams(plan, {}, buildTestContractCodecs(registry));

    expect(callOrder).toEqual(['encode-a-start', 'encode-b-start', 'encode-sync']);

    dB.resolve('B-WIRE');
    dA.resolve('A-WIRE');

    const result = await promise;
    expect([...result]).toEqual(['alpha:A-WIRE', 'bravo:B-WIRE', 42]);
  });

  it('always awaits codec.encode (no Promise leaks into the driver)', async () => {
    const registry = [
      defineTestCodec({
        typeId: 'test/async@1',
        targetTypes: ['text'],
        encode: async (value: string) => `wire:${value}`,
        decode: async (wire: string) => wire,
      }),
    ];

    const plan = buildAstPlan({
      params: [{ value: 'hello', codecId: 'test/async@1' }],
    });

    const result = await encodeParams(plan, {}, buildTestContractCodecs(registry));
    const first = result[0];
    expect(typeof (first as { then?: unknown } | null | undefined)?.then).toBe('undefined');
    expect(first).toBe('wire:hello');
  });

  it('wraps encode failures in RUNTIME.ENCODE_FAILED with { label, codec, paramIndex } and cause', async () => {
    const cause = new Error('boom');
    const registry = [
      defineTestCodec({
        typeId: 'test/explody@1',
        targetTypes: ['text'],
        encode: () => {
          throw cause;
        },
        decode: (wire: string) => wire,
      }),
    ];

    const plan = buildAstPlan({
      params: [{ value: 'bad', codecId: 'test/explody@1', name: 'pname' }],
    });

    await expect(encodeParams(plan, {}, buildTestContractCodecs(registry))).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      category: 'RUNTIME',
      severity: 'error',
      details: {
        label: 'pname',
        codec: 'test/explody@1',
        paramIndex: 0,
      },
      cause,
    });
  });

  it('uses param[<i>] label when ParamRef has no name', async () => {
    const registry = [
      defineTestCodec({
        typeId: 'test/explody@1',
        targetTypes: ['text'],
        encode: () => {
          throw new Error('boom');
        },
        decode: (wire: string) => wire,
      }),
    ];

    const plan = buildAstPlan({
      params: [{ value: 'x', codecId: 'test/explody@1' }],
    });

    await expect(encodeParams(plan, {}, buildTestContractCodecs(registry))).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      details: { label: 'param[0]' },
    });
  });

  it('returns null for null/undefined parameter values without invoking the codec', async () => {
    const registry = [
      defineTestCodec({
        typeId: 'test/sync@1',
        targetTypes: ['text'],
        encode: () => {
          throw new Error('codec must not be invoked for null/undefined');
        },
        decode: (wire: string) => wire,
      }),
    ];

    const plan = buildAstPlan({
      params: [
        { value: null, codecId: 'test/sync@1', name: 'a' },
        { value: undefined, codecId: 'test/sync@1', name: 'b' },
      ],
    });

    const result = await encodeParams(plan, {}, buildTestContractCodecs(registry));
    expect([...result]).toEqual([null, null]);
  });

  it('throws RUNTIME.CODEC_DESCRIPTOR_MISSING when codec is registered on ParamRef but absent from registry', async () => {
    const registry: ReadonlyArray<Codec<string>> = [];
    const plan = buildAstPlan({
      params: [{ value: 'raw', codecId: 'test/missing@1' }],
    });
    await expect(encodeParams(plan, {}, buildTestContractCodecs(registry))).rejects.toMatchObject({
      code: 'RUNTIME.CODEC_DESCRIPTOR_MISSING',
    });
  });

  it('passes parameters through unchanged for raw plans (no AST, no codec encoding)', async () => {
    const registry = [
      defineTestCodec({
        typeId: 'test/should-not-run@1',
        targetTypes: ['text'],
        encode: () => {
          throw new Error('raw plans must skip codec encoding');
        },
        decode: (wire: string) => wire,
      }),
    ];

    const plan = buildRawPlan(['Alice', 42]);
    const result = await encodeParams(plan, {}, buildTestContractCodecs(registry));
    expect([...result]).toEqual(['Alice', 42]);
  });

  it('encodes a fully-typed AST-backed plan without throwing', async () => {
    const registry = [
      defineTestCodec({
        typeId: 'test/passthrough@1',
        targetTypes: ['text'],
        encode: (value: string) => `wire:${value}`,
        decode: (wire: string) => wire,
      }),
    ];

    const plan = buildAstPlan({
      params: [
        { value: 'x', codecId: 'test/passthrough@1', name: 'x' },
        { value: 'y', codecId: 'test/passthrough@1', name: 'y' },
      ],
    });

    const encoded = await encodeParams(plan, {}, buildTestContractCodecs(registry));
    expect([...encoded]).toEqual(['wire:x', 'wire:y']);
  });
});

// ============================================================================= decodeRow / decodeField: concurrent per-cell + envelope + JSON validation =============================================================================

describe('decodeRow — async, concurrent per-cell dispatch', () => {
  it('dispatches per-cell decoders concurrently via Promise.all', async () => {
    const dA = deferred<string>();
    const dB = deferred<string>();
    const callOrder: string[] = [];

    const registry = [
      defineTestCodec({
        typeId: 'test/slow-a@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (w: string) => {
          callOrder.push('decode-a-start');
          return dA.promise.then((suffix) => `${w}:${suffix}`);
        },
      }),
      defineTestCodec({
        typeId: 'test/slow-b@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (w: string) => {
          callOrder.push('decode-b-start');
          return dB.promise.then((suffix) => `${w}:${suffix}`);
        },
      }),
      defineTestCodec({
        typeId: 'test/sync@1',
        targetTypes: ['int4'],
        encode: (v: number) => v,
        decode: (w: number) => {
          callOrder.push('decode-sync');
          return w * 2;
        },
      }),
    ];

    const plan = buildAstPlan({
      projections: [
        { alias: 'a', codecId: 'test/slow-a@1' },
        { alias: 'b', codecId: 'test/slow-b@1' },
        { alias: 'n', codecId: 'test/sync@1' },
      ],
    });

    const row = { a: 'A', b: 'B', n: 21 };
    const promise = decodeRow(
      row,
      buildDecodeContext(plan.ast, buildTestContractCodecs(registry)),
      {},
    );

    expect(callOrder).toEqual(['decode-a-start', 'decode-b-start', 'decode-sync']);

    dB.resolve('B-DEC');
    dA.resolve('A-DEC');

    const result = await promise;
    expect(result).toEqual({ a: 'A:A-DEC', b: 'B:B-DEC', n: 42 });
  });

  it('always awaits codec.decode and yields plain values (no Promise leaks)', async () => {
    const registry = [
      defineTestCodec({
        typeId: 'test/async@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: async (w: string) => `decoded:${w}`,
      }),
    ];

    const plan = buildAstPlan({
      projections: [{ alias: 'name', codecId: 'test/async@1' }],
    });

    const result = await decodeRow(
      { name: 'alice' },
      buildDecodeContext(plan.ast, buildTestContractCodecs(registry)),
      {},
    );
    expect(typeof (result['name'] as { then?: unknown } | null)?.then).toBe('undefined');
    expect(result['name']).toBe('decoded:alice');
  });

  it('codec.decode that throws JSON-Schema validation envelope passes the runtime envelope through unchanged', async () => {
    // Validation lives in the resolved codec's `decode` body (e.g. arktype-json validates against its rehydrated schema and throws `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` directly). The runtime no longer maintains a parallel validator registry. Codec-authored runtime envelopes (DECODE_FAILED, ABORTED, JSON_SCHEMA_VALIDATION_FAILED, …) carry their own per-codec context, so `decodeField` rethrows them unchanged instead of coercing them into a fresh `RUNTIME.DECODE_FAILED` (which would erase the original code and details).
    const registry = [
      defineTestCodec<'pg/inline-validating-json@1', readonly [], string, JsonValue>({
        typeId: 'pg/inline-validating-json@1',
        targetTypes: ['jsonb'],
        encode: (v: JsonValue) => JSON.stringify(v),
        decode: async (w: string) => {
          const parsed = JSON.parse(w) as Record<string, unknown>;
          if (!('name' in parsed)) {
            throw runtimeError(
              'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
              "JSON validation failed: must have required property 'name'",
              { issues: "must have required property 'name'" },
            );
          }
          return parsed as JsonValue;
        },
      }),
    ];

    const plan = buildAstPlan({
      projections: [
        {
          alias: 'metadata',
          codecId: 'pg/inline-validating-json@1',
          column: { table: 'user', column: 'metadata' },
        },
      ],
    });

    const ok = await decodeRow(
      { metadata: '{"name":"alice"}' },
      buildDecodeContext(plan.ast, buildTestContractCodecs(registry)),
      {},
    );
    expect(ok['metadata']).toEqual({ name: 'alice' });

    const rejection = (await decodeRow(
      { metadata: '{"age":30}' },
      buildDecodeContext(plan.ast, buildTestContractCodecs(registry)),
      {},
    ).catch((e: unknown) => e)) as Error & {
      code?: string;
      details?: { issues?: unknown };
    };
    expect(rejection.code).toBe('RUNTIME.JSON_SCHEMA_VALIDATION_FAILED');
    expect(rejection.details?.issues).toBe("must have required property 'name'");
  });

  it('wraps decode failures in RUNTIME.DECODE_FAILED with { table, column, codec } and cause', async () => {
    const cause = new Error('boom');
    const registry = [
      defineTestCodec({
        typeId: 'test/explody@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: () => {
          throw cause;
        },
      }),
    ];

    const plan = buildAstPlan({
      projections: [
        {
          alias: 'explody',
          codecId: 'test/explody@1',
          column: { table: 'user', column: 'payload' },
        },
      ],
    });

    await expect(
      decodeRow(
        { explody: 'wire' },
        buildDecodeContext(plan.ast, buildTestContractCodecs(registry)),
        {},
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      category: 'RUNTIME',
      severity: 'error',
      details: {
        table: 'user',
        column: 'payload',
        codec: 'test/explody@1',
      },
      cause,
    });
  });

  it('passes wire values through for raw plans (no AST, no codec decoding)', async () => {
    const registry = [
      defineTestCodec({
        typeId: 'test/should-not-run@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: () => {
          throw new Error('raw plans must skip codec decoding');
        },
      }),
    ];

    const plan = buildRawPlan();
    const result = await decodeRow(
      { id: 1, email: 'a@b.com' },
      buildDecodeContext(plan.ast, buildTestContractCodecs(registry)),
      {},
    );
    expect(result).toEqual({ id: 1, email: 'a@b.com' });
  });

  it('throws RUNTIME.DECODE_FAILED for AST-backed plan when row is missing a projection alias', async () => {
    const registry: ReadonlyArray<Codec<string>> = [];
    const plan = buildAstPlan({
      projections: [{ alias: 'id' }, { alias: 'email' }],
    });

    await expect(
      decodeRow({ id: 1 }, buildDecodeContext(plan.ast, buildTestContractCodecs(registry)), {}),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      details: {
        alias: 'email',
        expectedAliases: ['id', 'email'],
        presentKeys: ['id'],
      },
    });
  });

  it('preserves wire null for AST-backed plans (distinct from missing alias)', async () => {
    const registry = [
      defineTestCodec({
        typeId: 'test/should-not-run@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: () => {
          throw new Error('codec must not be invoked for null wire values');
        },
      }),
    ];
    const plan = buildAstPlan({
      projections: [{ alias: 'id', codecId: 'test/should-not-run@1' }],
    });

    const result = await decodeRow(
      { id: null },
      buildDecodeContext(plan.ast, buildTestContractCodecs(registry)),
      {},
    );
    expect(result).toEqual({ id: null });
  });

  it('decodeField is single-armed: same path for sync and async codec authors', async () => {
    const buildCodec = (
      id: string,
      encode: (value: string) => string,
      decode: (wire: string) => string | Promise<string>,
    ): Codec<string> =>
      defineTestCodec<string, readonly [], string, string>({
        typeId: id,
        targetTypes: ['text'],
        encode,
        decode,
      });

    const registry = [
      buildCodec(
        'sync@1',
        (v) => v,
        (w) => `sync:${String(w)}`,
      ),
      buildCodec(
        'async@1',
        (v) => v,
        async (w) => `async:${String(w)}`,
      ),
    ];

    const plan = buildAstPlan({
      projections: [
        { alias: 'syncCol', codecId: 'sync@1' },
        { alias: 'asyncCol', codecId: 'async@1' },
      ],
    });

    const result = await decodeRow(
      { syncCol: 'a', asyncCol: 'b' },
      buildDecodeContext(plan.ast, buildTestContractCodecs(registry)),
      {},
    );
    expect(result).toEqual({ syncCol: 'sync:a', asyncCol: 'async:b' });
  });
});

// ============================================================================= seeded-secret-codec — realistic crypto roundtrip + envelopes =============================================================================

describe('seeded-secret-codec — realistic crypto path against the runtime', () => {
  const seed = 'codec-async-test-seed';

  it('encodeParams encrypts plaintext via async codec.encode (no Promise leaks)', {
    timeout: timeouts.databaseOperation,
  }, async () => {
    const registry = [createAsyncSecretCodec({ typeId: 'pg/secret@1', seed })];

    const plan = buildAstPlan({
      params: [{ value: 'Alice', codecId: 'pg/secret@1', name: 'secret' }],
    });

    const result = await encodeParams(plan, {}, buildTestContractCodecs(registry));
    const wire = result[0];
    expect(typeof wire).toBe('string');
    expect(wire).not.toBe('Alice');
    await expect(decryptSecret(wire as string, seed)).resolves.toBe('Alice');
  });

  it('decodeRow decrypts ciphertext via async codec.decode and yields plain values', {
    timeout: timeouts.databaseOperation,
  }, async () => {
    const registry = [createAsyncSecretCodec({ typeId: 'pg/secret@1', seed })];

    const wire = await encryptSecret('top-secret', seed);
    const plan = buildAstPlan({
      projections: [
        {
          alias: 'secret',
          codecId: 'pg/secret@1',
          column: { table: 'user', column: 'secret' },
        },
      ],
    });

    const result = await decodeRow(
      { secret: wire },
      buildDecodeContext(plan.ast, buildTestContractCodecs(registry)),
      {},
    );
    expect(result['secret']).toBe('top-secret');
  });

  it('decode failures from async crypto are wrapped in RUNTIME.DECODE_FAILED with cause', async () => {
    const registry = [createAsyncSecretCodec({ typeId: 'pg/secret@1', seed })];

    const plan = buildAstPlan({
      projections: [
        {
          alias: 'secret',
          codecId: 'pg/secret@1',
          column: { table: 'user', column: 'secret' },
        },
      ],
    });

    const rejection = await decodeRow(
      { secret: 'bad-payload' },
      buildDecodeContext(plan.ast, buildTestContractCodecs(registry)),
      {},
    ).catch((e: unknown) => e);
    expect(rejection).toBeInstanceOf(Error);
    const err = rejection as Error & {
      code?: string;
      details?: { table?: string; column?: string; codec?: string; wirePreview?: string };
      cause?: unknown;
    };
    expect(err.code).toBe('RUNTIME.DECODE_FAILED');
    expect(err.details).toMatchObject({
      table: 'user',
      column: 'secret',
      codec: 'pg/secret@1',
      wirePreview: 'bad-payload',
    });
    expect((err.cause as Error | undefined)?.message).toBe('invalid secret payload');
  });
});
