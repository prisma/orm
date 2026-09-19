import type { TypesImportSpec } from '@internal/framework-components/emission';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { isStructuredError } from '@internal/utils/structured-error';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { EmitStackInput } from '../src/exports';
import { getEmittedArtifactPaths } from '../src/exports';
import { generateContractDts } from '../src/generate-contract-dts';
import { createMockSpi } from './mock-spi';
import { createTestContract, emit } from './utils';

const mockSqlHook = createMockSpi();

const emptySqlStorage = {
  namespaces: {
    [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: {} } },
  },
};

function unboundNamespaceTables(tables: Record<string, unknown>) {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: tables } },
    },
  };
}

describe('emitter', () => {
  it('derives colocated artifact paths from contract.json output', () => {
    expect(getEmittedArtifactPaths('/abs/contract.json')).toEqual({
      jsonPath: '/abs/contract.json',
      dtsPath: '/abs/contract.d.ts',
    });
  });

  it('rejects non-json output paths with CONFIG.VALIDATION_FAILED when deriving artifact paths', () => {
    let thrown: unknown;
    try {
      getEmittedArtifactPaths('/abs/contract.ts');
    } catch (error) {
      thrown = error;
    }
    expect(isStructuredError(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      code: 'CONFIG.VALIDATION_FAILED',
      message: 'Contract output path must end with .json',
    });
  });

  it(
    'rejects non-json output paths when emit receives an output path',
    async () => {
      const ir = createTestContract();
      const options: EmitStackInput = {
        codecTypeImports: [],
      };

      await expect(
        emit(ir, options, mockSqlHook, {
          outputJsonPath: '/abs/contract.ts',
        }),
      ).rejects.toThrow('Contract output path must end with .json');
    },
    timeouts.typeScriptCompilation,
  );

  it('refuses a same-space to-one relation that does not state whether it is nullable', async () => {
    const int = { type: { kind: 'scalar', codecId: 'pg/int4@1' }, nullable: false };
    const column = { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false };
    const ir = createTestContract({
      models: {
        Post: {
          storage: {
            namespaceId: '__unbound__',
            table: 'post',
            fields: { id: { column: 'id' }, authorId: { column: 'author_id' } },
          },
          fields: { id: int, authorId: int },
          relations: {
            author: {
              to: { namespace: '__unbound__', model: 'User' },
              cardinality: 'N:1',
              on: { localFields: ['authorId'], targetFields: ['id'] },
            },
          },
        },
        User: {
          storage: { namespaceId: '__unbound__', table: 'user', fields: { id: { column: 'id' } } },
          fields: { id: int },
          relations: {},
        },
      },
      storage: unboundNamespaceTables({
        post: {
          columns: { id: column, author_id: column },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        user: {
          columns: { id: column },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
    });

    await expect(emit(ir, { codecTypeImports: [] }, mockSqlHook)).rejects.toMatchObject({
      code: 'CONTRACT.RELATION_INVALID',
      message:
        'Relation "author" on model "__unbound__:Post" is a N:1 relation and must carry a boolean "nullable"',
      meta: { modelName: 'Post', relationName: 'author', reason: 'to-one-nullability-missing' },
    });
  });

  it(
    'emits contract.json and contract.d.ts',
    async () => {
      const ir = createTestContract({
        models: {
          User: {
            storage: {
              namespaceId: '__unbound__',
              table: 'user',
              fields: {
                id: { column: 'id' },
                email: { column: 'email' },
              },
            },
            fields: {
              id: { type: { kind: 'scalar', codecId: 'pg/int4@1' }, nullable: false },
              email: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            },
            relations: {},
          },
        },
        storage: unboundNamespaceTables({
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        }),
        extensions: {
          postgres: {
            version: '0.0.1',
          },
          pg: {},
        },
      });

      const codecTypeImports: TypesImportSpec[] = [];
      const extensionIds = ['postgres', 'pg'];
      const options: EmitStackInput = {
        codecTypeImports,
        extensionIds,
      };

      const result = await emit(ir, options, mockSqlHook);
      expect(result.storageHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.contractDts).toContain('export type Contract');
      expect(result.contractDts).toContain('CodecTypes');

      const contractJson = JSON.parse(result.contractJson) as Record<string, unknown>;
      const storage = contractJson['storage'] as Record<string, unknown>;
      const namespaces = storage['namespaces'] as Record<string, unknown>;
      expect(namespaces).toBeDefined();
      const unbound = namespaces[UNBOUND_NAMESPACE_ID] as Record<string, unknown>;
      expect(unbound).toBeDefined();
      const entries = unbound['entries'] as Record<string, unknown>;
      const tables = entries['table'] as Record<string, unknown>;
      expect(tables).toBeDefined();
    },
    timeouts.typeScriptCompilation,
  );

  it('threads supportsNamespaces from the emit options into the emitted model names', async () => {
    const ir = createTestContract({
      models: {
        User: {
          storage: { namespaceId: '__unbound__', table: 'user', fields: { id: { column: 'id' } } },
          fields: { id: { type: { kind: 'scalar', codecId: 'pg/int4@1' }, nullable: false } },
          relations: {},
        },
      },
      storage: unboundNamespaceTables({
        user: {
          columns: { id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false } },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
    });
    const kept = await emit(ir, { codecTypeImports: [] }, mockSqlHook);
    expect(kept.contractDts).toContain('export type unbound_User = {');
    const dropped = await emit(ir, { codecTypeImports: [] }, mockSqlHook, {
      supportsNamespaces: false,
    });
    expect(dropped.contractDts).toContain('export type User = {');
    expect(dropped.contractDts).not.toContain('unbound_User');
  });

  it('emits contract even when extension pack namespace does not match extensionIds', async () => {
    const ir = createTestContract({
      storage: unboundNamespaceTables({
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('tolerates codec namespaces not registered in extensionIds', async () => {
    const ir = createTestContract({
      storage: unboundNamespaceTables({
        data: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            value: { codecId: 'unknown/type@1', nativeType: 'custom', nullable: false },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      extensionIds: ['some-other-extension'],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('handles missing extensions field', async () => {
    const ir = createTestContract({
      storage: unboundNamespaceTables({
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('handles empty packs array', async () => {
    const ir = createTestContract({
      storage: unboundNamespaceTables({
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it(
    'omits sources from emitted contract artifact',
    async () => {
      const ir = createTestContract({
        sources: {
          schema: { sourceId: 'schema.prisma' },
        },
      });

      const options: EmitStackInput = {
        codecTypeImports: [],
        extensionIds: [],
      };

      const result = await emit(ir, options, mockSqlHook);
      const contractJson = JSON.parse(result.contractJson) as Record<string, unknown>;
      expect(contractJson).not.toHaveProperty('sources');
    },
    timeouts.typeScriptCompilation,
  );

  it('accepts meta keys when family validation allows them', async () => {
    const ir = createTestContract({
      meta: {
        sourceId: 'schema.prisma',
        schemaPath: '/tmp/schema.prisma',
        source: 'psl',
      },
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).resolves.toMatchObject({
      contractJson: expect.any(String),
      contractDts: expect.any(String),
    });
  });

  it('accepts canonical section keys when family validation allows them', async () => {
    const ir = createTestContract({
      storage: unboundNamespaceTables({
        user: {
          columns: {
            id: {
              codecId: 'pg/int4@1',
              nativeType: 'int4',
              nullable: false,
              sourceId: 'schema.prisma',
            },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).resolves.toMatchObject({
      contractJson: expect.any(String),
      contractDts: expect.any(String),
    });
  });

  it('emits contract even when extensionIds are not in contract.extensions', async () => {
    const ir = createTestContract({
      storage: emptySqlStorage,
    });

    const mockHookNoTypeValidation = createMockSpi();

    const options: EmitStackInput = {
      codecTypeImports: [],
      extensionIds: ['postgres'],
    };

    const result = await emit(ir, options, mockHookNoTypeValidation);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('defaults codecTypeImports to empty array when omitted', async () => {
    const ir = createTestContract({
      storage: emptySqlStorage,
    });

    const options: EmitStackInput = {
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractDts).toContain('export type CodecTypes');
  });

  it('passes parameterizedTypeImports and queryOperationTypeImports to generateContractDts', async () => {
    const ir = createTestContract({
      storage: emptySqlStorage,
    });

    const queryOperationTypeImports: TypesImportSpec[] = [
      { package: '@ext/query', named: 'QueryOperationTypes', alias: 'ExtQueryOpTypes' },
    ];

    const options: EmitStackInput = {
      codecTypeImports: [],
      extensionIds: [],
      queryOperationTypeImports,
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractDts).toContain("from '@ext/query'");
  });

  it('threads resolveFieldTypeParams from emitter SPI through to field type maps', async () => {
    // The emitter wraps `emitter.resolveFieldTypeParams(name, field, model, contract)`
    // into a `(name, field) => …` adapter for `generateBothFieldTypesMaps`.
    const ir = createTestContract({
      models: {
        User: {
          storage: { namespaceId: '__unbound__', table: 'user' },
          fields: {
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            embedding: {
              type: { kind: 'scalar', codecId: 'pg/vector@1' },
              nullable: false,
            },
          },
          relations: {},
        },
      },
    });

    const calls: Array<{
      modelName: string;
      fieldName: string;
      hasModel: boolean;
      hasContract: boolean;
    }> = [];
    const hookWithResolver = createMockSpi({
      resolveFieldTypeParams: (modelName, fieldName, model, contract) => {
        calls.push({
          modelName,
          fieldName,
          hasModel: model !== undefined,
          hasContract: contract !== undefined,
        });
        if (modelName === 'User' && fieldName === 'embedding') {
          return { length: 1536 };
        }
        return undefined;
      },
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      extensionIds: [],
    };

    await emit(ir, options, hookWithResolver);

    const userEmbeddingCall = calls.find(
      (c) => c.modelName === 'User' && c.fieldName === 'embedding',
    );
    expect(userEmbeddingCall).toBeDefined();
    expect(userEmbeddingCall?.hasModel).toBe(true);
    expect(userEmbeddingCall?.hasContract).toBe(true);
  });

  it('does not invoke resolveFieldTypeParams when the contract has no models', async () => {
    // With no models in the contract, field-map generation has no
    // fields to walk and never reaches the wrapper. The wrapper itself
    // also carries an internal `if (!model) return undefined` guard,
    // but field-map generation already filters non-model entries
    // before invoking the resolver, so that internal branch is
    // unreachable from the emit path. This test pins the upstream
    // short-circuit: the SPI delegate must stay unobserved when the
    // contract has nothing to walk.
    const ir = createTestContract({ storage: emptySqlStorage });

    let resolverInvocations = 0;
    const hookWithResolver = createMockSpi({
      resolveFieldTypeParams: () => {
        resolverInvocations += 1;
        return undefined;
      },
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      extensionIds: [],
    };

    await emit(ir, options, hookWithResolver);
    expect(resolverInvocations).toBe(0);
  });

  it('does not build a resolveFieldTypeParams wrapper when the SPI omits the hook', async () => {
    // When `emitter.resolveFieldTypeParams` is undefined, the wrapper is
    // also undefined and `generateBothFieldTypesMaps` falls back to the
    // codec-id-keyed `CodecLookup` only. This guards the
    // `emitter.resolveFieldTypeParams ?` ternary in
    // `generate-contract-dts.ts` so a future refactor can't accidentally
    // start synthesizing a no-op resolver.
    const ir = createTestContract({
      models: {
        User: {
          storage: { namespaceId: '__unbound__', table: 'user' },
          fields: {
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
          relations: {},
        },
      },
    });
    const baseSpi = createMockSpi();
    expect(baseSpi.resolveFieldTypeParams).toBeUndefined();

    const options: EmitStackInput = {
      codecTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, baseSpi);
    expect(result.contractDts).toContain('export type FieldOutputTypes');
  });

  it('emits value object clauses when the domain namespace declares value objects', async () => {
    const ir = createTestContract({
      storage: emptySqlStorage,
      valueObjects: {
        Address: {
          fields: {
            street: {
              nullable: false,
              type: { kind: 'scalar', codecId: 'pg/text@1' },
            },
          },
        },
      },
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractDts).toContain('readonly valueObjects:');
    expect(result.contractDts).toContain('export type AddressOutput');
  });

  it('emits per-namespace valueObjects block when a single namespace declares value objects', () => {
    const addressModel = {
      fields: {
        street: { type: { kind: 'scalar' as const, codecId: 'pg/text@1' }, nullable: false },
      },
    };
    const contract = {
      ...createTestContract(),
      domain: {
        namespaces: {
          public: {
            models: {},
            valueObjects: { Address: addressModel },
          },
        },
      },
    };
    const dts = generateContractDts(contract, mockSqlHook, [], {
      storageHash: '0000000000000000000000000000000000000000000000000000000000000001',
      profileHash: '0000000000000000000000000000000000000000000000000000000000000002',
    });
    // The per-namespace valueObjects block must appear inside the namespace block.
    // A positive match on the nested structure proves it is inside domain.namespaces.public.
    expect(dts).toContain('readonly public:');
    const publicNsIndex = dts.indexOf('readonly public:');
    const afterPublic = dts.slice(publicNsIndex);
    // valueObjects must appear before the closing of the namespace block
    expect(afterPublic.indexOf('readonly valueObjects:')).toBeGreaterThan(0);
    expect(afterPublic.indexOf('readonly valueObjects:')).toBeLessThan(
      afterPublic.indexOf('readonly capabilities:'),
    );
  });

  it('emits successfully when domain has more than one namespace', () => {
    const contract = {
      ...createTestContract(),
      domain: {
        namespaces: {
          auth: { models: {} },
          public: { models: {} },
        },
      },
    };
    const dts = generateContractDts(contract, mockSqlHook, [], {
      storageHash: '0000000000000000000000000000000000000000000000000000000000000001',
      profileHash: '0000000000000000000000000000000000000000000000000000000000000002',
    });
    expect(dts).toContain('readonly auth:');
    expect(dts).toContain('readonly public:');
  });

  it('throws when the sole namespace id has no namespace payload on the contract', () => {
    const contract = createTestContract({ namespaces: { public: undefined } });
    expect(() =>
      generateContractDts(contract, mockSqlHook, [], {
        storageHash: '0000000000000000000000000000000000000000000000000000000000000001',
        profileHash: '0000000000000000000000000000000000000000000000000000000000000002',
      }),
    ).toThrow('domain namespace "public" is not present on the contract');
  });

  it('emits execution clause when contract has execution section', async () => {
    const ir = createTestContract({
      storage: emptySqlStorage,
      execution: {
        executionHash: 'abc123',
        operations: {},
      },
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractDts).toContain('readonly execution:');
    expect(result.contractDts).toContain('readonly executionHash: ExecutionHash');
    expect(result.executionHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
