import { type ExecutionMutationDefault, executionHash } from '@internal/contract/types';
import { type DataTypeValue, dataType, readJsonString } from '@internal/framework-components/codec';
import type { RuntimeMutationDefaultGenerator } from '@internal/framework-components/runtime';
import { mongoCodec, mongoCodecDescriptor } from '@internal/mongo-codec';
import type { MongoContract } from '@internal/mongo-contract';
import { describe, expect, it } from 'vitest';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  type MongoRuntimeAdapterDescriptor,
  type MongoRuntimeExtensionDescriptor,
  type MongoRuntimeTargetDescriptor,
} from '../src/mongo-execution-stack';
import { testContract } from './mongo-middleware-fixtures';

const NS = '__unbound__';

const textType = dataType('test/text', { read: (json) => readJsonString('test/text', json) });

function codecTypesWith(...ids: readonly string[]) {
  return {
    codecTypes: {
      codecDescriptors: ids.map((id) =>
        mongoCodecDescriptor(
          mongoCodec({
            typeId: id,
            fromWire: (w: string) => w,
            toWire: (v: string) => v,
            dataType: textType,
            fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
          }),
          { traits: [] },
        ),
      ),
    },
  };
}

function target(): MongoRuntimeTargetDescriptor<'mongo'> {
  return {
    kind: 'target',
    id: 'test-target',
    familyId: 'mongo',
    targetId: 'mongo',
    version: '0.0.1',
    types: codecTypesWith('test/target@1'),
    create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
  };
}

function adapter(
  generators: readonly RuntimeMutationDefaultGenerator[] = [],
): MongoRuntimeAdapterDescriptor<'mongo'> {
  return {
    kind: 'adapter',
    id: 'test-adapter',
    familyId: 'mongo',
    targetId: 'mongo',
    version: '0.0.1',
    types: codecTypesWith('test/adapter@1'),
    mutationDefaultGenerators: () => generators,
    create: () => {
      throw new Error('the execution context never instantiates the adapter');
    },
  };
}

function extension(
  id: string,
  options: {
    readonly codecIds?: readonly string[];
    readonly generators?: readonly RuntimeMutationDefaultGenerator[];
  },
): MongoRuntimeExtensionDescriptor<'mongo'> {
  return {
    kind: 'extension',
    id,
    familyId: 'mongo',
    targetId: 'mongo',
    version: '0.0.1',
    types: codecTypesWith(...(options.codecIds ?? [])),
    ...(options.generators ? { mutationDefaultGenerators: () => options.generators ?? [] } : {}),
    create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
  };
}

function counter(id: string, stability: RuntimeMutationDefaultGenerator['stability']) {
  let next = 0;
  return { id, stability, generate: () => ++next } satisfies RuntimeMutationDefaultGenerator;
}

function contractWith(defaults: readonly ExecutionMutationDefault[]): MongoContract {
  return {
    ...testContract,
    execution: { executionHash: executionHash('test'), mutations: { defaults } },
  };
}

function contextFor(
  defaults: readonly ExecutionMutationDefault[],
  generators: readonly RuntimeMutationDefaultGenerator[] = [counter('clock', 'query')],
) {
  const stack = createMongoExecutionStack({ target: target(), adapter: adapter(generators) });
  return createMongoExecutionContext({ contract: contractWith(defaults), stack });
}

const clock = { kind: 'generator', id: 'clock' } as const;
const updatedAt: ExecutionMutationDefault = {
  ref: { namespace: NS, entry: 'posts', field: 'updatedAt' },
  onCreate: clock,
  onUpdate: clock,
};
const createdAt: ExecutionMutationDefault = {
  ref: { namespace: NS, entry: 'posts', field: 'createdAt' },
  onCreate: clock,
};

function fields(
  context: ReturnType<typeof contextFor>,
  op: 'create' | 'update',
  values: Record<string, unknown>,
) {
  return context
    .applyMutationDefaults({ op, namespace: NS, entry: 'posts', values })
    .map((d) => d.field);
}

