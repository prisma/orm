import type {
  ContractExecutionSection,
  ExecutionMutationDefaultValue,
} from '@internal/contract/types';
import { runtimeError } from '../shared/runtime-error';

/**
 * Scope across which a generator's value is constant.
 *
 * - `'field'` — one value per defaulting site (one field of one record). Cache strategy: no cache; call per defaulting site. Right for per-record identifiers (UUIDs, CUIDs, ULIDs, nanoid, ksuid).
 * - `'row'` — one value across all defaulting sites of one record of one operation. Cache strategy: per-call cache keyed by generator id. Right for correlation ids stamped into several fields of one record.
 * - `'query'` — one value across all records and fields of one ORM operation. Cache strategy: caller-provided cache keyed by generator id. Right for `timestampNow` (a single timestamp per bulk create or update).
 */
export type GeneratorStability = 'field' | 'row' | 'query';

export interface RuntimeMutationDefaultGenerator {
  readonly id: string;
  readonly generate: (params?: Record<string, unknown>) => unknown;
  /**
   * Scope across which the generator's value is constant. The framework derives the cache strategy from this declaration; generator authors never need to know about cache keys. See `GeneratorStability` for the per-value semantics.
   */
  readonly stability: GeneratorStability;
}

/** A runtime component (target, adapter, or extension) that may contribute generators. */
export interface MutationDefaultGeneratorContributor {
  readonly id: string;
  readonly mutationDefaultGenerators?: () => ReadonlyArray<RuntimeMutationDefaultGenerator>;
}

export type MutationDefaultsOp = 'create' | 'update';

export interface MutationDefaultsOptions {
  readonly op: MutationDefaultsOp;
  readonly namespace: string;
  readonly entry: string;
  /** The values the caller writes. A key present here is explicit, whatever its value, and gets no default. */
  readonly values: Readonly<Record<string, unknown>>;
  /** Cache shared by the calls of one ORM operation, for `'query'`-stable generators. */
  readonly defaultValueCache?: Map<string, unknown>;
}

export interface AppliedMutationDefault {
  readonly field: string;
  readonly value: unknown;
}

export interface MutationDefaults {
  applyMutationDefaults(options: MutationDefaultsOptions): ReadonlyArray<AppliedMutationDefault>;
}

/** Registers every generator the contributors provide, by id. Two contributors providing one id is an error naming both. */
export function collectMutationDefaultGenerators(
  contributors: ReadonlyArray<MutationDefaultGeneratorContributor>,
): ReadonlyMap<string, RuntimeMutationDefaultGenerator> {
  const generators = new Map<string, RuntimeMutationDefaultGenerator>();
  const owners = new Map<string, string>();

  for (const contributor of contributors) {
    const nextGenerators = contributor.mutationDefaultGenerators?.() ?? [];
    for (const generator of nextGenerators) {
      const existingOwner = owners.get(generator.id);
      if (existingOwner !== undefined) {
        throw runtimeError(
          'RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR',
          `Duplicate mutation default generator '${generator.id}'.`,
          {
            id: generator.id,
            existingOwner,
            incomingOwner: contributor.id,
          },
        );
      }
      generators.set(generator.id, generator);
      owners.set(generator.id, contributor.id);
    }
  }

  return generators;
}

/** Fails when the contract's mutation defaults name a generator the registry does not hold, listing every missing id. */
export function assertMutationDefaultGeneratorsAvailable(
  execution: ContractExecutionSection | undefined,
  generatorRegistry: ReadonlyMap<string, RuntimeMutationDefaultGenerator>,
): void {
  const defaults = execution?.mutations.defaults ?? [];
  if (defaults.length === 0) return;

  const missing = new Set<string>();
  for (const mutationDefault of defaults) {
    for (const phase of [mutationDefault.onCreate, mutationDefault.onUpdate]) {
      if (!phase) continue;
      if (phase.kind === 'generator' && !generatorRegistry.has(phase.id)) {
        missing.add(phase.id);
      }
    }
  }

  if (missing.size === 0) return;

  const ids = Array.from(missing);
  const idList = ids.map((id) => `'${id}'`).join(', ');
  throw runtimeError(
    'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING',
    `Contract requires mutation default generator(s) ${idList}, but no runtime component provides them.`,
    { ids },
  );
}

