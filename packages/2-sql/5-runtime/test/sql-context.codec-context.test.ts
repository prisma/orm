import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import type { CodecDescriptor } from '@internal/framework-components/codec';
import { dataTypeId, voidParamsSchema } from '@internal/framework-components/codec';
import { SqlStorage, type StorageTable } from '@internal/sql-contract/types';
import type { Codec, SqlCodecInstanceContext } from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type { SqlRuntimeExtensionDescriptor } from '../src/sql-context';
import { createStubAdapter, createTestContext } from './utils';

/**
 * `forColumn(table, column)` dispatch materializes a shared codec instance keyed by `(codecId, typeParams)` and exposes it through a `SqlCodecInstanceContext` whose `name` carries the shared marker (`<codec:codecId>`, `<col:Table.column>`, or the `storage.types` alias). Multiple columns whose `CodecRef`s canonicalize to the same key share that single instance and aggregate their sites into `usedAt`.
 */
describe('buildContractCodecRegistry — per-column codec instance context', () => {
  function createCtxCapturingExtension(captures: SqlCodecInstanceContext[]): {
    descriptor: SqlRuntimeExtensionDescriptor<'postgres'>;
    instances: Array<{ ctx: SqlCodecInstanceContext; codec: Codec }>;
  } {
    const instances: Array<{ ctx: SqlCodecInstanceContext; codec: Codec }> = [];
    const codecDescriptor: CodecDescriptor<void> = {
      codecId: 'test/captures-ctx@1',
      dataType: dataTypeId('test/captures-ctx'),
      traits: [],
      targetTypes: ['captures'],
      paramsSchema: voidParamsSchema,
      isParameterized: false,
      // Family-agnostic descriptor slot; SQL-side test consumer reads `usedAt` so the factory parameter is typed as the SQL-extended context. The cast through `unknown` mirrors what production SQL extensions do (see pgvector's family-agnostic factory cast).
      factory: ((_params: undefined) => (ctx: SqlCodecInstanceContext) => {
        captures.push(ctx);
        const codec: Codec = {
          id: 'test/captures-ctx@1',
          encode: (v: unknown) => Promise.resolve(v),
          decode: (w: unknown) => Promise.resolve(w),
          encodeJson: (v) => v as never,
          decodeJson: (j) => j as never,
        };
        instances.push({ ctx, codec });
        return codec;
      }) as unknown as CodecDescriptor<void>['factory'],
    };

    return {
      descriptor: {
        kind: 'extension' as const,
        id: 'test-captures-ctx',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => [codecDescriptor],
        create() {
          return { familyId: 'sql' as const, targetId: 'postgres' as const };
        },
      },
      instances,
    };
  }

  function contractWith(
    columns: Record<string, { codecId: string; nativeType: string }>,
  ): Contract<SqlStorage> {
    const tables: Record<string, StorageTable> = {};
    for (const [tableName, columnSpec] of Object.entries(columns)) {
      tables[tableName] = {
        columns: {
          field: {
            nativeType: columnSpec.nativeType,
            codecId: columnSpec.codecId,
            nullable: false,
          },
        },
        primaryKey: { columns: ['field'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };
    }

    return {
      targetFamily: 'sql',
      target: 'postgres',
      profileHash: profileHash('test'),
      domain: applicationDomainOf({ models: {} }),
      roots: {},
      storage: new SqlStorage({
        storageHash: coreHash('test'),
        namespaces: {
          __unbound__: createTestSqlNamespace({ id: '__unbound__', entries: { table: tables } }),
        },
      }),
      extensions: {},
      capabilities: {},
      meta: {},
    };
  }

  it('materializes a shared per-codec instance with `<codec:codecId>` context for a single non-parameterized column', () => {
    const captures: SqlCodecInstanceContext[] = [];
    const { descriptor, instances } = createCtxCapturingExtension(captures);

    const contract = contractWith({
      users: { codecId: 'test/captures-ctx@1', nativeType: 'captures' },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [descriptor],
    });

    const columnInstance = context.contractCodecs.forColumn('__unbound__', 'users', 'field');
    expect(columnInstance).toBeDefined();

    const columnCtx = instances.find(({ codec }) => codec === columnInstance)?.ctx;
    expect(columnCtx).toBeDefined();
    expect(columnCtx?.name).toBe('<codec:test/captures-ctx@1>');
    expect(columnCtx?.usedAt).toEqual([{ table: 'users', column: 'field' }]);
  });
});

/**
 * `forCodecRef` is the sole AST-bound dispatch surface: every codec-bearing AST node carries a {@link CodecRef} and the runtime resolves through this method via the per-`ExecutionContext` `AstCodecResolver`.
 */
describe('buildContractCodecRegistry — forCodecRef content-keyed cache', () => {
  function createCountingVectorExtension(): {
    descriptor: SqlRuntimeExtensionDescriptor<'postgres'>;
    factoryCalls: () => number;
  } {
    let factoryCalls = 0;
    const codecDescriptor: CodecDescriptor<{ length: number }> = {
      codecId: 'pgvector/vector@1',
      dataType: dataTypeId('pgvector/vector'),
      traits: ['equality'],
      targetTypes: ['vector'],
      paramsSchema: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: (value) => ({ value: value as { length: number } }),
        },
      },
      isParameterized: true,
      factory: ((params: { length: number }) => (ctx: SqlCodecInstanceContext) => {
        factoryCalls += 1;
        const codec: Codec = {
          id: 'pgvector/vector@1',
          encode: (v: unknown) => Promise.resolve(v),
          decode: (w: unknown) => Promise.resolve(w),
          encodeJson: (v) => v as never,
          decodeJson: (j) => j as never,
        };
        return Object.assign({}, codec, {
          meta: { length: params.length, ctxName: ctx.name },
        }) as Codec;
      }) as unknown as CodecDescriptor<{ length: number }>['factory'],
    };

    return {
      descriptor: {
        kind: 'extension' as const,
        id: 'pgvector-test',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => [codecDescriptor as unknown as CodecDescriptor],
        create() {
          return { familyId: 'sql' as const, targetId: 'postgres' as const };
        },
      },
      factoryCalls: () => factoryCalls,
    };
  }

  function contractWithVector(
    columns: Record<string, { typeRef?: string; typeParams?: { length: number } }>,
    types?: Record<string, { length: number }>,
  ): Contract<SqlStorage> {
    const tables: Record<string, StorageTable> = {};
    for (const [tableName, spec] of Object.entries(columns)) {
      tables[tableName] = {
        columns: {
          embedding: {
            nativeType: 'vector',
            codecId: 'pgvector/vector@1',
            nullable: false,
            ...ifDefined('typeRef', spec.typeRef),
            ...ifDefined('typeParams', spec.typeParams),
          },
        },
        primaryKey: { columns: ['embedding'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };
    }

    const storage = new SqlStorage({
      storageHash: coreHash('test'),
      namespaces: {
        __unbound__: createTestSqlNamespace({ id: '__unbound__', entries: { table: tables } }),
      },
      ...ifDefined(
        'types',
        types
          ? Object.fromEntries(
              Object.entries(types).map(([name, params]) => [
                name,
                {
                  kind: 'codec-instance' as const,
                  codecId: 'pgvector/vector@1',
                  nativeType: 'vector',
                  typeParams: params as Record<string, unknown>,
                },
              ]),
            )
          : undefined,
      ),
    });

    return {
      targetFamily: 'sql',
      target: 'postgres',
      profileHash: profileHash('test'),
      domain: applicationDomainOf({ models: {} }),
      roots: {},
      storage,
      extensions: {},
      capabilities: {},
      meta: {},
    };
  }

  it('returns the same codec instance for two refs with the same `(codecId, typeParams)`', () => {
    const { descriptor } = createCountingVectorExtension();
    const contract = contractWithVector({ Doc: { typeParams: { length: 1536 } } });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [descriptor],
    });

    const a = context.contractCodecs.forCodecRef({
      codecId: 'pgvector/vector@1',
      typeParams: { length: 1536 },
    });
    const b = context.contractCodecs.forCodecRef({
      codecId: 'pgvector/vector@1',
      typeParams: { length: 1536 },
    });

    expect(a).toBe(b);
  });

  it('keys cache by canonicalised typeParams so object key order does not matter', () => {
    const { descriptor } = createCountingVectorExtension();
    const contract = contractWithVector({
      Doc: { typeParams: { length: 768 } as { length: number } },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [descriptor],
    });

    const a = context.contractCodecs.forCodecRef({
      codecId: 'pgvector/vector@1',
      typeParams: { length: 1024, normalized: true } as never,
    });
    const b = context.contractCodecs.forCodecRef({
      codecId: 'pgvector/vector@1',
      typeParams: { normalized: true, length: 1024 } as never,
    });

    expect(a).toBe(b);
  });

  it('pre-populates the cache from the contract walk so contract-declared refs hit on first call', () => {
    const { descriptor, factoryCalls } = createCountingVectorExtension();
    const contract = contractWithVector({ Doc: { typeParams: { length: 1536 } } });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [descriptor],
    });

    const callsAfterContextConstruction = factoryCalls();
    expect(callsAfterContextConstruction).toBeGreaterThan(0);

    const codec = context.contractCodecs.forCodecRef({
      codecId: 'pgvector/vector@1',
      typeParams: { length: 1536 },
    });

    expect(codec).toBeDefined();
    expect(factoryCalls()).toBe(callsAfterContextConstruction);
  });

  it('lazy-materialises a codec when the AST supplies a ref the contract walk did not declare', () => {
    const { descriptor, factoryCalls } = createCountingVectorExtension();
    const contract = contractWithVector({ Doc: { typeParams: { length: 1536 } } });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [descriptor],
    });

    const before = factoryCalls();
    const codec = context.contractCodecs.forCodecRef({
      codecId: 'pgvector/vector@1',
      typeParams: { length: 2048 },
    });

    expect(codec).toBeDefined();
    expect(factoryCalls()).toBe(before + 1);
  });

  it('typeRef-shared columns resolve through forCodecRef to the same named-instance codec', () => {
    const { descriptor } = createCountingVectorExtension();
    const contract = contractWithVector(
      { Doc: { typeRef: 'V1536' }, Page: { typeRef: 'V1536' } },
      { V1536: { length: 1536 } },
    );

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [descriptor],
    });

    const codec = context.contractCodecs.forCodecRef({
      codecId: 'pgvector/vector@1',
      typeParams: { length: 1536 },
    });

    expect(codec).toBeDefined();
    // Pre-population uses the typeRef ctx — the cached codec's meta.ctxName carries the `storage.types` name.
    expect((codec as Codec & { meta: { ctxName: string } }).meta.ctxName).toBe('V1536');

    // The shared-per-codec invariant: forColumn lookups on either typeRef-sharing column resolve to the very same instance returned by forCodecRef. A regression that re-materialised per-column instances would still pass the existence/name asserts above; identity is what guards against that.
    const fromDoc = context.contractCodecs.forColumn('__unbound__', 'Doc', 'embedding');
    const fromPage = context.contractCodecs.forColumn('__unbound__', 'Page', 'embedding');
    expect(fromDoc).toBe(codec);
    expect(fromPage).toBe(codec);
  });

  it('storage.types aliases that canonicalize to the same CodecRef merge their usedAt sites', () => {
    const { descriptor } = createCountingVectorExtension();
    // V1536A and V1536B both resolve to (pgvector/vector@1, { length: 1536 }) — i.e. one shared codec instance.
    const contract = contractWithVector(
      { Doc: { typeRef: 'V1536A' }, Page: { typeRef: 'V1536B' } },
      { V1536A: { length: 1536 }, V1536B: { length: 1536 } },
    );

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [descriptor],
    });

    const codec = context.contractCodecs.forCodecRef({
      codecId: 'pgvector/vector@1',
      typeParams: { length: 1536 },
    });

    expect(codec).toBeDefined();
    // forColumn on both columns should reach the same instance.
    expect(context.contractCodecs.forColumn('__unbound__', 'Doc', 'embedding')).toBe(codec);
    expect(context.contractCodecs.forColumn('__unbound__', 'Page', 'embedding')).toBe(codec);
  });

  it('throws RUNTIME.CODEC_DESCRIPTOR_MISSING when the codecId is unknown to the resolver', () => {
    const { descriptor } = createCountingVectorExtension();
    const contract = contractWithVector({ Doc: { typeParams: { length: 1536 } } });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [descriptor],
    });

    expect(() => context.contractCodecs.forCodecRef({ codecId: 'nope/missing@1' })).toThrow(
      /CODEC_DESCRIPTOR_MISSING|nope\/missing@1/,
    );
  });
});

