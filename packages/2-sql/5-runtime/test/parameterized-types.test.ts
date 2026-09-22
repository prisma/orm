import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import type { CodecDescriptor, CodecInstanceContext } from '@internal/framework-components/codec';
import { dataTypeId } from '@internal/framework-components/codec';
import { SqlStorage, type SqlStorageTypeEntry } from '@internal/sql-contract/types';
import type { Codec, SqlCodecInstanceContext } from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import { applicationDomainOf } from '@repo/test-utils';
import type { Type } from 'arktype';
import { type as arktype } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeExtensionDescriptor,
} from '../src/sql-context';
import { defineTestCodec } from './test-codec';
import { createStubAdapter, createTestContext } from './utils';

function vectorCodecInstance(meta?: Record<string, unknown>): Codec {
  const baseCodec = defineTestCodec({
    typeId: 'pg/vector@1',
    encode: (v: number[]) => v,
    decode: (w: number[]) => w,
  });
  if (!meta) return baseCodec;
  // The narrow `Codec` shape is conversion-only (TML-2357). The `meta` here is a test-side sentinel attached to the codec object so a downstream assertion can verify that the runtime materialization path threads the *exact same instance* the factory returned (via `toBe(taggedCodec)`); it is intentionally not part of the codec's declared shape. Cast through `unknown` to keep the augmentation visible to the assertion
  // without re-introducing a `meta` slot.
  return { ...baseCodec, meta } as unknown as Codec;
}

// ============================================================================= Test helpers =============================================================================

function createParamTypesTestContract(
  options?: Partial<{
    types: Record<string, SqlStorageTypeEntry>;
    tableColumns: Record<
      string,
      {
        nativeType: string;
        codecId: string;
        nullable: boolean;
        typeParams?: Record<string, unknown>;
        typeRef?: string;
      }
    >;
  }>,
): Contract<SqlStorage> {
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
          entries: {
            table: {
              test: {
                columns: options?.tableColumns ?? {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        }),
      },
      ...ifDefined('types', options?.types),
    }),
    extensions: {},
    capabilities: {},
    meta: {},
  };
}

// ============================================================================= Tests: Parameterized type validation =============================================================================

