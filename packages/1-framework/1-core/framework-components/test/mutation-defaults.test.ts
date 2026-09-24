import {
  type ContractExecutionSection,
  type ExecutionMutationDefault,
  executionHash,
} from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  applyMutationDefaults,
  assertMutationDefaultGeneratorsAvailable,
  collectMutationDefaultGenerators,
  type GeneratorStability,
  type MutationDefaultGeneratorContributor,
  type RuntimeMutationDefaultGenerator,
} from '../src/execution/mutation-defaults';

function execution(defaults: ReadonlyArray<ExecutionMutationDefault>): ContractExecutionSection {
  return { executionHash: executionHash('test'), mutations: { defaults } };
}

function counterGenerator(
  id: string,
  stability: GeneratorStability,
): RuntimeMutationDefaultGenerator & { readonly calls: () => number } {
  let invocations = 0;
  return {
    id,
    stability,
    generate: () => ++invocations,
    calls: () => invocations,
  };
}

const sizedIdGenerator: RuntimeMutationDefaultGenerator = {
  id: 'sizedId',
  stability: 'field',
  generate: (params) => 'x'.repeat(Number(params?.['size'] ?? 1)),
};

function contributor(
  id: string,
  generators: ReadonlyArray<RuntimeMutationDefaultGenerator>,
): MutationDefaultGeneratorContributor {
  return { id, mutationDefaultGenerators: () => generators };
}

describe('collectMutationDefaultGenerators', () => {
  it('registers every contributed generator by id', () => {
    const registry = collectMutationDefaultGenerators([
      contributor('target', [sizedIdGenerator]),
      { id: 'adapter' },
      contributor('extension', [counterGenerator('counter', 'query')]),
    ]);
    expect([...registry.keys()]).toEqual(['sizedId', 'counter']);
    expect(registry.get('sizedId')).toBe(sizedIdGenerator);
  });

  it('rejects a generator id two contributors provide, naming both owners', () => {
    expect(() =>
      collectMutationDefaultGenerators([
        contributor('first-pack', [
          { id: 'duplicate', generate: () => 'first', stability: 'field' },
        ]),
        contributor('second-pack', [
          { id: 'duplicate', generate: () => 'second', stability: 'field' },
        ]),
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR',
        message: "Duplicate mutation default generator 'duplicate'.",
        details: { id: 'duplicate', existingOwner: 'first-pack', incomingOwner: 'second-pack' },
      }),
    );
  });
});

describe('assertMutationDefaultGeneratorsAvailable', () => {
  it('passes when the contract has no execution section', () => {
    expect(() => assertMutationDefaultGeneratorsAvailable(undefined, new Map())).not.toThrow();
  });

  it('passes when every referenced generator is registered', () => {
    const registry = collectMutationDefaultGenerators([contributor('adapter', [sizedIdGenerator])]);
    expect(() =>
      assertMutationDefaultGeneratorsAvailable(
        execution([
          {
            ref: { namespace: 'ns', entry: 'user', field: 'id' },
            onCreate: { kind: 'generator', id: 'sizedId' },
          },
        ]),
        registry,
      ),
    ).not.toThrow();
  });

  it('lists every missing generator id, from create and update phases, in one error', () => {
    expect(() =>
      assertMutationDefaultGeneratorsAvailable(
        execution([
          {
            ref: { namespace: 'ns', entry: 'user', field: 'id' },
            onCreate: { kind: 'generator', id: 'gen-a' },
          },
          {
            ref: { namespace: 'ns', entry: 'user', field: 'slug' },
            onUpdate: { kind: 'generator', id: 'gen-b' },
          },
        ]),
        new Map(),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING',
        category: 'RUNTIME',
        severity: 'error',
        message:
          "Contract requires mutation default generator(s) 'gen-a', 'gen-b', but no runtime component provides them.",
        details: { ids: ['gen-a', 'gen-b'] },
      }),
    );
  });

  it('does not treat a built-in generator id as available when no contributor provides it', () => {
    const registry = collectMutationDefaultGenerators([contributor('adapter', [])]);
    expect(() =>
      assertMutationDefaultGeneratorsAvailable(
        execution([
          {
            ref: { namespace: 'ns', entry: 'user', field: 'id' },
            onCreate: { kind: 'generator', id: 'uuidv4' },
          },
        ]),
        registry,
      ),
    ).toThrow(expect.objectContaining({ details: { ids: ['uuidv4'] } }));
  });
});

