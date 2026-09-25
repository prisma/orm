import type { ExecutionMutationDefault } from '@internal/contract/types';
import type { RuntimeMutationDefaultGenerator } from '@internal/framework-components/runtime';
import { mongoCodec, newMongoCodecRegistry } from '@internal/mongo-codec';
import { describe, expect, it } from 'vitest';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  type MongoRuntimeAdapterDescriptor,
  type MongoRuntimeExtensionDescriptor,
  type MongoRuntimeTargetDescriptor,
} from '../src/mongo-execution-stack';

const NS = '__unbound__';

function registryWith(...ids: readonly string[]) {
  const registry = newMongoCodecRegistry();
  for (const id of ids) {
    registry.register(
      mongoCodec({ typeId: id, decode: (w: string) => w, encode: (v: string) => v }),
    );
  }
  return registry;
}

function target(): MongoRuntimeTargetDescriptor<'mongo'> {
  return {
    kind: 'target',
    id: 'test-target',
    familyId: 'mongo',
    targetId: 'mongo',
    version: '0.0.1',
    codecs: () => registryWith('test/target@1'),
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
    codecs: () => registryWith('test/adapter@1'),
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
    codecs: () => registryWith(...(options.codecIds ?? [])),
    ...(options.generators ? { mutationDefaultGenerators: () => options.generators ?? [] } : {}),
    create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
  };
}

function counter(id: string, stability: RuntimeMutationDefaultGenerator['stability']) {
  let next = 0;
  return { id, stability, generate: () => ++next } satisfies RuntimeMutationDefaultGenerator;
}

function contractWith(defaults: readonly ExecutionMutationDefault[]) {
  return { execution: { executionHash: 'test', mutations: { defaults } } };
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
    const context = createMongoExecutionContext({ contract: {}, stack });
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
    expect(() => createMongoExecutionContext({ contract: {}, stack })).toThrow(
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
    expect(() => createMongoExecutionContext({ contract: {}, stack })).toThrow(
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
          "Contract requires mutation default generator(s) 'clock', but no runtime component provides them.",
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
    const context = createMongoExecutionContext({ contract: {}, stack });
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