describe('parameterized types', () => {
  describe('storage.types validation', () => {
    it('creates context with empty storage.types', () => {
      const contract = createParamTypesTestContract({ types: {} });
      const context = createTestContext(contract, createStubAdapter());

      expect(context.contract.storage.types).toEqual({});
      expect(context.types).toEqual({});
    });

    it('creates context with storage.types containing valid type instances', () => {
      const contract = createParamTypesTestContract({
        types: {
          Vector1536: {
            kind: 'codec-instance',
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      });
      const context = createTestContext(contract, createStubAdapter());

      expect(context.contract.storage.types).toEqual({
        Vector1536: {
          kind: 'codec-instance',
          codecId: 'pg/vector@1',
          nativeType: 'vector',
          typeParams: { length: 1536 },
        },
      });
      // types registry should contain the raw type instance (no init hook provided)
      expect(context.types['Vector1536']).toBeDefined();
    });
  });

  describe('typeParams validation with paramsSchema', () => {
    const vectorParamsSchema = arktype({
      length: 'number',
    });

    function createVectorExtensionDescriptor(options?: {
      paramsSchema?: Type<{ length: number }>;
    }): SqlRuntimeExtensionDescriptor<'postgres'> {
      const sharedCodec = vectorCodecInstance();
      const parameterizedDescriptors: RuntimeParameterizedCodecDescriptor<{ length: number }>[] = [
        {
          codecId: 'pg/vector@1',
          dataType: dataTypeId('pg/vector'),
          traits: [],
          targetTypes: ['vector'],
          paramsSchema: options?.paramsSchema ?? vectorParamsSchema,
          isParameterized: true,
          factory: (_params) => (_ctx) => sharedCodec,
        },
      ];

      return {
        kind: 'extension' as const,
        id: 'pgvector',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => parameterizedDescriptors as unknown as ReadonlyArray<CodecDescriptor>,
        create() {
          return {
            familyId: 'sql' as const,
            targetId: 'postgres' as const,
          };
        },
      };
    }

    it('validates typeParams against codec paramsSchema', () => {
      const contract = createParamTypesTestContract({
        types: {
          Vector1536: {
            kind: 'codec-instance',
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      });

      const context = createTestContext(contract, createStubAdapter(), {
        extensions: [createVectorExtensionDescriptor()],
      });

      expect(context.types['Vector1536']).toBeDefined();
    });

    it('rejects invalid typeParams with stable error code', () => {
      const contract = createParamTypesTestContract({
        types: {
          InvalidVector: {
            kind: 'codec-instance',
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 'not-a-number' },
          },
        },
      });

      let thrownError: unknown;
      try {
        createTestContext(contract, createStubAdapter(), {
          extensions: [createVectorExtensionDescriptor()],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError).toMatchObject({
        code: 'RUNTIME.TYPE_PARAMS_INVALID',
        category: 'RUNTIME',
        severity: 'error',
        details: {
          codecId: 'pg/vector@1',
          typeName: 'InvalidVector',
        },
      });
    });

    it('rejects missing required typeParams with stable error code', () => {
      const contract = createParamTypesTestContract({
        types: {
          InvalidVector: {
            kind: 'codec-instance',
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: {},
          },
        },
      });

      let thrownError: unknown;
      try {
        createTestContext(contract, createStubAdapter(), {
          extensions: [createVectorExtensionDescriptor()],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError).toMatchObject({
        code: 'RUNTIME.TYPE_PARAMS_INVALID',
        category: 'RUNTIME',
        severity: 'error',
      });
    });
  });

  // The unified descriptor uses `factory: (P) => (CodecInstanceContext) => Codec`; per-instance state lives in the resolved codec returned by the factory. The `TypeHelperRegistry` (`context.types`) carries the resolved codec for every typed instance — or, for codec ids without a parameterized descriptor, the raw `StorageTypeInstance` for typeParams metadata.
  describe('factory for type helpers', () => {
    function createPgVectorExt(opts?: {
      paramsSchema?: Type<{ length: number }>;
      factory?: (params: { length: number }) => (ctx: CodecInstanceContext) => Codec;
    }): SqlRuntimeExtensionDescriptor<'postgres'> {
      const sharedCodec = vectorCodecInstance();
      const paramsSchema =
        opts?.paramsSchema ??
        arktype({
          length: 'number',
        });
      const factory = opts?.factory ?? ((_params: { length: number }) => () => sharedCodec);
      const parameterizedDescriptors: RuntimeParameterizedCodecDescriptor<{ length: number }>[] = [
        {
          codecId: 'pg/vector@1',
          dataType: dataTypeId('pg/vector'),
          traits: [],
          targetTypes: ['vector'],
          paramsSchema,
          isParameterized: true,
          factory,
        },
      ];
      return {
        kind: 'extension' as const,
        id: 'pgvector',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => parameterizedDescriptors as unknown as ReadonlyArray<CodecDescriptor>,
        create() {
          return { familyId: 'sql' as const, targetId: 'postgres' as const };
        },
      };
    }

    it('calls factory(params)(ctx) and stores resolved codec in context.types', () => {
      const taggedCodec = vectorCodecInstance({ dimensions: 1536, isVector: true });
      const factory = (_params: { length: number }) => (_ctx: CodecInstanceContext) => taggedCodec;
      const extensionDescriptor = createPgVectorExt({ factory });

      const contract = createParamTypesTestContract({
        types: {
          Vector1536: {
            kind: 'codec-instance',
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      });

      const context = createTestContext(contract, createStubAdapter(), {
        extensions: [extensionDescriptor],
      });

      expect(context.types['Vector1536']).toBe(taggedCodec);
      // The factory returned the `taggedCodec` instance with its test-side `meta` sentinel; the runtime materialization path preserves the exact instance, so the sentinel is still there.
      expect(
        (
          context.types['Vector1536'] as unknown as {
            meta?: { dimensions?: number };
          }
        ).meta?.dimensions,
      ).toBe(1536);
    });

    it('threads ctx (name + usedAt) through to the factory', () => {
      const observedCtxs: SqlCodecInstanceContext[] = [];
      const sharedCodec = vectorCodecInstance();
      // SQL extensions that read `usedAt` author against the SQL-extended ctx; the descriptor's factory slot is family-agnostic, so we cast through the base. This mirrors what production SQL extensions do (see `pgvector/src/exports/runtime.ts`'s family-agnostic cast).
      const sqlFactory = (_params: { length: number }) => (ctx: SqlCodecInstanceContext) => {
        observedCtxs.push(ctx);
        return sharedCodec;
      };
      const factory = sqlFactory as unknown as (params: {
        length: number;
      }) => (ctx: CodecInstanceContext) => Codec;
      const extensionDescriptor = createPgVectorExt({ factory });

      const contract = createParamTypesTestContract({
        types: {
          Vector1536: {
            kind: 'codec-instance',
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
        tableColumns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          embedding: {
            nativeType: 'vector',
            codecId: 'pg/vector@1',
            nullable: false,
            typeRef: 'Vector1536',
          },
        },
      });

      createTestContext(contract, createStubAdapter(), {
        extensions: [extensionDescriptor],
      });

      // Locate the per-column factory call by the type-instance ctx the test contract declares.
      const perColumnCtx = observedCtxs.find((ctx) => ctx.name === 'Vector1536');
      expect(perColumnCtx?.name).toBe('Vector1536');
      expect(perColumnCtx?.usedAt).toEqual([{ table: 'test', column: 'embedding' }]);
    });

    it('stores full type instance for codec ids without a parameterized descriptor', () => {
      // No extension contributes a parameterized descriptor for `pg/vector@1`. The named instance can't be materialized; the helper falls back to the raw type instance for callers that need typeParams metadata.
      const contract = createParamTypesTestContract({
        types: {
          Vector1536: {
            kind: 'codec-instance',
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      });

      const context = createTestContext(contract, createStubAdapter());

      expect(context.types['Vector1536']).toEqual({
        kind: 'codec-instance',
        codecId: 'pg/vector@1',
        nativeType: 'vector',
        typeParams: { length: 1536 },
      });
    });
  });

  describe('column typeParams validation', () => {
    function createBasicVectorExt(): SqlRuntimeExtensionDescriptor<'postgres'> {
      const sharedCodec = vectorCodecInstance();
      const parameterizedDescriptors: RuntimeParameterizedCodecDescriptor<{ length: number }>[] = [
        {
          codecId: 'pg/vector@1',
          dataType: dataTypeId('pg/vector'),
          traits: [],
          targetTypes: ['vector'],
          paramsSchema: arktype({ length: 'number' }),
          isParameterized: true,
          factory: (_params) => () => sharedCodec,
        },
      ];
      return {
        kind: 'extension' as const,
        id: 'pgvector',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => parameterizedDescriptors as unknown as ReadonlyArray<CodecDescriptor>,
        create() {
          return { familyId: 'sql' as const, targetId: 'postgres' as const };
        },
      };
    }

    it('validates inline column typeParams against codec paramsSchema', () => {
      const contract = createParamTypesTestContract({
        tableColumns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          embedding: {
            nativeType: 'vector',
            codecId: 'pg/vector@1',
            nullable: false,
            typeParams: { length: 1536 },
          },
        },
      });

      const context = createTestContext(contract, createStubAdapter(), {
        extensions: [createBasicVectorExt()],
      });

      expect(context.contract).toEqual(contract);
    });

    it('rejects invalid inline column typeParams with stable error code', () => {
      const contract = createParamTypesTestContract({
        tableColumns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          embedding: {
            nativeType: 'vector',
            codecId: 'pg/vector@1',
            nullable: false,
            typeParams: { length: 'invalid' },
          },
        },
      });

      let thrownError: unknown;
      try {
        createTestContext(contract, createStubAdapter(), {
          extensions: [createBasicVectorExt()],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError).toMatchObject({
        code: 'RUNTIME.TYPE_PARAMS_INVALID',
        category: 'RUNTIME',
        severity: 'error',
        details: {
          tableName: 'test',
          columnName: 'embedding',
        },
      });
    });
  });

  describe('duplicate codec descriptor detection', () => {
    it('throws RUNTIME.DUPLICATE_CODEC when multiple extensions provide same codecId', () => {
      const vectorParamsSchema = arktype({
        length: 'number',
      });

      function createVectorExtension(id: string): SqlRuntimeExtensionDescriptor<'postgres'> {
        const sharedCodec = vectorCodecInstance();
        const parameterizedDescriptors: RuntimeParameterizedCodecDescriptor<{ length: number }>[] =
          [
            {
              codecId: 'pg/vector@1',
              dataType: dataTypeId('pg/vector'),
              traits: [],
              targetTypes: ['vector'],
              paramsSchema: vectorParamsSchema,
              isParameterized: true,
              factory: (_params) => () => sharedCodec,
            },
          ];

        return {
          kind: 'extension' as const,
          id,
          version: '0.0.1',
          familyId: 'sql' as const,
          targetId: 'postgres' as const,
          codecs: () => parameterizedDescriptors as unknown as ReadonlyArray<CodecDescriptor>,
          create() {
            return {
              familyId: 'sql' as const,
              targetId: 'postgres' as const,
            };
          },
        };
      }

      const contract = createParamTypesTestContract();

      expect(() =>
        createTestContext(contract, createStubAdapter(), {
          extensions: [createVectorExtension('ext-1'), createVectorExtension('ext-2')],
        }),
      ).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.DUPLICATE_CODEC',
          category: 'RUNTIME',
          severity: 'error',
          details: {
            codecId: 'pg/vector@1',
          },
        }),
      );
    });
  });
});
