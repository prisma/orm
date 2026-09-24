import { type Contract, coreHash, executionHash, profileHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import {
  createExecutionContext,
  type SqlExecutionStack,
  type SqlRuntimeExtensionDescriptor,
} from '../src/sql-context';
import {
  createStubAdapter,
  createTestAdapterDescriptor,
  createTestTargetDescriptor,
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
  extensions: {},
  capabilities: {},
  meta: {},
};

function createStack(
  extensions: ReadonlyArray<SqlRuntimeExtensionDescriptor<'postgres'>>,
): SqlExecutionStack<'postgres'> {
  return {
    target: createTestTargetDescriptor(),
    adapter: createTestAdapterDescriptor(createStubAdapter()),
    extensions,
  };
}

describe('composed runtime mutation default generators', () => {
  it('resolves a pack-contributed generator id', () => {
    const extension: SqlRuntimeExtensionDescriptor<'postgres'> = {
      kind: 'extension',
      id: 'test-mutation-defaults',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      codecs: () => [],
      mutationDefaultGenerators: () => [
        {
          id: 'slugid',
          generate: () => 'slug-from-pack',
          stability: 'field',
        },
      ],
      create() {
        return { familyId: 'sql', targetId: 'postgres' };
      },
    };

    const context = createExecutionContext({
      contract: {
        ...testContract,
        execution: {
          executionHash: executionHash('test'),
          mutations: {
            defaults: [
              {
                ref: { namespace: '__unbound__', entry: 'user', field: 'id' },
                onCreate: { kind: 'generator', id: 'slugid' },
              },
            ],
          },
        },
      },
      stack: createStack([extension]),
    });

    const applied = context.applyMutationDefaults({
      op: 'create',
      table: 'user',
      namespace: '__unbound__',
      values: {},
    });
    expect(applied).toEqual([{ column: 'id', value: 'slug-from-pack' }]);
  });

  it('skips generated default when user provides an explicit value', () => {
    const extension: SqlRuntimeExtensionDescriptor<'postgres'> = {
      kind: 'extension',
      id: 'test-mutation-defaults',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      codecs: () => [],
      mutationDefaultGenerators: () => [
        {
          id: 'slugid',
          generate: () => 'slug-from-pack',
          stability: 'field',
        },
      ],
      create() {
        return { familyId: 'sql', targetId: 'postgres' };
      },
    };

    const context = createExecutionContext({
      contract: {
        ...testContract,
        execution: {
          executionHash: executionHash('test'),
          mutations: {
            defaults: [
              {
                ref: { namespace: '__unbound__', entry: 'user', field: 'id' },
                onCreate: { kind: 'generator', id: 'slugid' },
              },
            ],
          },
        },
      },
      stack: createStack([extension]),
    });

    const applied = context.applyMutationDefaults({
      op: 'create',
      table: 'user',
      namespace: '__unbound__',
      values: { id: 'user-provided-value' },
    });
    expect(applied).toEqual([]);
  });

  it('throws error naming both owners when duplicate generator ids are composed', () => {
    const first: SqlRuntimeExtensionDescriptor<'postgres'> = {
      kind: 'extension',
      id: 'first-pack',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      codecs: () => [],
      mutationDefaultGenerators: () => [
        { id: 'duplicate', generate: () => 'first', stability: 'field' },
      ],
      create() {
        return { familyId: 'sql', targetId: 'postgres' };
      },
    };
    const second: SqlRuntimeExtensionDescriptor<'postgres'> = {
      kind: 'extension',
      id: 'second-pack',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      codecs: () => [],
      mutationDefaultGenerators: () => [
        { id: 'duplicate', generate: () => 'second', stability: 'field' },
      ],
      create() {
        return { familyId: 'sql', targetId: 'postgres' };
      },
    };

    expect(() =>
      createExecutionContext({
        contract: testContract,
        stack: createStack([first, second]),
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR',
        details: expect.objectContaining({
          existingOwner: 'first-pack',
          incomingOwner: 'second-pack',
        }),
      }),
    );
  });

  it('throws RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING at context creation when generator id is missing', () => {
    expect(() =>
      createExecutionContext({
        contract: {
          ...testContract,
          execution: {
            executionHash: executionHash('test'),
            mutations: {
              defaults: [
                {
                  ref: { namespace: '__unbound__', entry: 'user', field: 'id' },
                  onCreate: { kind: 'generator', id: 'unknown-generator' },
                },
              ],
            },
          },
        },
        stack: createStack([]),
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING',
        details: expect.objectContaining({
          ids: ['unknown-generator'],
        }),
      }),
    );
  });

  it('does not resolve built-in generator ids without composed contributors', () => {
    const adapterWithoutMutationDefaultGenerators = {
      ...createTestAdapterDescriptor(createStubAdapter()),
      mutationDefaultGenerators: () => [],
    };

    expect(() =>
      createExecutionContext({
        contract: {
          ...testContract,
          execution: {
            executionHash: executionHash('test'),
            mutations: {
              defaults: [
                {
                  ref: { namespace: '__unbound__', entry: 'user', field: 'id' },
                  onCreate: { kind: 'generator', id: 'uuidv4' },
                },
              ],
            },
          },
        },
        stack: {
          target: createTestTargetDescriptor(),
          adapter: adapterWithoutMutationDefaultGenerators,
          extensions: [],
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING',
        details: expect.objectContaining({
          ids: ['uuidv4'],
        }),
      }),
    );
  });
});