describe('applyMutationDefaults', () => {
  const userDefaults = execution([
    {
      ref: { namespace: 'ns', entry: 'user', field: 'id' },
      onCreate: { kind: 'generator', id: 'sizedId', params: { size: 8 } },
    },
    {
      ref: { namespace: 'ns', entry: 'user', field: 'slug' },
      onUpdate: { kind: 'generator', id: 'sizedId', params: { size: 6 } },
    },
    {
      ref: { namespace: 'other', entry: 'user', field: 'id' },
      onCreate: { kind: 'generator', id: 'sizedId', params: { size: 2 } },
    },
  ]);
  const registry = collectMutationDefaultGenerators([contributor('adapter', [sizedIdGenerator])]);

  it('applies create defaults of the entry and namespace, passing the generator params', () => {
    expect(
      applyMutationDefaults(userDefaults, registry, {
        op: 'create',
        namespace: 'ns',
        entry: 'user',
        values: {},
      }),
    ).toEqual([{ field: 'id', value: 'xxxxxxxx' }]);
  });

  it('applies update defaults from onUpdate', () => {
    expect(
      applyMutationDefaults(userDefaults, registry, {
        op: 'update',
        namespace: 'ns',
        entry: 'user',
        values: { email: 'alice@example.com' },
      }),
    ).toEqual([{ field: 'slug', value: 'xxxxxx' }]);
  });

  it('applies nothing to an update with no keys', () => {
    expect(
      applyMutationDefaults(userDefaults, registry, {
        op: 'update',
        namespace: 'ns',
        entry: 'user',
        values: {},
      }),
    ).toEqual([]);
  });

  it('applies nothing for an entry with no defaults, or with no execution section', () => {
    expect(
      applyMutationDefaults(userDefaults, registry, {
        op: 'create',
        namespace: 'ns',
        entry: 'post',
        values: {},
      }),
    ).toEqual([]);
    expect(
      applyMutationDefaults(undefined, registry, {
        op: 'create',
        namespace: 'ns',
        entry: 'user',
        values: {},
      }),
    ).toEqual([]);
  });

  it.each([
    ['a value', 'user-provided'],
    ['null', null],
    ['undefined', undefined],
  ])('skips a field the values carry as a key, whatever its value (%s)', (_label, value) => {
    expect(
      applyMutationDefaults(userDefaults, registry, {
        op: 'create',
        namespace: 'ns',
        entry: 'user',
        values: { id: value },
      }),
    ).toEqual([]);
  });

  it('applies a field once per call when two defaults name it', () => {
    const counter = counterGenerator('counter', 'field');
    const twice = execution([
      {
        ref: { namespace: 'ns', entry: 'user', field: 'id' },
        onCreate: { kind: 'generator', id: 'counter' },
      },
      {
        ref: { namespace: 'ns', entry: 'user', field: 'id' },
        onCreate: { kind: 'generator', id: 'counter' },
      },
    ]);
    expect(
      applyMutationDefaults(
        twice,
        collectMutationDefaultGenerators([contributor('x', [counter])]),
        {
          op: 'create',
          namespace: 'ns',
          entry: 'user',
          values: {},
        },
      ),
    ).toEqual([{ field: 'id', value: 1 }]);
    expect(counter.calls()).toBe(1);
  });

  it('shares one query-stable value across calls that pass the same cache', () => {
    const counter = counterGenerator('counter', 'query');
    const defaults = execution([
      {
        ref: { namespace: 'ns', entry: 'user', field: 'touchedAt' },
        onCreate: { kind: 'generator', id: 'counter' },
      },
    ]);
    const counters = collectMutationDefaultGenerators([contributor('x', [counter])]);
    const defaultValueCache = new Map<string, unknown>();
    const apply = (cache?: Map<string, unknown>) =>
      applyMutationDefaults(defaults, counters, {
        op: 'create',
        namespace: 'ns',
        entry: 'user',
        values: {},
        ...(cache === undefined ? {} : { defaultValueCache: cache }),
      });

    expect([apply(defaultValueCache), apply(defaultValueCache), apply(defaultValueCache)]).toEqual([
      [{ field: 'touchedAt', value: 1 }],
      [{ field: 'touchedAt', value: 1 }],
      [{ field: 'touchedAt', value: 1 }],
    ]);
    expect(counter.calls()).toBe(1);
    expect(apply()).toEqual([{ field: 'touchedAt', value: 2 }]);
  });

  it('shares a row-stable value across fields of one call but not across calls', () => {
    const counter = counterGenerator('correlationId', 'row');
    const defaults = execution([
      {
        ref: { namespace: 'ns', entry: 'event', field: 'causation' },
        onCreate: { kind: 'generator', id: 'correlationId' },
      },
      {
        ref: { namespace: 'ns', entry: 'event', field: 'correlation' },
        onCreate: { kind: 'generator', id: 'correlationId' },
      },
    ]);
    const counters = collectMutationDefaultGenerators([contributor('x', [counter])]);
    const defaultValueCache = new Map<string, unknown>();
    const apply = () =>
      applyMutationDefaults(defaults, counters, {
        op: 'create',
        namespace: 'ns',
        entry: 'event',
        values: {},
        defaultValueCache,
      });

    expect([apply(), apply()]).toEqual([
      [
        { field: 'causation', value: 1 },
        { field: 'correlation', value: 1 },
      ],
      [
        { field: 'causation', value: 2 },
        { field: 'correlation', value: 2 },
      ],
    ]);
    expect(defaultValueCache.size).toBe(0);
  });

  it('calls a field-stable generator for every field, ignoring the cache', () => {
    const counter = counterGenerator('perField', 'field');
    const defaults = execution([
      {
        ref: { namespace: 'ns', entry: 'event', field: 'a' },
        onCreate: { kind: 'generator', id: 'perField' },
      },
      {
        ref: { namespace: 'ns', entry: 'event', field: 'b' },
        onCreate: { kind: 'generator', id: 'perField' },
      },
    ]);
    const defaultValueCache = new Map<string, unknown>();
    expect(
      applyMutationDefaults(
        defaults,
        collectMutationDefaultGenerators([contributor('x', [counter])]),
        { op: 'create', namespace: 'ns', entry: 'event', values: {}, defaultValueCache },
      ),
    ).toEqual([
      { field: 'a', value: 1 },
      { field: 'b', value: 2 },
    ]);
    expect(defaultValueCache.size).toBe(0);
  });

  it('rejects a default whose generator is not registered', () => {
    expect(() =>
      applyMutationDefaults(userDefaults, new Map(), {
        op: 'create',
        namespace: 'ns',
        entry: 'user',
        values: {},
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING',
        message:
          "Contract references mutation default generator 'sizedId' but no runtime component provides it.",
        details: { id: 'sizedId' },
      }),
    );
  });
});