describe('createMongoExecutionContext composition', () => {
  it('folds the codecs of target, adapter and extensions into one lookup', () => {
    const stack = createMongoExecutionStack({
      target: target(),
      adapter: adapter(),
      extensions: [extension('test-extension', { codecIds: ['test/extension@1'] })],
    });
    const context = createMongoExecutionContext({ contract: testContract, stack });
    for (const id of ['test/target@1', 'test/adapter@1', 'test/extension@1']) {
      expect(context.codecs.has(id)).toBe(true);
    }
    expect(Object.isFrozen(context)).toBe(true);
  });

  it('throws RUNTIME.DUPLICATE_CODEC naming both owners', () => {
    const stack = createMongoExecutionStack({
      target: target(),
      adapter: adapter(),
      extensions: [extension('test-extension', { codecIds: ['test/adapter@1'] })],
    });
    expect(() => createMongoExecutionContext({ contract: testContract, stack })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DUPLICATE_CODEC',
        details: expect.objectContaining({
          existingOwner: 'test-adapter',
          incomingOwner: 'test-extension',
        }),
      }),
    );
  });

  it('throws RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR naming both owners', () => {
    const stack = createMongoExecutionStack({
      target: target(),
      adapter: adapter([counter('clock', 'query')]),
      extensions: [extension('test-extension', { generators: [counter('clock', 'field')] })],
    });
    expect(() => createMongoExecutionContext({ contract: testContract, stack })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR',
        details: expect.objectContaining({
          id: 'clock',
          existingOwner: 'test-adapter',
          incomingOwner: 'test-extension',
        }),
      }),
    );
  });

  it('throws RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING at creation for an unregistered generator', () => {
    expect(() => contextFor([createdAt], [])).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING',
        message:
          "Contract requires mutation default generator 'clock' for posts.createdAt, but no runtime component in the execution stack provides it. Built-in generators such as 'timestampNow' come from the database adapter's runtime descriptor, and others from the extension pack that defines them; include that component in the execution stack.",
      }),
    );
  });

  it('checks mutation default generators before collecting codecs', () => {
    const stack = createMongoExecutionStack({
      target: target(),
      adapter: adapter(),
      extensions: [extension('test-extension', { codecIds: ['test/adapter@1'] })],
    });
    expect(() =>
      createMongoExecutionContext({ contract: contractWith([createdAt]), stack }),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING' }));
  });

  it('applies nothing for a contract without an execution section', () => {
    const stack = createMongoExecutionStack({ target: target(), adapter: adapter() });
    const context = createMongoExecutionContext({ contract: testContract, stack });
    expect(
      context.applyMutationDefaults({ op: 'create', namespace: NS, entry: 'posts', values: {} }),
    ).toEqual([]);
  });
});

describe('context.applyMutationDefaults', () => {
  it('fills defaults with the generators the stack contributes', () => {
    expect(fields(contextFor([createdAt, updatedAt]), 'create', { title: 'x' })).toEqual([
      'createdAt',
      'updatedAt',
    ]);
    expect(fields(contextFor([createdAt, updatedAt]), 'update', { title: 'y' })).toEqual([
      'updatedAt',
    ]);
  });
});

describe('createMongoExecutionContext contract requirements', () => {
  const requiringX: MongoContract = { ...testContract, extensions: { x: {} } };

  it('throws RUNTIME.MISSING_EXTENSION_PACK when the stack lacks a required extension', () => {
    const stack = createMongoExecutionStack({ target: target(), adapter: adapter() });
    expect(() => createMongoExecutionContext({ contract: requiringX, stack })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.MISSING_EXTENSION_PACK',
        message:
          "Contract requires extension pack(s) 'x', but runtime descriptors do not provide matching component(s).",
        details: { packIds: ['x'] },
      }),
    );
  });

  it('builds the context when the stack provides the required extension', () => {
    const stack = createMongoExecutionStack({
      target: target(),
      adapter: adapter(),
      extensions: [extension('x', {})],
    });
    expect(createMongoExecutionContext({ contract: requiringX, stack }).contract).toBe(requiringX);
  });

  it('throws RUNTIME.CONTRACT_TARGET_MISMATCH for a contract of another target', () => {
    const stack = createMongoExecutionStack({ target: target(), adapter: adapter() });
    const contract: MongoContract = { ...testContract, target: 'postgres' };
    expect(() => createMongoExecutionContext({ contract, stack })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.CONTRACT_TARGET_MISMATCH',
        message: "Contract target 'postgres' does not match runtime target descriptor 'mongo'.",
      }),
    );
  });

  it('throws RUNTIME.CONTRACT_FAMILY_MISMATCH for a contract of another family', () => {
    const stack = createMongoExecutionStack({ target: target(), adapter: adapter() });
    const contract: MongoContract = { ...testContract, targetFamily: 'sql' };
    expect(() => createMongoExecutionContext({ contract, stack })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.CONTRACT_FAMILY_MISMATCH',
        message: "Contract target family 'sql' does not match runtime family 'mongo'.",
      }),
    );
  });
});
