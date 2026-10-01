import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import type { CodecDescriptor, CodecInstanceContext } from '@internal/framework-components/codec';
import { dataTypeId } from '@internal/framework-components/codec';
import { SqlStorage } from '@internal/sql-contract/types';
import type { Codec } from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeExtensionDescriptor,
} from '../src/sql-context';
import { defineTestCodec } from './test-codec';
import { createStubAdapter, createTestContext } from './utils';

// The codec-registry layer exposes two runtime registries:
//
// - `ContractCodecRegistry` (`context.contractCodecs`): per-column resolved-codec dispatch with `forColumn(namespace, table, column)` and content-keyed AST dispatch via `forCodecRef(ref)`.
// - `CodecDescriptorRegistry` (`context.codecDescriptors`): codec-id-keyed metadata read with `descriptorFor(codecId)` — non-branching for parameterized vs. non-parameterized codecs (every non-parameterized codec is auto-lifted into a synthesized `CodecDescriptor<void>`).

function makeVectorCodec(meta?: Record<string, unknown>): Codec {
  const baseCodec = defineTestCodec({
    typeId: 'pg/vector@1',
    encode: (v: number[]) => v,
    decode: (w: number[]) => w,
  });
  if (!meta) return baseCodec;
  // The narrow `Codec` shape is conversion-only (TML-2357); the `meta` sentinel here is test-side bookkeeping that downstream assertions read off the exact instance handed back by the factory.
  return { ...baseCodec, meta } as unknown as Codec;
}

