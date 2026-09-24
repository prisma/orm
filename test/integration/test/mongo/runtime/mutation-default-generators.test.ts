import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import type { ExecutionMutationDefault } from '@internal/contract/types';
import { newMongoCodecRegistry } from '@internal/mongo-codec';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  type MongoRuntimeExtensionDescriptor,
  type MongoRuntimeMutationDefaultGenerator,
} from '@internal/mongo-runtime';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { describe, expect, it } from 'vitest';

const NS = '__unbound__';

function contractWith(defaults: readonly ExecutionMutationDefault[]) {
  return { execution: { executionHash: 'test', mutations: { defaults } } };
}

function generator(id: string) {
  return { kind: 'generator', id } as const;
}

function extensionWith(
  id: string,
  generators: readonly MongoRuntimeMutationDefaultGenerator[],
): MongoRuntimeExtensionDescriptor<'mongo'> {
  return {
    kind: 'extension',
    id,
    familyId: 'mongo',
    targetId: 'mongo',
    version: '0.0.1',
    codecs: () => newMongoCodecRegistry(),
    mutationDefaultGenerators: () => generators,
    create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
  };
}

function counter(id: string, stability: MongoRuntimeMutationDefaultGenerator['stability']) {
  let next = 0;
  return { id, stability, generate: () => ++next } satisfies MongoRuntimeMutationDefaultGenerator;
}

function contextFor(
  defaults: readonly ExecutionMutationDefault[],
  generators: readonly MongoRuntimeMutationDefaultGenerator[] = [],
) {
  const stack = createMongoExecutionStack({
    target: mongoRuntimeTarget,
    adapter: mongoRuntimeAdapter,
    extensions: generators.length > 0 ? [extensionWith('test-generators', generators)] : [],
  });
  return createMongoExecutionContext({ contract: contractWith(defaults), stack });
}

const updatedAt: ExecutionMutationDefault = {
  ref: { namespace: NS, entry: 'posts', field: 'updatedAt' },
  onCreate: generator('timestampNow'),
  onUpdate: generator('timestampNow'),
};
const createdAt: ExecutionMutationDefault = {
  ref: { namespace: NS, entry: 'posts', field: 'createdAt' },
  onCreate: generator('timestampNow'),
};

describe('Mongo runtime mutation default generators', () => {
  it('fills timestampNow from the adapter-registered generator', () => {
    const context = contextFor([createdAt, updatedAt]);
    const applied = context.applyMutationDefaults({
      op: 'create',
      namespace: NS,
      entry: 'posts',
      values: { title: 'x' },
    });
    expect(applied.map((d) => d.field)).toEqual(['createdAt', 'updatedAt']);
    for (const { value } of applied) expect(value).toBeInstanceOf(Date);
  });

  it('throws RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING at context creation for an unregistered generator', () => {
    expect(() =>
      contextFor([
        { ref: { namespace: NS, entry: 'posts', field: 'slug' }, onCreate: generator('slugify') },
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING',
        message:
          "Contract requires mutation default generator(s) 'slugify', but no runtime component provides them.",
      }),
    );
  });

  it('throws RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR naming both owners', () => {
    expect(() => contextFor([], [counter('timestampNow', 'query')])).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR',
        details: expect.objectContaining({
          id: 'timestampNow',
          existingOwner: 'mongo',
          incomingOwner: 'test-generators',
        }),
      }),
    );
  });

  it('never overwrites a field the write sets explicitly', () => {
    const explicit = new Date('2020-01-01T00:00:00Z');
    const applied = contextFor([createdAt, updatedAt]).applyMutationDefaults({
      op: 'create',
      namespace: NS,
      entry: 'posts',
      values: { updatedAt: explicit },
    });
    expect(applied.map((d) => d.field)).toEqual(['createdAt']);
  });

  it('treats a field set to undefined as absent', () => {
    const applied = contextFor([updatedAt]).applyMutationDefaults({
      op: 'create',
      namespace: NS,
      entry: 'posts',
      values: { updatedAt: undefined },
    });
    expect(applied.map((d) => d.field)).toEqual(['updatedAt']);
  });

  it('applies onUpdate defaults only to a non-empty update', () => {
    const context = contextFor([createdAt, updatedAt]);
    const update = (values: Record<string, unknown>) =>
      context
        .applyMutationDefaults({ op: 'update', namespace: NS, entry: 'posts', values })
        .map((d) => d.field);
    expect(update({})).toEqual([]);
    expect(update({ title: undefined })).toEqual([]);
    expect(update({ title: 'y' })).toEqual(['updatedAt']);
  });

  it('applies only the defaults of the targeted namespace and collection', () => {
    const elsewhere: ExecutionMutationDefault[] = [
      { ...createdAt, ref: { ...createdAt.ref, entry: 'comments' } },
      { ...createdAt, ref: { ...createdAt.ref, namespace: 'other' } },
    ];
    const applied = contextFor(elsewhere).applyMutationDefaults({
      op: 'create',
      namespace: NS,
      entry: 'posts',
      values: {},
    });
    expect(applied).toEqual([]);
  });

  it('applies a ref declared twice only once', () => {
    const applied = contextFor([createdAt, createdAt]).applyMutationDefaults({
      op: 'create',
      namespace: NS,
      entry: 'posts',
      values: {},
    });
    expect(applied.map((d) => d.field)).toEqual(['createdAt']);
  });
});

describe('Mongo runtime mutation default stability', () => {
  const twoFields = (id: string): ExecutionMutationDefault[] => [
    { ref: { namespace: NS, entry: 'posts', field: 'a' }, onCreate: generator(id) },
    { ref: { namespace: NS, entry: 'posts', field: 'b' }, onCreate: generator(id) },
  ];
  const create = (
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
    const context = contextFor(twoFields('seq'), [counter('seq', 'field')]);
    expect(create(context)).toEqual([1, 2]);
  });

  it("'row' shares one value across the fields of one call", () => {
    const context = contextFor(twoFields('seq'), [counter('seq', 'row')]);
    expect(create(context)).toEqual([1, 1]);
    expect(create(context)).toEqual([2, 2]);
  });

  it("'query' shares one value across calls through the caller's cache", () => {
    const context = contextFor(twoFields('seq'), [counter('seq', 'query')]);
    const cache = new Map<string, unknown>();
    expect(create(context, cache)).toEqual([1, 1]);
    expect(create(context, cache)).toEqual([1, 1]);
    expect(create(context, new Map())).toEqual([2, 2]);
  });
});