/**
 * Architectural invariant: `forColumn` is a convenience wrapper over `forCodecRef`. Both surfaces must return the exact same `Codec` instance for the same logical codec, so stateful codecs consuming `SqlCodecInstanceContext.usedAt` get one materialization regardless of which surface the caller picks.
 */
describe('buildContractCodecRegistry — forColumn delegates to forCodecRef', () => {
  function createSharedCodecExtension(): {
    descriptor: SqlRuntimeExtensionDescriptor<'postgres'>;
    instances: Array<{ ctx: SqlCodecInstanceContext; codec: Codec }>;
  } {
    const instances: Array<{ ctx: SqlCodecInstanceContext; codec: Codec }> = [];
    const codecDescriptor: CodecDescriptor<void> = {
      codecId: 'test/shared@1',
      dataType: dataTypeId('test/shared'),
      traits: [],
      targetTypes: ['shared'],
      paramsSchema: voidParamsSchema,
      isParameterized: false,
      factory: ((_params: undefined) => (ctx: SqlCodecInstanceContext) => {
        const codec: Codec = {
          id: 'test/shared@1',
          encode: (v: unknown) => Promise.resolve(v),
          decode: (w: unknown) => Promise.resolve(w),
          encodeJson: (v) => v as never,
          decodeJson: (j) => j as never,
        };
        instances.push({ ctx, codec });
        return codec;
      }) as unknown as CodecDescriptor<void>['factory'],
    };

    return {
      descriptor: {
        kind: 'extension' as const,
        id: 'test-shared',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => [codecDescriptor],
        create() {
          return { familyId: 'sql' as const, targetId: 'postgres' as const };
        },
      },
      instances,
    };
  }

  function contractWith(
    columns: Record<string, { codecId: string; nativeType: string }>,
  ): Contract<SqlStorage> {
    const tables: Record<string, StorageTable> = {};
    for (const [tableName, columnSpec] of Object.entries(columns)) {
      tables[tableName] = {
        columns: {
          field: {
            nativeType: columnSpec.nativeType,
            codecId: columnSpec.codecId,
            nullable: false,
          },
        },
        primaryKey: { columns: ['field'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };
    }
    return {
      targetFamily: 'sql',
      target: 'postgres',
      profileHash: profileHash('test'),
      domain: applicationDomainOf({ models: {} }),
      roots: {},
      storage: new SqlStorage({
        storageHash: coreHash('test'),
        namespaces: {
          __unbound__: createTestSqlNamespace({ id: '__unbound__', entries: { table: tables } }),
        },
      }),
      extensions: {},
      capabilities: {},
      meta: {},
    };
  }

  it('forColumn(ns, t, c) and forCodecRef(codecRefForColumn(ns, t, c)) return the same codec instance', () => {
    const { descriptor } = createSharedCodecExtension();
    const contract = contractWith({
      users: { codecId: 'test/shared@1', nativeType: 'shared' },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [descriptor],
    });

    const fromColumn = context.contractCodecs.forColumn('__unbound__', 'users', 'field');
    const ref = context.codecDescriptors.codecRefForColumn('__unbound__', 'users', 'field');
    expect(ref).toBeDefined();
    const fromRef = context.contractCodecs.forCodecRef(ref!);

    expect(fromColumn).toBeDefined();
    expect(fromColumn).toBe(fromRef);
  });

  it('two columns sharing one non-parameterized codec id share one codec instance with aggregated usedAt', () => {
    const { descriptor, instances } = createSharedCodecExtension();
    const contract = contractWith({
      users: { codecId: 'test/shared@1', nativeType: 'shared' },
      orders: { codecId: 'test/shared@1', nativeType: 'shared' },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [descriptor],
    });

    const usersInstance = context.contractCodecs.forColumn('__unbound__', 'users', 'field');
    const ordersInstance = context.contractCodecs.forColumn('__unbound__', 'orders', 'field');

    expect(usersInstance).toBeDefined();
    expect(ordersInstance).toBe(usersInstance);

    const materialized = instances.find(({ codec }) => codec === usersInstance);
    expect(materialized).toBeDefined();
    expect(materialized?.ctx.name).toBe('<codec:test/shared@1>');
    expect(materialized?.ctx.usedAt).toEqual([
      { table: 'users', column: 'field' },
      { table: 'orders', column: 'field' },
    ]);
  });
});
