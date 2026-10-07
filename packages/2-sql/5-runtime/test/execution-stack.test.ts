import { createExecutionStack } from '@internal/framework-components/execution';
import type { Codec } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createExecutionContext, createSqlExecutionStack } from '../src/exports';
import type {
  ExecutionContext,
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeExtensionDescriptor,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { defineTestCodec } from './test-codec';
import { createTestContract, descriptorsFromCodecs } from './utils';

function createStubAdapterDescriptor(): SqlRuntimeAdapterDescriptor<'postgres'> {
  const registry: ReadonlyArray<Codec<string>> = [
    defineTestCodec({
      typeId: 'pg/text@1',
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    }),
  ];

  return {
    kind: 'adapter',
    rawCodecInferer: { inferCodec: () => 'pg/text' },
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptorsFromCodecs(registry),
    create() {
      return Object.assign(
        {
          familyId: 'sql' as const,
          targetId: 'postgres' as const,
        },
        {
          profile: {
            id: 'test-profile',
            target: 'postgres',
            capabilities: {},
            readMarker: async () => ({ kind: 'absent' as const }),
          },
          lower() {
            return Object.freeze({ sql: '', params: [] });
          },
        },
      );
    },
  };
}

function createStubTargetDescriptor(): SqlRuntimeTargetDescriptor<'postgres'> {
  return {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => [],
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

function createStubExtensionDescriptor(): SqlRuntimeExtensionDescriptor<'postgres'> {
  const registry: ReadonlyArray<Codec<string>> = [
    defineTestCodec({
      typeId: 'pg/uuid@1',
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    }),
  ];

  const operations = {
    example: {
      impl: () => undefined as never,
    },
  };

  return {
    kind: 'extension',
    id: 'test-extension',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptorsFromCodecs(registry),
    queryOperations: () => operations,
    create() {
      return {
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
      };
    },
  };
}

describe('createExecutionStack', () => {
  it('defaults driver to undefined and extensions to empty', () => {
    const stack = createExecutionStack({
      target: createStubTargetDescriptor(),
      adapter: createStubAdapterDescriptor(),
    });

    expect(stack.driver).toBeUndefined();
    expect(stack.extensions).toEqual([]);
  });

  it('creates an execution context from descriptors-only stack', () => {
    const contract = createTestContract({
      storage: {},
    });

    const context = createExecutionContext({
      contract,
      stack: {
        target: createStubTargetDescriptor(),
        adapter: createStubAdapterDescriptor(),
        extensions: [createStubExtensionDescriptor()],
      },
    }) as ExecutionContext<typeof contract>;

    expect(context.contract).toEqual(contract);
    expect(context.codecDescriptors.descriptorFor('pg/text@1')).toBeDefined();
    expect(context.codecDescriptors.descriptorFor('pg/uuid@1')).toBeDefined();
    expect(context.queryOperations.entries()['example']).toBeDefined();
    expect(context.types).toEqual({});
  });
});

describe('createSqlExecutionStack', () => {
  it('preserves descriptor references and defaults extensions', () => {
    const target = createStubTargetDescriptor();
    const adapter = createStubAdapterDescriptor();
    const stack = createSqlExecutionStack({ target, adapter });

    expect(stack.target).toBe(target);
    expect(stack.adapter).toBe(adapter);
    expect(stack.extensions).toEqual([]);
  });

  it('keeps extension packs intact', () => {
    const target = createStubTargetDescriptor();
    const adapter = createStubAdapterDescriptor();
    const extension = createStubExtensionDescriptor();
    const stack = createSqlExecutionStack({ target, adapter, extensions: [extension] });

    expect(stack.extensions).toEqual([extension]);
  });
});
