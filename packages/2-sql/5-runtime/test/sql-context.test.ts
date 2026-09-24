import { type Contract, coreHash, executionHash, profileHash } from '@internal/contract/types';
import { mergeCapabilityMatrices } from '@internal/framework-components/components';
import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import { SqlStorage } from '@internal/sql-contract/types';
import type { SqlOperationDescriptors } from '@internal/sql-operations';
import type { Codec } from '@internal/sql-relational-core/ast';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import {
  createExecutionContext,
  type SqlExecutionStack,
  type SqlRuntimeAdapterDescriptor,
  type SqlRuntimeDriverInstance,
  type SqlRuntimeExtensionDescriptor,
  type SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { defineTestCodec } from './test-codec';
import {
  createStubAdapter,
  createTestAdapterDescriptor,
  createTestTargetDescriptor,
  descriptorsFromCodecs,
} from './utils';

const testContract: Contract<SqlStorage> = {
  targetFamily: 'sql',
  target: 'postgres',
  profileHash: profileHash('test'),
  domain: applicationDomainOf({ models: {} }),
  roots: {},
  storage: new SqlStorage({
    storageHash: coreHash('test'),
    namespaces: {
      __unbound__: createTestSqlNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
  extensions: {},
  capabilities: {},
  meta: {},
};

function createTestExtensionDescriptor(options?: {
  hasCodecs?: boolean;
  hasOperations?: boolean;
}): SqlRuntimeExtensionDescriptor<'postgres'> {
  const { hasCodecs = false, hasOperations = false } = options ?? {};

  const codecRegistry: ReadonlyArray<Codec<string>> = hasCodecs
    ? [
        defineTestCodec({
          typeId: 'test/ext@1',
          targetTypes: ['ext'],
          encode: (v: string) => v,
          decode: (w: string) => w,
        }),
      ]
    : [];

  const operations: SqlOperationDescriptors = hasOperations
    ? {
        testOp: {
          self: { codecId: 'test/ext@1' },
          impl: () => undefined as never,
        },
      }
    : {};

  return {
    kind: 'extension' as const,
    id: 'test-extension',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptorsFromCodecs(codecRegistry),
    queryOperations: () => operations,
    create() {
      return {
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
      };
    },
  };
}

function createStack(options?: {
  extensions?: ReadonlyArray<SqlRuntimeExtensionDescriptor<'postgres'>>;
}): SqlExecutionStack<'postgres'> {
  return {
    target: createTestTargetDescriptor(),
    adapter: createTestAdapterDescriptor(createStubAdapter()),
    extensions: options?.extensions ?? [],
  };
}

describe('createExecutionContext', () => {
  it('creates context with adapter codecs from descriptor', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: createStack(),
    });

    expect(context.contract).toEqual(testContract);
    expect(context.codecDescriptors.descriptorFor('pg/int4@1')).toBeDefined();
    expect(context.queryOperations).toBeDefined();
  });

  it('creates context with empty extension packs', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: createStack({ extensions: [] }),
    });

    expect(context.codecDescriptors.descriptorFor('pg/int4@1')).toBeDefined();
    expect(context.codecDescriptors.descriptorFor('test/ext@1')).toBeUndefined();
  });

  it('registers extension codecs from descriptors', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: createStack({
        extensions: [createTestExtensionDescriptor({ hasCodecs: true })],
      }),
    });

    expect(context.codecDescriptors.descriptorFor('pg/int4@1')).toBeDefined();
    expect(context.codecDescriptors.descriptorFor('test/ext@1')).toBeDefined();
  });

  it('registers extension operations from descriptors', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: createStack({
        extensions: [createTestExtensionDescriptor({ hasOperations: true })],
      }),
    });

    const entries = context.queryOperations.entries();
    expect(entries['testOp']).toBeDefined();
  });

  it('handles extension with no contributions', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: createStack({
        extensions: [createTestExtensionDescriptor({ hasCodecs: false, hasOperations: false })],
      }),
    });

    expect(context.codecDescriptors.descriptorFor('pg/int4@1')).toBeDefined();
    expect(context.codecDescriptors.descriptorFor('test/ext@1')).toBeUndefined();
  });
});