function createVectorExtensionDescriptor(): SqlRuntimeExtensionDescriptor<'postgres'> {
  // The factory returns a per-instance codec whose `meta.length` carries the parameter — so tests can observe per-instance differentiation.
  const factory: (params: { length: number }) => (ctx: CodecInstanceContext) => Codec =
    (params) => (_ctx) =>
      makeVectorCodec({ length: params.length });

  const vectorDescriptor: RuntimeParameterizedCodecDescriptor<{ length: number }> = {
    codecId: 'pg/vector@1',
    dataType: dataTypeId('pg/vector'),
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
    factory,
  };

  const descriptors: ReadonlyArray<CodecDescriptor> = [
    vectorDescriptor as unknown as CodecDescriptor,
  ];

  return {
    kind: 'extension' as const,
    id: 'pgvector-test',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptors,
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

function createNonParameterizedExtensionDescriptor(): SqlRuntimeExtensionDescriptor<'postgres'> {
  // Custom codec id avoids colliding with the default test target descriptor's pre-registered codecs (`pg/text@1`, etc.).
  const scalarCodec = defineTestCodec({
    typeId: 'test/scalar@1',
    targetTypes: ['scalar'],
    encode: (v: string) => v,
    decode: (w: string) => w,
  });

  const scalarDescriptor: CodecDescriptor = {
    codecId: 'test/scalar@1',
    dataType: dataTypeId('test/scalar'),
    traits: [],
    targetTypes: ['scalar'],
    paramsSchema: undefined,
    isParameterized: false,
    factory: () => () => scalarCodec,
  };

  return {
    kind: 'extension' as const,
    id: 'scalar-test',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => [scalarDescriptor],
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

function createTestContract(
  tables: Record<
    string,
    Record<
      string,
      {
        nativeType: string;
        codecId: string;
        nullable: boolean;
        typeParams?: Record<string, unknown>;
        typeRef?: string;
      }
    >
  >,
  types?: Record<string, import('@internal/sql-contract/types').SqlStorageTypeEntry>,
): Contract<SqlStorage> {
  const tableEntries = Object.fromEntries(
    Object.entries(tables).map(([tableName, columns]) => [
      tableName,
      {
        columns,
        primaryKey: { columns: [Object.keys(columns)[0] ?? 'id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    ]),
  );

  return {
    targetFamily: 'sql',
    target: 'postgres',
    profileHash: profileHash('test'),
    domain: applicationDomainOf({ models: {} }),
    roots: {},
    storage: new SqlStorage({
      storageHash: coreHash('test'),
      namespaces: {
        __unbound__: createTestSqlNamespace({
          id: '__unbound__',
          entries: { table: tableEntries },
        }),
      },
      ...ifDefined('types', types),
    }),
    extensions: {},
    capabilities: {},
    meta: {},
  };
}

describe('ContractCodecRegistry', () => {
  it('forColumn returns the per-instance codec for inline-typeParams parameterized columns', () => {
    const contract = createTestContract({
      Doc: {
        embedding: {
          nativeType: 'vector',
          codecId: 'pg/vector@1',
          nullable: false,
          typeParams: { length: 768 },
        },
      },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [createVectorExtensionDescriptor()],
    });

    const resolved = context.contractCodecs.forColumn('__unbound__', 'Doc', 'embedding');
    expect(resolved).toBeDefined();
    // The per-instance codec carries the column's `length` on its meta — confirms the dispatch path resolves through `factory(typeParams) (ctx)`, not the codec-id-keyed fallback.
    expect((resolved as Codec & { meta: { length: number } }).meta.length).toBe(768);
  });

  it('forColumn returns the same per-instance codec for typeRef columns sharing a named storage type', () => {
    const contract = createTestContract(
      {
        Doc: {
          embedding: {
            nativeType: 'vector',
            codecId: 'pg/vector@1',
            nullable: false,
            typeRef: 'Vector1536',
          },
        },
        Page: {
          embedding: {
            nativeType: 'vector',
            codecId: 'pg/vector@1',
            nullable: false,
            typeRef: 'Vector1536',
          },
        },
      },
      {
        Vector1536: {
          kind: 'codec-instance',
          codecId: 'pg/vector@1',
          nativeType: 'vector',
          typeParams: { length: 1536 },
        },
      },
    );

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [createVectorExtensionDescriptor()],
    });

    const docCodec = context.contractCodecs.forColumn('__unbound__', 'Doc', 'embedding');
    const pageCodec = context.contractCodecs.forColumn('__unbound__', 'Page', 'embedding');

    expect(docCodec).toBeDefined();
    expect(pageCodec).toBeDefined();
    // Both columns share the named instance — same codec object.
    expect(docCodec).toBe(pageCodec);
    expect((docCodec as Codec & { meta: { length: number } }).meta.length).toBe(1536);
  });

  it('forColumn returns the shared codec for non-parameterized columns', () => {
    const contract = createTestContract({
      User: {
        primary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: false },
        secondary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: true },
      },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [createNonParameterizedExtensionDescriptor()],
    });

    const primaryCodec = context.contractCodecs.forColumn('__unbound__', 'User', 'primary');
    const secondaryCodec = context.contractCodecs.forColumn('__unbound__', 'User', 'secondary');

    expect(primaryCodec).toBeDefined();
    expect(secondaryCodec).toBeDefined();
    // Non-parameterized codec ids share one codec instance across every column with that id.
    expect(primaryCodec).toBe(secondaryCodec);
    expect(primaryCodec?.id).toBe('test/scalar@1');
  });

  it('forColumn returns undefined for an unknown column', () => {
    const contract = createTestContract({
      User: {
        primary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: false },
      },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [createNonParameterizedExtensionDescriptor()],
    });

    expect(context.contractCodecs.forColumn('__unbound__', 'User', 'nonexistent')).toBeUndefined();
    expect(
      context.contractCodecs.forColumn('__unbound__', 'NoSuchTable', 'whatever'),
    ).toBeUndefined();
  });
});

describe('CodecDescriptorRegistry', () => {
  it('descriptorFor returns the parameterized descriptor for a parameterized codec id', () => {
    const contract = createTestContract({
      Doc: {
        embedding: {
          nativeType: 'vector',
          codecId: 'pg/vector@1',
          nullable: false,
          typeParams: { length: 768 },
        },
      },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [createVectorExtensionDescriptor()],
    });

    const descriptor = context.codecDescriptors.descriptorFor('pg/vector@1');
    expect(descriptor).toBeDefined();
    expect(descriptor?.codecId).toBe('pg/vector@1');
    expect(descriptor?.traits).toEqual(['equality']);
    expect(descriptor?.targetTypes).toEqual(['vector']);
  });

  it('descriptorFor returns the synthesized descriptor for a non-parameterized codec id', () => {
    const contract = createTestContract({
      User: { primary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: false } },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [createNonParameterizedExtensionDescriptor()],
    });

    const descriptor = context.codecDescriptors.descriptorFor('test/scalar@1');
    expect(descriptor).toBeDefined();
    expect(descriptor?.codecId).toBe('test/scalar@1');
    expect(descriptor?.targetTypes).toEqual(['scalar']);
  });

  it('descriptorFor reads use the same call shape for parameterized and non-parameterized codec ids', () => {
    // The defining property of the unified descriptor map: callers don't need to know whether a codec id is parameterized to read its traits.
    const contract = createTestContract({
      Doc: {
        embedding: {
          nativeType: 'vector',
          codecId: 'pg/vector@1',
          nullable: false,
          typeParams: { length: 384 },
        },
      },
      User: {
        primary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: false },
      },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [createVectorExtensionDescriptor(), createNonParameterizedExtensionDescriptor()],
    });

    const traitsByCodecId = (codecId: string): readonly string[] =>
      context.codecDescriptors.descriptorFor(codecId)?.traits ?? [];

    expect(traitsByCodecId('pg/vector@1')).toEqual(['equality']);
    // Synthesized descriptors carry empty traits if the codec didn't declare any.
    expect(traitsByCodecId('test/scalar@1')).toEqual([]);
  });

  it('descriptorFor returns undefined for an unknown codec id', () => {
    const contract = createTestContract({
      User: { primary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: false } },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [createNonParameterizedExtensionDescriptor()],
    });

    expect(context.codecDescriptors.descriptorFor('unknown/codec@1')).toBeUndefined();
  });

  it('values() iterates every registered descriptor', () => {
    const contract = createTestContract({
      User: { primary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: false } },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [createNonParameterizedExtensionDescriptor()],
    });

    const codecIds = Array.from(context.codecDescriptors.values()).map((d) => d.codecId);
    expect(codecIds).toContain('test/scalar@1');
  });

  it('byTargetType returns descriptors for a given target type', () => {
    const contract = createTestContract({
      Doc: {
        embedding: {
          nativeType: 'vector',
          codecId: 'pg/vector@1',
          nullable: false,
          typeParams: { length: 1536 },
        },
      },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensions: [createVectorExtensionDescriptor()],
    });

    const byVector = context.codecDescriptors.byTargetType('vector');
    expect(byVector.length).toBeGreaterThan(0);
    expect(byVector.some((d) => d.codecId === 'pg/vector@1')).toBe(true);
  });
});
