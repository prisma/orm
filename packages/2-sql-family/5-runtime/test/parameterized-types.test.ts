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
    toWire: (v: number[]) => v,
    fromWire: (w: number[]) => w,
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
        dataType: string;
        codecId: string;
        nullable: boolean;
        typeParams?: Record<string, unknown>;
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
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
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
    });

    it('creates context with storage.types holding a registered database type', () => {
      const contract = createParamTypesTestContract({
        types: {
          Vector1536: {
            kind: 'codec-instance',
            codecId: 'pg/vector@1',
            dataType: 'pgvector/vector',
            typeParams: { length: 1536 },
          },
        },
      });
      const context = createTestContext(contract, createStubAdapter());

      expect(context.contract.storage.types).toEqual({
        Vector1536: {
          kind: 'codec-instance',
          codecId: 'pg/vector@1',
          dataType: 'pgvector/vector',
          typeParams: { length: 1536 },
        },
      });
    });
  });

  // The unified descriptor uses `factory: (P) => (CodecInstanceContext) => Codec`; per-instance state lives in the resolved codec returned by the factory.
  describe('codec factory context', () => {
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

    it('names the codec instance of a column with type params after the column, even when a registered database type has equal params', () => {
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
            dataType: 'pgvector/vector',
            typeParams: { length: 1536 },
          },
        },
        tableColumns: {
          id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
          embedding: {
            dataType: 'pgvector/vector',
            codecId: 'pg/vector@1',
            nullable: false,
            typeParams: { length: 1536 },
          },
        },
      });

      createTestContext(contract, createStubAdapter(), {
        extensions: [extensionDescriptor],
      });

      expect(observedCtxs).toEqual([
        { name: '<col:test.embedding>', usedAt: [{ table: 'test', column: 'embedding' }] },
      ]);
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
          id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
          embedding: {
            dataType: 'pgvector/vector',
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
          id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
          embedding: {
            dataType: 'pgvector/vector',
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