function computeExecutionDefaultValue(
  spec: ExecutionMutationDefaultValue,
  generatorRegistry: ReadonlyMap<string, RuntimeMutationDefaultGenerator>,
): unknown {
  const generator = generatorRegistry.get(spec.id);
  if (!generator) {
    throw runtimeError(
      'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING',
      `Contract references mutation default generator '${spec.id}' but no runtime component provides it.`,
      {
        id: spec.id,
      },
    );
  }
  // nosemgrep: javascript.express.security.express-wkhtml-injection.express-wkhtmltoimage-injection
  return generator.generate(spec.params);
}

/**
 * The defaults to write for one record: for each mutation default of the entry and namespace whose phase matches `op`, the generated value of every field the values do not carry. An update with no keys gets none.
 */
export function applyMutationDefaults(
  execution: ContractExecutionSection | undefined,
  generatorRegistry: ReadonlyMap<string, RuntimeMutationDefaultGenerator>,
  options: MutationDefaultsOptions,
): ReadonlyArray<AppliedMutationDefault> {
  const defaults = execution?.mutations.defaults ?? [];
  if (defaults.length === 0) {
    return [];
  }

  const isEmptyUpdate = options.op === 'update' && Object.keys(options.values).length === 0;

  const applied: AppliedMutationDefault[] = [];
  const appliedFields = new Set<string>();
  // Fresh per-call cache for `stability: 'row'` generators — they share across fields of a single record but regenerate on the next call.
  const rowCache = new Map<string, unknown>();

  for (const mutationDefault of defaults) {
    if (mutationDefault.ref.entry !== options.entry) {
      continue;
    }
    if (mutationDefault.ref.namespace !== options.namespace) {
      continue;
    }

    const defaultSpec =
      options.op === 'create' ? mutationDefault.onCreate : mutationDefault.onUpdate;
    if (!defaultSpec) {
      continue;
    }

    // An empty update payload skips onUpdate defaults — no write means no `@updatedAt` advance.
    if (isEmptyUpdate) {
      continue;
    }

    const fieldName = mutationDefault.ref.field;
    if (Object.hasOwn(options.values, fieldName) || appliedFields.has(fieldName)) {
      continue;
    }

    applied.push({
      field: fieldName,
      value: resolveScopedValue(
        defaultSpec,
        generatorRegistry,
        rowCache,
        options.defaultValueCache,
      ),
    });
    appliedFields.add(fieldName);
  }

  return applied;
}

function resolveScopedValue(
  spec: ExecutionMutationDefaultValue,
  generatorRegistry: ReadonlyMap<string, RuntimeMutationDefaultGenerator>,
  rowCache: Map<string, unknown>,
  queryCache: Map<string, unknown> | undefined,
): unknown {
  const generator = generatorRegistry.get(spec.id);
  const cache = scopedCache(generator?.stability, rowCache, queryCache);
  if (!cache) {
    return computeExecutionDefaultValue(spec, generatorRegistry);
  }
  if (cache.has(spec.id)) {
    return cache.get(spec.id);
  }
  const value = computeExecutionDefaultValue(spec, generatorRegistry);
  cache.set(spec.id, value);
  return value;
}

function scopedCache(
  stability: GeneratorStability | undefined,
  rowCache: Map<string, unknown>,
  queryCache: Map<string, unknown> | undefined,
): Map<string, unknown> | undefined {
  switch (stability) {
    case 'row':
      return rowCache;
    case 'query':
      return queryCache;
    default:
      return undefined;
  }
}