describe('comprehensive descriptor-based derivation', () => {
  it('includes all expected codec IDs and operations from target, adapter, and extensions', () => {
    const targetCodecRegistry: ReadonlyArray<Codec<string>> = [
      defineTestCodec({
        typeId: 'target/special@1',
        targetTypes: ['special'],
        encode: (v: string) => v,
        decode: (w: string) => w,
      }),
    ];

    const targetOps: SqlOperationDescriptors = {
      targetOp: {
        self: { codecId: 'target/special@1' },
        impl: () => undefined as never,
      },
    };

    const target: SqlRuntimeTargetDescriptor<'postgres'> = {
      kind: 'target' as const,
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      codecs: () => descriptorsFromCodecs(targetCodecRegistry),
      queryOperations: () => targetOps,
      create() {
        return { familyId: 'sql' as const, targetId: 'postgres' as const };
      },
    };

    const stack: SqlExecutionStack<'postgres'> = {
      target,
      adapter: createTestAdapterDescriptor(createStubAdapter()),
      extensions: [createTestExtensionDescriptor({ hasCodecs: true, hasOperations: true })],
    };

    const context = createExecutionContext({ contract: testContract, stack });

    expect(context.codecDescriptors.descriptorFor('target/special@1')).toBeDefined();
    expect(context.codecDescriptors.descriptorFor('pg/int4@1')).toBeDefined();
    expect(context.codecDescriptors.descriptorFor('test/ext@1')).toBeDefined();

    const entries = context.queryOperations.entries();
    expect(entries['targetOp']).toBeDefined();
    expect(entries['testOp']).toBeDefined();
  });
});

describe('context.types presence', () => {
  it('exists as empty object when no parameterized codecs are registered', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: createStack(),
    });

    expect(context.types).toBeDefined();
    expect(context.types).toEqual({});
  });
});

