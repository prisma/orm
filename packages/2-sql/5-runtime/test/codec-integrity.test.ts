import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import type { CodecDescriptor } from '@internal/framework-components/codec';
import { dataTypeId, voidParamsSchema } from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import type { Codec, SqlCodecInstanceContext } from '@internal/sql-relational-core/ast';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type { SqlRuntimeExtensionDescriptor } from '../src/sql-context';
import { createStubAdapter, createTestContext } from './utils';

/**
 * Build-time integrity check that surfaces (codecId, isParameterized, typeParams) mismatches in `storage.tables[t].columns[c]` before any AST-bound codec resolution can mask them. The legacy "tolerate codec references without params" patterns silently skipped malformed columns; the integrity check throws explicit envelope codes instead.
 */
describe('createExecutionContext — column codec integrity', () => {
  function makeCodec(): Codec {
    return {
      id: 'whatever',
      encode: (v: unknown) => Promise.resolve(v),
      decode: (w: unknown) => Promise.resolve(w),
      encodeJson: (v) => v as never,
      decodeJson: (j) => j as never,
    };
  }

  function parameterizedExtension(): SqlRuntimeExtensionDescriptor<'postgres'> {
    const descriptor: CodecDescriptor<{ length: number }> = {
      codecId: 'pgvector/vector@1',
      dataType: dataTypeId('pgvector/vector'),
      traits: [],
      targetTypes: ['vector'],
      paramsSchema: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: (value) => {
            const v = value as { length?: unknown } | undefined;
            if (!v || typeof v.length !== 'number') {
              return { issues: [{ message: 'length is required' }] };
            }
            return { value: v as { length: number } };
          },
        },
      },
      isParameterized: true,
      factory: ((_params: { length: number }) => (_ctx: SqlCodecInstanceContext) =>
        makeCodec()) as unknown as CodecDescriptor<{ length: number }>['factory'],
    };
    return {
      kind: 'extension' as const,
      id: 'pgvector-test',
      version: '0.0.1',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      codecs: () => [descriptor as unknown as CodecDescriptor],
      create() {
        return { familyId: 'sql' as const, targetId: 'postgres' as const };
      },
    };
  }

  function asyncParamsSchemaExtension(): SqlRuntimeExtensionDescriptor<'postgres'> {
    const descriptor: CodecDescriptor<{ length: number }> = {
      codecId: 'async/vector@1',
      dataType: dataTypeId('async/vector'),
      traits: [],
      targetTypes: ['vector'],
      paramsSchema: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: () => Promise.resolve({ value: { length: 0 } }),
        },
      },
      isParameterized: true,
      factory: ((_params: { length: number }) => (_ctx: SqlCodecInstanceContext) =>
        makeCodec()) as unknown as CodecDescriptor<{ length: number }>['factory'],
    };
    return {
      kind: 'extension' as const,
      id: 'async-paramsschema-test',
      version: '0.0.1',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      codecs: () => [descriptor as unknown as CodecDescriptor],
      create() {
        return { familyId: 'sql' as const, targetId: 'postgres' as const };
      },
    };
  }

  function nonParameterizedExtension(): SqlRuntimeExtensionDescriptor<'postgres'> {
    const descriptor: CodecDescriptor<void> = {
      codecId: 'test/scalar@1',
      dataType: dataTypeId('test/scalar'),
      traits: [],
      targetTypes: ['scalar'],
      paramsSchema: voidParamsSchema,
      isParameterized: false,
      factory: ((_params: undefined) => (_ctx: SqlCodecInstanceContext) =>
        makeCodec()) as unknown as CodecDescriptor<void>['factory'],
    };
    return {
      kind: 'extension' as const,
      id: 'scalar-test',
      version: '0.0.1',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      codecs: () => [descriptor],
      create() {
        return { familyId: 'sql' as const, targetId: 'postgres' as const };
      },
    };
  }

  function contractWithColumn(column: {
    readonly codecId: string;
    readonly nativeType: string;
    readonly typeParams?: Record<string, unknown>;
    readonly typeRef?: string;
  }): Contract<SqlStorage> {
    const storage: SqlStorage = new SqlStorage({
      storageHash: coreHash('test'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              Doc: {
                columns: {
                  field: {
                    nativeType: column.nativeType,
                    codecId: column.codecId,
                    nullable: false,
                    ...(column.typeParams ? { typeParams: column.typeParams } : {}),
                    ...(column.typeRef ? { typeRef: column.typeRef } : {}),
                  },
                },
                primaryKey: { columns: ['field'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        }),
      },
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

  it('throws CODEC_DESCRIPTOR_MISSING when a column references an unregistered codecId', () => {
    const contract = contractWithColumn({
      codecId: 'nope/missing@1',
      nativeType: 'vector',
    });
    expect(() =>
      createTestContext(contract, createStubAdapter(), {
        extensions: [parameterizedExtension()],
      }),
    ).toThrow(/CODEC_DESCRIPTOR_MISSING|nope\/missing@1/);
  });

  it('throws CODEC_PARAMETERIZATION_MISMATCH when a parameterized codec column lacks typeParams', () => {
    const contract = contractWithColumn({
      codecId: 'pgvector/vector@1',
      nativeType: 'vector',
    });
    expect(() =>
      createTestContext(contract, createStubAdapter(), {
        extensions: [parameterizedExtension()],
      }),
    ).toThrow(/CODEC_PARAMETERIZATION_MISMATCH|pgvector\/vector@1/);
  });

  it('throws CODEC_PARAMETERIZATION_MISMATCH when a non-parameterized codec column carries typeParams', () => {
    const contract = contractWithColumn({
      codecId: 'test/scalar@1',
      nativeType: 'scalar',
      typeParams: { unexpected: 1 },
    });
    expect(() =>
      createTestContext(contract, createStubAdapter(), {
        extensions: [nonParameterizedExtension()],
      }),
    ).toThrow(/CODEC_PARAMETERIZATION_MISMATCH|test\/scalar@1/);
  });

  it('accepts a non-parameterized codec column whose typeParams is an empty object (equivalent to missing)', () => {
    const contract = contractWithColumn({
      codecId: 'test/scalar@1',
      nativeType: 'scalar',
      typeParams: {},
    });
    expect(() =>
      createTestContext(contract, createStubAdapter(), {
        extensions: [nonParameterizedExtension()],
      }),
    ).not.toThrow();
  });

  it('accepts a typeRef column whose typed instance carries empty-object typeParams against a non-parameterized codec', () => {
    const storage: SqlStorage = new SqlStorage({
      storageHash: coreHash('test'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              Doc: {
                columns: {
                  uuidCol: {
                    nativeType: 'uuid',
                    codecId: 'test/scalar@1',
                    nullable: false,
                    typeRef: 'Uuid',
                  },
                },
                primaryKey: { columns: ['uuidCol'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        }),
      },
      types: {
        Uuid: {
          kind: 'codec-instance',
          codecId: 'test/scalar@1',
          nativeType: 'uuid',
          typeParams: {},
        },
      },
    });
    const contract: Contract<SqlStorage> = {
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
    expect(() =>
      createTestContext(contract, createStubAdapter(), {
        extensions: [nonParameterizedExtension()],
      }),
    ).not.toThrow();
  });

  it('error message names the (table, column) site for missing codec', () => {
    const contract = contractWithColumn({
      codecId: 'nope/missing@1',
      nativeType: 'vector',
    });
    expect(() =>
      createTestContext(contract, createStubAdapter(), {
        extensions: [parameterizedExtension()],
      }),
    ).toThrow(/Doc.*field|field.*Doc/);
  });

  it('error message names the (table, column) site for parameterization mismatch', () => {
    const contract = contractWithColumn({
      codecId: 'pgvector/vector@1',
      nativeType: 'vector',
    });
    expect(() =>
      createTestContext(contract, createStubAdapter(), {
        extensions: [parameterizedExtension()],
      }),
    ).toThrow(/Doc.*field|field.*Doc/);
  });

  it('accepts a parameterized column with typeParams', () => {
    const contract = contractWithColumn({
      codecId: 'pgvector/vector@1',
      nativeType: 'vector',
      typeParams: { length: 1536 },
    });
    expect(() =>
      createTestContext(contract, createStubAdapter(), {
        extensions: [parameterizedExtension()],
      }),
    ).not.toThrow();
  });

  it('accepts a non-parameterized column without typeParams', () => {
    const contract = contractWithColumn({
      codecId: 'test/scalar@1',
      nativeType: 'scalar',
    });
    expect(() =>
      createTestContext(contract, createStubAdapter(), {
        extensions: [nonParameterizedExtension()],
      }),
    ).not.toThrow();
  });

  it('throws TYPE_PARAMS_INVALID when a parameterized column probes an async paramsSchema at the integrity check', () => {
    const contract = contractWithColumn({
      codecId: 'async/vector@1',
      nativeType: 'vector',
    });
    expect(() =>
      createTestContext(contract, createStubAdapter(), {
        extensions: [asyncParamsSchemaExtension()],
      }),
    ).toThrow(/TYPE_PARAMS_INVALID|Promise|synchronous/);
  });

  it('throws TYPE_PARAMS_INVALID when validateTypeParams encounters an async paramsSchema for a column with typeParams', () => {
    const contract = contractWithColumn({
      codecId: 'async/vector@1',
      nativeType: 'vector',
      typeParams: { length: 1536 },
    });
    expect(() =>
      createTestContext(contract, createStubAdapter(), {
        extensions: [asyncParamsSchemaExtension()],
      }),
    ).toThrow(/TYPE_PARAMS_INVALID|Promise|synchronous/);
  });

  it('accepts a typeRef column whose typed instance carries typeParams', () => {
    const storage: SqlStorage = new SqlStorage({
      storageHash: coreHash('test'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              Doc: {
                columns: {
                  embedding: {
                    nativeType: 'vector',
                    codecId: 'pgvector/vector@1',
                    nullable: false,
                    typeRef: 'V1536',
                  },
                },
                primaryKey: { columns: ['embedding'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        }),
      },
      types: {
        V1536: {
          kind: 'codec-instance',
          codecId: 'pgvector/vector@1',
          nativeType: 'vector',
          typeParams: { length: 1536 },
        },
      },
    });
    const contract: Contract<SqlStorage> = {
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
    expect(() =>
      createTestContext(contract, createStubAdapter(), {
        extensions: [parameterizedExtension()],
      }),
    ).not.toThrow();
  });
});
