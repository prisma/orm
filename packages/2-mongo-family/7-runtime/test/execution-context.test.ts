import type { ExecutionMutationDefault } from '@internal/contract/types';
import { mongoCodec, newMongoCodecRegistry } from '@internal/mongo-codec';
import { describe, expect, it } from 'vitest';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  type MongoRuntimeAdapterDescriptor,
  type MongoRuntimeExtensionDescriptor,
  type MongoRuntimeMutationDefaultGenerator,
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
  generators: readonly MongoRuntimeMutationDefaultGenerator[] = [],
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
    readonly generators?: readonly MongoRuntimeMutationDefaultGenerator[];
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

function counter(id: string, stability: MongoRuntimeMutationDefaultGenerator['stability']) {
  let next = 0;
  return { id, stability, generate: () => ++next } satisfies MongoRuntimeMutationDefaultGenerator;
}

function contractWith(defaults: readonly ExecutionMutationDefault[]) {
  return { execution: { executionHash: 'test', mutations: { defaults } } };
}

function contextFor(
  defaults: readonly ExecutionMutationDefault[],
  generators: readonly MongoRuntimeMutationDefaultGenerator[] = [counter('clock', 'query')],
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

  it('applies nothing for a contract without an execution section', () => {
    const stack = createMongoExecutionStack({ target: target(), adapter: adapter() });
    const context = createMongoExecutionContext({ contract: {}, stack });
    expect(
      context.applyMutationDefaults({ op: 'create', namespace: NS, entry: 'posts', values: {} }),
    ).toEqual([]);
  });
});

describe('applyMutationDefaults', () => {
  it('fills onCreate defaults on create', () => {
    expect(fields(contextFor([createdAt, updatedAt]), 'create', { title: 'x' })).toEqual([
      'createdAt',
      'updatedAt',
    ]);
  });

  it('never overwrites a field the write sets explicitly', () => {
    expect(
      fields(contextFor([createdAt, updatedAt]), 'create', { updatedAt: new Date(0) }),
    ).toEqual(['createdAt']);
  });

  it('treats a field set to undefined as absent', () => {
    expect(fields(contextFor([updatedAt]), 'create', { updatedAt: undefined })).toEqual([
      'updatedAt',
    ]);
  });

  it('applies onUpdate defaults only to a non-empty update', () => {
    const context = contextFor([createdAt, updatedAt]);
    expect(fields(context, 'update', {})).toEqual([]);
    expect(fields(context, 'update', { title: undefined })).toEqual([]);
    expect(fields(context, 'update', { title: 'y' })).toEqual(['updatedAt']);
  });

  it('applies only the defaults of the targeted namespace and collection', () => {
    const context = contextFor([
      { ...createdAt, ref: { ...createdAt.ref, entry: 'comments' } },
      { ...createdAt, ref: { ...createdAt.ref, namespace: 'other' } },
    ]);
    expect(fields(context, 'create', {})).toEqual([]);
  });

  it('applies a ref declared twice only once', () => {
    expect(fields(contextFor([createdAt, createdAt]), 'create', {})).toEqual(['createdAt']);
  });
});

describe('applyMutationDefaults stability', () => {
  const twoFields: ExecutionMutationDefault[] = [
    {
      ref: { namespace: NS, entry: 'posts', field: 'a' },
      onCreate: { kind: 'generator', id: 'seq' },
    },
    {
      ref: { namespace: NS, entry: 'posts', field: 'b' },
      onCreate: { kind: 'generator', id: 'seq' },
    },
  ];
  const values = (
    context: ReturnType<typeof contextFor>,
    defaultValueCache?: Map<string, unknown>,
  ) =>
    context
      .applyMutationDefaults({
        op: 'create',
        namespace: NS,
        entry: 'posts',
        values: {},
        ...(defaultValueCache ? { defaultValueCache } : {}),
      })
      .map((d) => d.value);

  it("'field' yields a value per field", () => {
    expect(values(contextFor(twoFields, [counter('seq', 'field')]))).toEqual([1, 2]);
  });

  it("'row' shares one value across the fields of one call and regenerates on the next", () => {
    const context = contextFor(twoFields, [counter('seq', 'row')]);
    expect(values(context)).toEqual([1, 1]);
    expect(values(context)).toEqual([2, 2]);
  });

  it("'query' shares one value across calls through the caller's cache", () => {
    const context = contextFor(twoFields, [counter('seq', 'query')]);
    const cache = new Map<string, unknown>();
    expect(values(context, cache)).toEqual([1, 1]);
    expect(values(context, cache)).toEqual([1, 1]);
    expect(values(context, new Map())).toEqual([2, 2]);
  });

  it("'query' without a cache yields a value per field", () => {
    const context = contextFor(twoFields, [counter('seq', 'query')]);
    expect(values(context)).toEqual([1, 2]);
  });
});