describe('contract/stack validation errors', () => {
  it('throws RUNTIME.CONTRACT_FAMILY_MISMATCH when contract targetFamily differs from stack', () => {
    const mismatchedFamilyContract = {
      ...testContract,
      targetFamily: 'document',
    } as unknown as Contract<SqlStorage>;

    expect(() =>
      createExecutionContext({ contract: mismatchedFamilyContract, stack: createStack() }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.CONTRACT_FAMILY_MISMATCH',
        category: 'RUNTIME',
        severity: 'error',
        details: {
          actual: 'document',
          expected: 'sql',
        },
      }),
    );
  });

  it('throws RUNTIME.CONTRACT_TARGET_MISMATCH when contract target differs from stack', () => {
    const mismatchedContract: Contract<SqlStorage> = {
      ...testContract,
      target: 'mysql',
    };

    expect(() =>
      createExecutionContext({ contract: mismatchedContract, stack: createStack() }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.CONTRACT_TARGET_MISMATCH',
        category: 'RUNTIME',
        severity: 'error',
        details: {
          actual: 'mysql',
          expected: 'postgres',
        },
      }),
    );
  });

  it('throws RUNTIME.MISSING_EXTENSION_PACK when contract requires extension not in stack', () => {
    const contractWithExtension: Contract<SqlStorage> = {
      ...testContract,
      extensions: {
        'required-extension': { id: 'required-extension', version: '1.0.0', capabilities: {} },
      },
    };

    expect(() =>
      createExecutionContext({ contract: contractWithExtension, stack: createStack() }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.MISSING_EXTENSION_PACK',
        category: 'RUNTIME',
        severity: 'error',
        details: {
          packIds: ['required-extension'],
        },
      }),
    );
  });

  it('lists all missing extension packs in a single error', () => {
    const contractWithExtensions: Contract<SqlStorage> = {
      ...testContract,
      extensions: {
        'ext-a': { id: 'ext-a', version: '1.0.0', capabilities: {} },
        'ext-b': { id: 'ext-b', version: '1.0.0', capabilities: {} },
      },
    };

    expect(() =>
      createExecutionContext({ contract: contractWithExtensions, stack: createStack() }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.MISSING_EXTENSION_PACK',
        details: {
          packIds: expect.arrayContaining(['ext-a', 'ext-b']),
        },
      }),
    );
  });

  it('throws RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING when contract references a generator the stack does not provide', () => {
    const contractWithUnknownGenerator: Contract<SqlStorage> = {
      ...testContract,
      storage: new SqlStorage({
        storageHash: coreHash('test'),
        namespaces: {
          __unbound__: createTestSqlNamespace({
            id: '__unbound__',
            entries: {
              table: {
                user: {
                  columns: {
                    id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          }),
        },
      }),
      execution: {
        executionHash: executionHash('test'),
        mutations: {
          defaults: [
            {
              ref: { namespace: '__unbound__', entry: 'user', field: 'id' },
              onCreate: { kind: 'generator', id: 'unregistered' },
            },
          ],
        },
      },
    };

    expect(() =>
      createExecutionContext({ contract: contractWithUnknownGenerator, stack: createStack() }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING',
        category: 'RUNTIME',
        severity: 'error',
        details: expect.objectContaining({
          ids: ['unregistered'],
        }),
      }),
    );
  });

  it('lists all missing mutation default generator ids in a single error', () => {
    const contractWithMissingGenerators: Contract<SqlStorage> = {
      ...testContract,
      storage: new SqlStorage({
        storageHash: coreHash('test'),
        namespaces: {
          __unbound__: createTestSqlNamespace({
            id: '__unbound__',
            entries: {
              table: {
                user: {
                  columns: {
                    id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                    slug: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          }),
        },
      }),
      execution: {
        executionHash: executionHash('test'),
        mutations: {
          defaults: [
            {
              ref: { namespace: '__unbound__', entry: 'user', field: 'id' },
              onCreate: { kind: 'generator', id: 'gen-a' },
            },
            {
              ref: { namespace: '__unbound__', entry: 'user', field: 'slug' },
              onUpdate: { kind: 'generator', id: 'gen-b' },
            },
          ],
        },
      },
    };

    expect(() =>
      createExecutionContext({ contract: contractWithMissingGenerators, stack: createStack() }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING',
        details: expect.objectContaining({
          ids: expect.arrayContaining(['gen-a', 'gen-b']),
        }),
      }),
    );
  });

  it('passes when all referenced mutation default generator ids are registered', () => {
    const contractWithRegisteredGenerator: Contract<SqlStorage> = {
      ...testContract,
      storage: new SqlStorage({
        storageHash: coreHash('test'),
        namespaces: {
          __unbound__: createTestSqlNamespace({
            id: '__unbound__',
            entries: {
              table: {
                user: {
                  columns: {
                    id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          }),
        },
      }),
      execution: {
        executionHash: executionHash('test'),
        mutations: {
          defaults: [
            {
              ref: { namespace: '__unbound__', entry: 'user', field: 'id' },
              onCreate: { kind: 'generator', id: 'nanoid' },
            },
          ],
        },
      },
    };

    expect(() =>
      createExecutionContext({ contract: contractWithRegisteredGenerator, stack: createStack() }),
    ).not.toThrow();
  });
});

describe('applyMutationDefaults', () => {
  const contractWithDefaults: Contract<SqlStorage> = {
    ...testContract,
    storage: new SqlStorage({
      storageHash: coreHash('test'),
      namespaces: {
        __unbound__: createTestSqlNamespace({
          id: '__unbound__',
          entries: {
            table: {
              user: {
                columns: {
                  id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  slug: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        }),
      },
    }),
    execution: {
      executionHash: executionHash('test'),
      mutations: {
        defaults: [
          {
            ref: { namespace: '__unbound__', entry: 'user', field: 'id' },
            onCreate: { kind: 'generator', id: 'nanoid', params: { size: 8 } },
          },
          {
            ref: { namespace: '__unbound__', entry: 'user', field: 'slug' },
            onUpdate: { kind: 'generator', id: 'nanoid', params: { size: 6 } },
          },
        ],
      },
    },
  };

  it('applies create defaults with generator params', () => {
    const context = createExecutionContext({
      contract: contractWithDefaults,
      stack: createStack(),
    });

    const applied = context.applyMutationDefaults({
      op: 'create',
      table: 'user',
      namespace: '__unbound__',
      values: {},
    });

    expect(applied).toEqual([
      {
        column: 'id',
        value: expect.any(String),
      },
    ]);
    expect((applied[0]!.value as string).length).toBe(8);
  });

  it('applies update defaults from onUpdate', () => {
    const context = createExecutionContext({
      contract: contractWithDefaults,
      stack: createStack(),
    });

    const applied = context.applyMutationDefaults({
      op: 'update',
      table: 'user',
      namespace: '__unbound__',
      values: { email: 'alice@example.com' },
    });

    expect(applied).toEqual([
      {
        column: 'slug',
        value: expect.any(String),
      },
    ]);
    expect((applied[0]!.value as string).length).toBe(6);
  });

  it('skips update defaults for empty update payloads', () => {
    const context = createExecutionContext({
      contract: contractWithDefaults,
      stack: createStack(),
    });

    const applied = context.applyMutationDefaults({
      op: 'update',
      table: 'user',
      namespace: '__unbound__',
      values: {},
    });

    expect(applied).toEqual([]);
  });

  it('shares one query-stable generator value across rows when defaultValueCache is shared', () => {
    const counterMarker = { invocations: 0 };
    const counterGeneratorExtension: SqlRuntimeExtensionDescriptor<'postgres'> = {
      kind: 'extension' as const,
      id: 'counter-generator-extension',
      version: '0.0.1',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      codecs: () => [],
      mutationDefaultGenerators: () => [
        {
          id: 'counter',
          generate: () => ++counterMarker.invocations,
          stability: 'query',
        },
      ],
      create() {
        return { familyId: 'sql' as const, targetId: 'postgres' as const };
      },
    };

    const contractWithCounter: Contract<SqlStorage> = {
      ...testContract,
      storage: new SqlStorage({
        storageHash: coreHash('test'),
        namespaces: {
          __unbound__: createTestSqlNamespace({
            id: '__unbound__',
            entries: {
              table: {
                user: {
                  columns: {
                    id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                    touchedAt: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          }),
        },
      }),
      execution: {
        executionHash: executionHash('test'),
        mutations: {
          defaults: [
            {
              ref: { namespace: '__unbound__', entry: 'user', field: 'touchedAt' },
              onCreate: { kind: 'generator', id: 'counter' },
            },
          ],
        },
      },
    };

    const context = createExecutionContext({
      contract: contractWithCounter,
      stack: createStack({ extensions: [counterGeneratorExtension] }),
    });

    const defaultValueCache = new Map<string, unknown>();
    const row1 = context.applyMutationDefaults({
      op: 'create',
      table: 'user',
      namespace: '__unbound__',
      values: { id: 'a' },
      defaultValueCache,
    });
    const row2 = context.applyMutationDefaults({
      op: 'create',
      table: 'user',
      namespace: '__unbound__',
      values: { id: 'b' },
      defaultValueCache,
    });
    const row3 = context.applyMutationDefaults({
      op: 'create',
      table: 'user',
      namespace: '__unbound__',
      values: { id: 'c' },
      defaultValueCache,
    });

    expect(counterMarker.invocations).toBe(1);
    expect(row1).toEqual([{ column: 'touchedAt', value: 1 }]);
    expect(row2).toEqual([{ column: 'touchedAt', value: 1 }]);
    expect(row3).toEqual([{ column: 'touchedAt', value: 1 }]);

    // Without the shared cache, each call generates fresh.
    const row4 = context.applyMutationDefaults({
      op: 'create',
      table: 'user',
      namespace: '__unbound__',
      values: { id: 'd' },
    });
    expect(counterMarker.invocations).toBe(2);
    expect(row4).toEqual([{ column: 'touchedAt', value: 2 }]);
  });

  it('shares a row-stable generator value across columns of one call but not across calls', () => {
    const counterMarker = { invocations: 0 };
    const rowGeneratorExtension: SqlRuntimeExtensionDescriptor<'postgres'> = {
      kind: 'extension' as const,
      id: 'row-generator-extension',
      version: '0.0.1',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      codecs: () => [],
      mutationDefaultGenerators: () => [
        {
          id: 'correlationId',
          generate: () => ++counterMarker.invocations,
          stability: 'row',
        },
      ],
      create() {
        return { familyId: 'sql' as const, targetId: 'postgres' as const };
      },
    };

    const contractWithCorrelationId: Contract<SqlStorage> = {
      ...testContract,
      storage: new SqlStorage({
        storageHash: coreHash('test'),
        namespaces: {
          __unbound__: createTestSqlNamespace({
            id: '__unbound__',
            entries: {
              table: {
                event: {
                  columns: {
                    id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                    causation: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                    correlation: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          }),
        },
      }),
      execution: {
        executionHash: executionHash('test'),
        mutations: {
          defaults: [
            {
              ref: { namespace: '__unbound__', entry: 'event', field: 'causation' },
              onCreate: { kind: 'generator', id: 'correlationId' },
            },
            {
              ref: { namespace: '__unbound__', entry: 'event', field: 'correlation' },
              onCreate: { kind: 'generator', id: 'correlationId' },
            },
          ],
        },
      },
    };

    const context = createExecutionContext({
      contract: contractWithCorrelationId,
      stack: createStack({ extensions: [rowGeneratorExtension] }),
    });

    const row1 = context.applyMutationDefaults({
      op: 'create',
      table: 'event',
      namespace: '__unbound__',
      values: { id: 1 },
    });
    const row2 = context.applyMutationDefaults({
      op: 'create',
      table: 'event',
      namespace: '__unbound__',
      values: { id: 2 },
    });

    expect(counterMarker.invocations).toBe(2);
    expect(row1).toEqual([
      { column: 'causation', value: 1 },
      { column: 'correlation', value: 1 },
    ]);
    expect(row2).toEqual([
      { column: 'causation', value: 2 },
      { column: 'correlation', value: 2 },
    ]);
  });

  it('does not consult defaultValueCache for field-stable generators', () => {
    const counterMarker = { invocations: 0 };
    const perFieldGeneratorExtension: SqlRuntimeExtensionDescriptor<'postgres'> = {
      kind: 'extension' as const,
      id: 'per-field-generator-extension',
      version: '0.0.1',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      codecs: () => [],
      mutationDefaultGenerators: () => [
        {
          id: 'perFieldCounter',
          generate: () => ++counterMarker.invocations,
          stability: 'field',
        },
      ],
      create() {
        return { familyId: 'sql' as const, targetId: 'postgres' as const };
      },
    };

    const contractWithCounter: Contract<SqlStorage> = {
      ...testContract,
      storage: new SqlStorage({
        storageHash: coreHash('test'),
        namespaces: {
          __unbound__: createTestSqlNamespace({
            id: '__unbound__',
            entries: {
              table: {
                user: {
                  columns: {
                    id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          }),
        },
      }),
      execution: {
        executionHash: executionHash('test'),
        mutations: {
          defaults: [
            {
              ref: { namespace: '__unbound__', entry: 'user', field: 'id' },
              onCreate: { kind: 'generator', id: 'perFieldCounter' },
            },
          ],
        },
      },
    };

    const context = createExecutionContext({
      contract: contractWithCounter,
      stack: createStack({ extensions: [perFieldGeneratorExtension] }),
    });

    const defaultValueCache = new Map<string, unknown>();
    const row1 = context.applyMutationDefaults({
      op: 'create',
      table: 'user',
      namespace: '__unbound__',
      values: {},
      defaultValueCache,
    });
    const row2 = context.applyMutationDefaults({
      op: 'create',
      table: 'user',
      namespace: '__unbound__',
      values: {},
      defaultValueCache,
    });

    expect(counterMarker.invocations).toBe(2);
    expect(row1).toEqual([{ column: 'id', value: 1 }]);
    expect(row2).toEqual([{ column: 'id', value: 2 }]);
  });
});

describe('capability folding', () => {
  function targetWithCapabilities(
    capabilities: Record<string, unknown>,
  ): SqlRuntimeTargetDescriptor<'postgres'> {
    return { ...createTestTargetDescriptor(), capabilities };
  }

  function adapterWithCapabilities(
    capabilities: Record<string, unknown>,
  ): SqlRuntimeAdapterDescriptor<'postgres'> {
    return {
      ...createTestAdapterDescriptor(createStubAdapter()),
      capabilities,
    };
  }

  function extensionWithCapabilities(
    id: string,
    capabilities: Record<string, unknown>,
  ): SqlRuntimeExtensionDescriptor<'postgres'> {
    return {
      kind: 'extension' as const,
      id,
      version: '0.0.1',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      capabilities,
      codecs: () => [],
      create() {
        return { familyId: 'sql' as const, targetId: 'postgres' as const };
      },
    };
  }

  function driverWithCapabilities(
    capabilities: Record<string, unknown>,
  ): RuntimeDriverDescriptor<'sql', 'postgres', unknown, SqlRuntimeDriverInstance<'postgres'>> {
    return {
      kind: 'driver' as const,
      id: 'test-driver',
      version: '0.0.1',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      capabilities,
      create() {
        return {
          familyId: 'sql' as const,
          targetId: 'postgres' as const,
        } as unknown as SqlRuntimeDriverInstance<'postgres'>;
      },
    };
  }

  it('folds adapter capabilities into context.contract.capabilities', () => {
    const stack: SqlExecutionStack<'postgres'> = {
      target: createTestTargetDescriptor(),
      adapter: adapterWithCapabilities({ sql: { returning: true } }),
      extensions: [],
    };

    const context = createExecutionContext({ contract: testContract, stack });

    expect(context.contract.capabilities).toEqual({ sql: { returning: true } });
  });

  it('folds driver capabilities when a driver is supplied via options', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: {
        target: createTestTargetDescriptor(),
        adapter: createTestAdapterDescriptor(createStubAdapter()),
        extensions: [],
      },
      driver: driverWithCapabilities({ postgres: { cursor: true } }),
    });

    expect(context.contract.capabilities).toEqual({ postgres: { cursor: true } });
  });

  it('later contributor wins on key collision (adapter overrides target)', () => {
    const stack: SqlExecutionStack<'postgres'> = {
      target: targetWithCapabilities({ sql: { returning: false } }),
      adapter: adapterWithCapabilities({ sql: { returning: true } }),
      extensions: [],
    };

    const context = createExecutionContext({ contract: testContract, stack });

    expect(context.contract.capabilities['sql']?.['returning']).toBe(true);
  });

  it('does not mutate the input contract', () => {
    const inputCapabilities = Object.freeze({ sql: Object.freeze({ select: true }) });
    const inputContract: Contract<SqlStorage> = Object.freeze({
      ...testContract,
      capabilities: inputCapabilities,
    });

    const context = createExecutionContext({
      contract: inputContract,
      stack: {
        target: createTestTargetDescriptor(),
        adapter: adapterWithCapabilities({ sql: { returning: true } }),
        extensions: [],
      },
    });

    expect(inputContract.capabilities).toBe(inputCapabilities);
    expect(inputCapabilities).toEqual({ sql: { select: true } });
    expect(context.contract).not.toBe(inputContract);
    expect(context.contract.capabilities).toEqual({
      sql: { returning: true, select: true },
    });
  });

  it('matches mergeCapabilityMatrices output across the full stack', () => {
    const target = targetWithCapabilities({ sql: { select: true } });
    const adapter = adapterWithCapabilities({ sql: { returning: true } });
    const driver = driverWithCapabilities({ postgres: { cursor: true } });
    const extension = extensionWithCapabilities('pgvector-test', {
      postgres: { 'vector.cosine': true },
    });

    const expected = mergeCapabilityMatrices(testContract.capabilities, [
      target,
      adapter,
      driver,
      extension,
    ]);

    const context = createExecutionContext({
      contract: testContract,
      stack: { target, adapter, extensions: [extension] },
      driver,
    });

    expect(context.contract.capabilities).toEqual(expected);
  });

  it('is idempotent when the same extension descriptor appears twice in the stack', () => {
    const extension = extensionWithCapabilities('dup-ext', {
      postgres: { lateral: true },
    });
    const stack: SqlExecutionStack<'postgres'> = {
      target: createTestTargetDescriptor(),
      adapter: createTestAdapterDescriptor(createStubAdapter()),
      extensions: [extension, extension],
    };

    const context = createExecutionContext({ contract: testContract, stack });

    expect(context.contract.capabilities).toEqual({ postgres: { lateral: true } });
  });
});
