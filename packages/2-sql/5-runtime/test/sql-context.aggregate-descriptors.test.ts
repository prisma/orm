import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import { dataTypeId } from '@internal/framework-components/codec';
import type { AggregateDescriptor } from '@internal/framework-components/components';
import { SqlStorage } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type {
  SqlExecutionStack,
  SqlRuntimeExtensionDescriptor,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { createExecutionContext } from '../src/sql-context';
import { defineTestCodec } from './test-codec';
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
      __unbound__: createTestSqlNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
  extensions: {},
  capabilities: {},
  meta: {},
};

const numericCodecDescriptor: AnyCodecDescriptor = {
  codecId: 'test/int@1',
  dataType: dataTypeId('test/int'),
  traits: ['numeric', 'order'],
  targetTypes: ['int'],
  isParameterized: false,
  paramsSchema: {
    '~standard': {
      version: 1,
      vendor: 'sql-runtime/aggregate-descriptor-test',
      validate: () => ({ value: undefined }),
    },
  },
  factory: () => () =>
    defineTestCodec({
      typeId: 'test/int@1',
      encode: (v: number) => v,
      decode: (w: number) => w,
    }),
};

const bigintCodecDescriptor: AnyCodecDescriptor = {
  ...numericCodecDescriptor,
  codecId: 'test/bigint@1',
  targetTypes: ['bigint'],
  factory: () => () =>
    defineTestCodec({
      typeId: 'test/bigint@1',
      encode: (v: number) => v,
      decode: (w: number) => w,
    }),
};

const countRows: AggregateDescriptor = {
  operation: 'count',
  input: { kind: 'none' },
  output: { kind: 'codec', codecId: 'test/bigint@1' },
  nullable: false,
  emptyResultJson: '0',
};

const sumNumeric: AggregateDescriptor = {
  operation: 'sum',
  input: { kind: 'trait', trait: 'numeric' },
  output: { kind: 'codec', codecId: 'test/bigint@1' },
  nullable: true,
};

function targetContributing(
  aggregateDescriptors: ReadonlyArray<AggregateDescriptor>,
): SqlRuntimeTargetDescriptor<'postgres'> {
  return {
    ...createTestTargetDescriptor(),
    codecs: () => [numericCodecDescriptor, bigintCodecDescriptor],
    types: { aggregateDescriptors },
  };
}

function extensionContributing(
  aggregateDescriptors: ReadonlyArray<AggregateDescriptor>,
): SqlRuntimeExtensionDescriptor<'postgres'> {
  return {
    kind: 'extension' as const,
    id: 'test-extension',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => [],
    types: { aggregateDescriptors },
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

function stackWith(options: {
  target: SqlRuntimeTargetDescriptor<'postgres'>;
  extensions?: ReadonlyArray<SqlRuntimeExtensionDescriptor<'postgres'>>;
}): SqlExecutionStack<'postgres'> {
  return {
    target: options.target,
    adapter: createTestAdapterDescriptor(createStubAdapter()),
    extensions: options.extensions ?? [],
  };
}

describe('createExecutionContext — aggregate descriptors', () => {
  it('exposes a registry resolving the contributed target descriptors', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: stackWith({ target: targetContributing([countRows]) }),
    });

    expect(context.aggregateDescriptors.resolve('count')).toEqual({
      operation: 'count',
      output: { codecId: 'test/bigint@1' },
      nullable: false,
      emptyResultJson: '0',
      lower: undefined,
    });
  });

  it('resolves a trait match against the composed codec set', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: stackWith({ target: targetContributing([sumNumeric]) }),
    });

    expect(context.aggregateDescriptors.resolve('sum', { codecId: 'test/int@1' })?.output).toEqual({
      codecId: 'test/bigint@1',
    });
  });

  it('combines contributions from the target and its extensions', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: stackWith({
        target: targetContributing([countRows]),
        extensions: [extensionContributing([sumNumeric])],
      }),
    });

    expect([...context.aggregateDescriptors.values()]).toEqual([countRows, sumNumeric]);
  });

  it('resolves to undefined when no component contributes descriptors', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: stackWith({ target: createTestTargetDescriptor() }),
    });

    expect(context.aggregateDescriptors.resolve('count')).toBeUndefined();
  });

  it('fails at context construction when two components claim one operation and input', () => {
    expect(() =>
      createExecutionContext({
        contract: testContract,
        stack: stackWith({
          target: targetContributing([countRows]),
          extensions: [extensionContributing([countRows])],
        }),
      }),
    ).toThrow(/Duplicate aggregate descriptor for 'count:none'/);
  });

  it('fails at context construction on a malformed contribution', () => {
    const malformed = [
      { operation: 'sum', nullable: true },
    ] as unknown as ReadonlyArray<AggregateDescriptor>;

    expect(() =>
      createExecutionContext({
        contract: testContract,
        stack: stackWith({ target: targetContributing(malformed) }),
      }),
    ).toThrow(/is not a valid SQL aggregate descriptor/);
  });

  it('fails at context construction when a descriptor names a result codec the stack does not compose', () => {
    expect(() =>
      createExecutionContext({
        contract: testContract,
        stack: stackWith({
          target: targetContributing([
            { ...countRows, output: { kind: 'codec', codecId: 'test/absent@1' } },
          ]),
        }),
      }),
    ).toThrow(/names result codec 'test\/absent@1', which the composed stack does not register/);
  });
});
