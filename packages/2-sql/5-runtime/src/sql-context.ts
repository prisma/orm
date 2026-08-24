import type { Contract, ExecutionMutationDefaultValue, JsonValue } from '@internal/contract/types';
import type {
  AnyCodecDescriptor,
  CodecDescriptor,
  CodecRef,
} from '@internal/framework-components/codec';
import type {
  ComponentDescriptor,
  ComponentMetadata,
} from '@internal/framework-components/components';
import {
  checkContractComponentRequirements,
  mergeCapabilityMatrices,
} from '@internal/framework-components/components';
import {
  createExecutionStack,
  type ExecutionStack,
  type RuntimeAdapterDescriptor,
  type RuntimeAdapterInstance,
  type RuntimeDriverDescriptor,
  type RuntimeDriverInstance,
  type RuntimeExtensionDescriptor,
  type RuntimeExtensionInstance,
  type RuntimeTargetDescriptor,
  type RuntimeTargetInstance,
} from '@internal/framework-components/execution';
import { runtimeError } from '@internal/framework-components/runtime';
import { canonicalizeJson } from '@internal/framework-components/utils';
import type { SqlStorage, StorageTypeInstance } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';

function documentScopedCodecTypes(
  contract: Contract<SqlStorage>,
): Record<string, StorageTypeInstance> | undefined {
  return blindCast<
    Record<string, StorageTypeInstance> | undefined,
    'SqlStorage.types is typed for generic access; runtime shape is guaranteed by contract schema validation'
  >(contract.storage.types);
}

import { createSqlOperationRegistry, type SqlOperationDescriptors } from '@internal/sql-operations';
import { buildSqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import type {
  Adapter,
  AnyQueryAst,
  ContractCodecRegistry,
  LoweredStatement,
  SqlCodecInstanceContext,
  SqlDriver,
} from '@internal/sql-relational-core/ast';
import { buildCodecDescriptorRegistry } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { RawCodecInferer } from '@internal/sql-relational-core/expression';
import type {
  AppliedMutationDefault,
  CodecDescriptorRegistry,
  ExecutionContext,
  MutationDefaultsOptions,
  TypeHelperRegistry,
} from '@internal/sql-relational-core/query-lane-context';
import { createAstCodecResolver } from './codecs/ast-codec-resolver';

/**
 * Runtime parameterized codec descriptor.
 *
 * The unified `CodecDescriptor<P>` shape applied to parameterized codecs — `paramsSchema: StandardSchemaV1<P>` for JSON-boundary validation, `factory: (P) => (CodecInstanceContext) => Codec` for the curried higher-order codec. The factory is called once per `storage.types` instance (or once per inline-`typeParams` column); per-instance state lives in the closure.
 *
 * Codec-registry-unification spec § Decision.
 */
export type RuntimeParameterizedCodecDescriptor<P = Record<string, unknown>> = CodecDescriptor<P>;

/**
 * Contributor protocol for SQL components (target, adapter, extension pack). The unified `codecs:` slot returns the full {@link CodecDescriptor} list — non-parameterized and parameterized descriptors live side-by-side in the same array. The framework dispatches every codec id through the unified descriptor map without branching on parameterization.
 */
export interface SqlStaticContributions {
  readonly codecs: () => ReadonlyArray<AnyCodecDescriptor>;
  readonly queryOperations?: () => SqlOperationDescriptors;
  readonly mutationDefaultGenerators?: () => ReadonlyArray<RuntimeMutationDefaultGenerator>;
}

/**
 * Scope across which a generator's value is constant.
 *
 * - `'field'` — one value per defaulting site (one column, one row). Cache strategy: no cache; call per defaulting site. Right for per-row identifiers (UUIDs, CUIDs, ULIDs, nanoid, ksuid).
 * - `'row'` — one value across all defaulting sites of one row of one operation. Cache strategy: per-call cache keyed by `generatorId`. Right for correlation ids stamped into multiple columns of one row.
 * - `'query'` — one value across all rows and columns of one ORM operation. Cache strategy: caller-provided cache keyed by `generatorId`. Right for `timestampNow` (a single timestamp per bulk insert/update).
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

export interface SqlRuntimeTargetDescriptor<
  TTargetId extends string = string,
  TTargetInstance extends RuntimeTargetInstance<'sql', TTargetId> = RuntimeTargetInstance<
    'sql',
    TTargetId
  >,
> extends RuntimeTargetDescriptor<'sql', TTargetId, TTargetInstance>,
    SqlStaticContributions {}

export interface SqlRuntimeAdapterDescriptor<
  TTargetId extends string = string,
  TAdapterInstance extends RuntimeAdapterInstance<
    'sql',
    TTargetId
  > = SqlRuntimeAdapterInstance<TTargetId>,
> extends RuntimeAdapterDescriptor<'sql', TTargetId, TAdapterInstance>,
    SqlStaticContributions {
  /**
   * Codec inferer used by `fns.raw` to look up the codec id for a bare-literal interpolation. Required on every SQL adapter descriptor — the facade reads it off the descriptor at client-construction time without instantiating the runtime adapter.
   */
  readonly rawCodecInferer: RawCodecInferer;
}

export interface SqlRuntimeExtensionDescriptor<TTargetId extends string = string>
  extends RuntimeExtensionDescriptor<'sql', TTargetId, SqlRuntimeExtensionInstance<TTargetId>>,
    SqlStaticContributions {
  create(): SqlRuntimeExtensionInstance<TTargetId>;
}

export interface SqlExecutionStack<TTargetId extends string = string> {
  readonly target: SqlRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: SqlRuntimeAdapterDescriptor<TTargetId>;
  readonly extensions: readonly SqlRuntimeExtensionDescriptor<TTargetId>[];
}

export type SqlExecutionStackWithDriver<TTargetId extends string = string> = Omit<
  ExecutionStack<
    'sql',
    TTargetId,
    SqlRuntimeAdapterInstance<TTargetId>,
    SqlRuntimeDriverInstance<TTargetId>,
    SqlRuntimeExtensionInstance<TTargetId>
  >,
  'target' | 'adapter' | 'driver' | 'extensions'
> & {
  readonly target: SqlRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: SqlRuntimeAdapterDescriptor<TTargetId, SqlRuntimeAdapterInstance<TTargetId>>;
  readonly driver:
    | RuntimeDriverDescriptor<'sql', TTargetId, unknown, SqlRuntimeDriverInstance<TTargetId>>
    | undefined;
  readonly extensions: readonly SqlRuntimeExtensionDescriptor<TTargetId>[];
};

export interface SqlRuntimeExtensionInstance<TTargetId extends string>
  extends RuntimeExtensionInstance<'sql', TTargetId> {}

export type SqlRuntimeAdapterInstance<TTargetId extends string = string> = RuntimeAdapterInstance<
  'sql',
  TTargetId
> &
  Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>;

/**
 * NOTE: Binding type is intentionally erased to unknown at this shared runtime layer. Target clients (for example `postgres()`) validate and construct the concrete binding before calling `driver.connect(binding)`, which keeps runtime behavior safe today. A future follow-up can preserve TBinding through stack/context generics end-to-end.
 */
export type SqlRuntimeDriverInstance<TTargetId extends string = string> = RuntimeDriverInstance<
  'sql',
  TTargetId
> &
  SqlDriver<unknown>;

export function createSqlExecutionStack<TTargetId extends string>(options: {
  readonly target: SqlRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: SqlRuntimeAdapterDescriptor<TTargetId>;
  readonly driver?:
    | RuntimeDriverDescriptor<'sql', TTargetId, unknown, SqlRuntimeDriverInstance<TTargetId>>
    | undefined;
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<TTargetId>[] | undefined;
}): SqlExecutionStackWithDriver<TTargetId> {
  return createExecutionStack({
    target: options.target,
    adapter: options.adapter,
    driver: options.driver,
    extensions: options.extensions,
  });
}

export type { ExecutionContext, TypeHelperRegistry };

export function assertExecutionStackContractRequirements(
  contract: Contract<SqlStorage>,
  stack: SqlExecutionStack,
): void {
  const providedComponentIds = new Set<string>([
    stack.target.id,
    stack.adapter.id,
    ...stack.extensions.map((pack) => pack.id),
  ]);

  const result = checkContractComponentRequirements({
    contract,
    expectedTargetFamily: 'sql',
    expectedTargetId: stack.target.targetId,
    providedComponentIds,
  });

  if (result.familyMismatch) {
    throw runtimeError(
      'RUNTIME.CONTRACT_FAMILY_MISMATCH',
      `Contract target family '${result.familyMismatch.actual}' does not match runtime family '${result.familyMismatch.expected}'.`,
      {
        actual: result.familyMismatch.actual,
        expected: result.familyMismatch.expected,
      },
    );
  }

  if (result.targetMismatch) {
    throw runtimeError(
      'RUNTIME.CONTRACT_TARGET_MISMATCH',
      `Contract target '${result.targetMismatch.actual}' does not match runtime target descriptor '${result.targetMismatch.expected}'.`,
      {
        actual: result.targetMismatch.actual,
        expected: result.targetMismatch.expected,
      },
    );
  }

  if (result.missingExtensionPackIds.length > 0) {
    const packIds = result.missingExtensionPackIds;
    const packList = packIds.map((id) => `'${id}'`).join(', ');
    throw runtimeError(
      'RUNTIME.MISSING_EXTENSION_PACK',
      `Contract requires extension pack(s) ${packList}, but runtime descriptors do not provide matching component(s).`,
      { packIds },
    );
  }
}

function validateTypeParams(
  typeParams: Record<string, unknown>,
  descriptor: RuntimeParameterizedCodecDescriptor,
  context: { typeName?: string; tableName?: string; columnName?: string },
): Record<string, unknown> {
  const result = descriptor.paramsSchema['~standard'].validate(typeParams);
  if (result instanceof Promise) {
    throw runtimeError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `paramsSchema for codec '${descriptor.codecId}' returned a Promise; runtime validation requires a synchronous Standard Schema validator.`,
      { ...context, codecId: descriptor.codecId, typeParams },
    );
  }
  if (result.issues) {
    const messages = result.issues.map((issue) => issue.message).join('; ');
    const locationInfo = context.typeName
      ? `type '${context.typeName}'`
      : `column '${context.tableName}.${context.columnName}'`;
    throw runtimeError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `Invalid typeParams for ${locationInfo} (codecId: ${descriptor.codecId}): ${messages}`,
      { ...context, codecId: descriptor.codecId, typeParams },
    );
  }
  return result.value as Record<string, unknown>;
}

/**
 * Collect every {@link CodecDescriptor} contributed by the SQL stack and partition into "parameterized" vs "non-parameterized" via the descriptor's own {@link CodecDescriptorImpl.isParameterized} getter. The getter is the canonical discriminator — a `paramsSchema` identity check would misroute any descriptor that doesn't reuse the exact `voidParamsSchema` singleton (e.g. a non-parameterized codec authoring its own no-op schema).
 *
 * The unified descriptor list collapses the legacy split (a separate slot used to register parameterized codecs) — every codec id resolves through the same map (codec-registry-unification spec § Decision).
 */
function collectCodecDescriptors(contributors: ReadonlyArray<SqlStaticContributions>): {
  readonly all: ReadonlyArray<AnyCodecDescriptor>;
  readonly parameterized: Map<string, RuntimeParameterizedCodecDescriptor>;
} {
  const all: AnyCodecDescriptor[] = [];
  const parameterized = new Map<string, RuntimeParameterizedCodecDescriptor>();
  const seen = new Set<string>();

  for (const contributor of contributors) {
    for (const descriptor of contributor.codecs()) {
      if (seen.has(descriptor.codecId)) {
        throw runtimeError(
          'RUNTIME.DUPLICATE_CODEC',
          `Duplicate codec descriptor for codecId '${descriptor.codecId}'.`,
          { codecId: descriptor.codecId },
        );
      }
      seen.add(descriptor.codecId);
      all.push(descriptor);

      if (descriptor.isParameterized) {
        // Cast widens the descriptor's heterogeneous `P` to the runtime alias surface; consumers narrow per codec id at the dispatch site, where the descriptor's own `paramsSchema` validates JSON-sourced params before the factory ever sees them.
        parameterized.set(
          descriptor.codecId,
          descriptor as unknown as RuntimeParameterizedCodecDescriptor,
        );
      }
    }
  }

  return { all, parameterized };
}

/**
 * Flatten every aggregate descriptor the SQL stack contributes. Shape validation, single-ownership of each `(operation, input)` pair, and trait-overlap resolution all happen inside {@link buildSqlAggregateDescriptorRegistry}, so contributions reach it unchecked and fail there — at composition, never mid-query.
 */
function collectAggregateDescriptorContributions(
  contributors: ReadonlyArray<ComponentMetadata>,
): ReadonlyArray<unknown> {
  return contributors.flatMap((contributor) => contributor.types?.aggregateDescriptors ?? []);
}

function collectTypeRefSites(
  storage: SqlStorage,
): Map<string, Array<{ readonly table: string; readonly column: string }>> {
  const sites = new Map<string, Array<{ readonly table: string; readonly column: string }>>();
  for (const ns of Object.values(storage.namespaces)) {
    for (const [tableName, table] of Object.entries(ns.entries.table ?? {})) {
      for (const [columnName, column] of Object.entries(table.columns)) {
        if (typeof column.typeRef !== 'string') continue;
        const list = sites.get(column.typeRef);
        const entry = { table: tableName, column: columnName };
        if (list) {
          list.push(entry);
        } else {
          sites.set(column.typeRef, [entry]);
        }
      }
    }
  }
  return sites;
}

function initializeTypeHelpers(
  storage: SqlStorage,
  documentTypes: Record<string, StorageTypeInstance> | undefined,
  codecDescriptors: Map<string, RuntimeParameterizedCodecDescriptor>,
): TypeHelperRegistry {
  const helpers: TypeHelperRegistry = {};

  if (!documentTypes) {
    return helpers;
  }

  const typeRefSites = collectTypeRefSites(storage);

  for (const [typeName, typeInstance] of Object.entries(documentTypes)) {
    const codecId = typeInstance.codecId;
    const typeParams = typeInstance.typeParams;
    const descriptor = codecDescriptors.get(codecId);

    if (!descriptor) {
      // No parameterized descriptor for this codec id — store the raw type instance for callers that need typeParams metadata.
      helpers[typeName] = typeInstance;
      continue;
    }

    // `typeParams` may be absent on the canonical empty form. Forward `{}`
    // to the descriptor's paramsSchema so it can probe its own optionality.
    const validatedParams = validateTypeParams(typeParams ?? {}, descriptor, {
      typeName,
    });

    const usedAt = typeRefSites.get(typeName) ?? [];
    const ctx: SqlCodecInstanceContext = { name: typeName, usedAt };
    helpers[typeName] = descriptor.factory(validatedParams)(ctx);
  }

  return helpers;
}

function validateColumnTypeParams(
  storage: SqlStorage,
  codecDescriptors: Map<string, RuntimeParameterizedCodecDescriptor>,
): void {
  for (const ns of Object.values(storage.namespaces)) {
    for (const [tableName, table] of Object.entries(ns.entries.table ?? {})) {
      for (const [columnName, column] of Object.entries(table.columns)) {
        if (column.typeParams) {
          const descriptor = codecDescriptors.get(column.codecId);
          if (descriptor) {
            validateTypeParams(column.typeParams, descriptor, { tableName, columnName });
          }
        }
      }
    }
  }
}

/**
 * Build-time contract-integrity check: every `(table, column)` resolves to a {@link CodecRef} whose `codecId` is registered and whose `typeParams` presence matches the descriptor's `isParameterized` flag.
 *
 * Surfaces three classes of malformed contract that AST-bound codec resolution would otherwise mask silently:
 *
 * - column references a codecId no contributor registered → `RUNTIME.CODEC_DESCRIPTOR_MISSING`.
 * - parameterized codec, no `typeParams` (legacy "tolerate refs without params" shape) → `RUNTIME.CODEC_PARAMETERIZATION_MISMATCH`.
 * - non-parameterized codec, `typeParams` supplied → `RUNTIME.CODEC_PARAMETERIZATION_MISMATCH`.
 *
 * Runs unconditionally from `createExecutionContext` so contract bugs fail fast at construction time instead of silently skipping affected columns in the codec registry's pre-population walk.
 */
function assertColumnCodecIntegrity(
  storage: SqlStorage,
  codecDescriptors: CodecDescriptorRegistry,
): void {
  for (const [namespaceId, ns] of Object.entries(storage.namespaces)) {
    for (const [tableName, table] of Object.entries(ns.entries.table ?? {})) {
      for (const columnName of Object.keys(table.columns)) {
        const ref = codecDescriptors.codecRefForColumn(namespaceId, tableName, columnName);
        if (!ref) continue;

        const descriptor = codecDescriptors.descriptorFor(ref.codecId);
        if (!descriptor) {
          throw runtimeError(
            'RUNTIME.CODEC_DESCRIPTOR_MISSING',
            `Column '${tableName}.${columnName}' references codec '${ref.codecId}' but no contributor registered a codec descriptor for that codecId. Add the extension pack that owns the codec to the runtime stack.`,
            { table: tableName, column: columnName, codecId: ref.codecId },
          );
        }

        if (descriptor.isParameterized && ref.typeParams === undefined) {
          // Some parameterized codecs declare every paramsSchema field as optional
          // (e.g. `pg/timestamptz-temporal@1` precision). Defer to the descriptor's own
          // schema rather than rejecting purely on structural absence: probe the
          // schema with an empty params object and only fail when the schema
          // rejects it (i.e. at least one field is required).
          const probe = descriptor.paramsSchema['~standard'].validate({});
          if (probe instanceof Promise) {
            // Swallow the probe Promise's rejection so Node doesn't warn about an
            // unhandled rejection once we throw synchronously below.
            probe.catch(() => {});
            throw runtimeError(
              'RUNTIME.TYPE_PARAMS_INVALID',
              `Column '${tableName}.${columnName}' uses parameterized codec '${ref.codecId}' whose paramsSchema returned a Promise; paramsSchema must be a synchronous Standard Schema validator. Return a value/issues result directly instead of a Promise.`,
              { table: tableName, column: columnName, codecId: ref.codecId },
            );
          }
          const rejects = 'issues' in probe && !!probe.issues;
          if (rejects) {
            throw runtimeError(
              'RUNTIME.CODEC_PARAMETERIZATION_MISMATCH',
              `Column '${tableName}.${columnName}' uses parameterized codec '${ref.codecId}' but no typeParams are supplied. Provide typeParams on the column, or use a typeRef pointing at a storage.types entry that carries them.`,
              {
                table: tableName,
                column: columnName,
                codecId: ref.codecId,
                expected: 'parameterized',
                actual: 'no typeParams',
              },
            );
          }
        }

        // An object-typed field's empty state is canonical at every boundary
        // that compares them: `typeParams: {}` and missing `typeParams` are
        // equivalent — both mean "no parameters were supplied". A
        // non-parameterized codec only conflicts with typeParams that carry
        // at least one key. The PSL interpreter emits `typeParams: {}` for
        // bare native-type aliases with no arguments; treating that as
        // a mismatch would reject every such alias against its codec.
        const refTypeParams = ref.typeParams;
        const refHasTypeParamKeys =
          refTypeParams !== undefined &&
          refTypeParams !== null &&
          typeof refTypeParams === 'object' &&
          !Array.isArray(refTypeParams) &&
          Object.keys(refTypeParams).length > 0;
        if (!descriptor.isParameterized && refHasTypeParamKeys) {
          throw runtimeError(
            'RUNTIME.CODEC_PARAMETERIZATION_MISMATCH',
            `Column '${tableName}.${columnName}' supplies typeParams to non-parameterized codec '${ref.codecId}'. Remove the typeParams or switch to a parameterized codec id.`,
            {
              table: tableName,
              column: columnName,
              codecId: ref.codecId,
              expected: 'non-parameterized',
              actual: 'has typeParams',
            },
          );
        }
      }
    }
  }
}

/**
 * Build a {@link ContractCodecRegistry} that resolves codecs exclusively through the `forCodecRef` content-keyed cache.
 *
 * One pre-population pass walks `storage.types` and `storage.tables[].columns[]` to seed the resolver's per-ref instance context with the *aggregated* `usedAt` set for each canonical `(codecId, typeParams)` key. The same codec materialised through `forColumn` or `forCodecRef` is therefore one instance with one `SqlCodecInstanceContext` — stateful codecs reading `usedAt` see the full column set regardless of which surface the caller used.
 *
 * Per-key instance-name policy:
 *
 * - typeRef-shared columns use the `storage.types[name]` name.
 * - inline-`typeParams` columns use `<col:Table.column>` (the first column observed at that key; additional columns sharing the key extend `usedAt`).
 * - non-parameterized codec ids use `<codec:codecId>`, aggregating every column on that codec id into one `usedAt` set.
 * - ad-hoc refs the contract walk did not pre-populate (e.g. AST-supplied refs from deserialised migration ops) fall back to the canonical cache key `${codecId}:${canonicalizeJson(typeParams)}` — the only structurally honest identity for an ad-hoc ref, distinct per `(codecId, typeParams)`.
 *
 * Contract integrity is enforced upstream by {@link assertColumnCodecIntegrity}: every column must reference a registered `codecId` whose `descriptor.isParameterized` flag matches the presence of `typeParams` (via `codecRefForColumn`). The pre-population walk and `forColumn` therefore make no defensive checks — malformed columns fail fast at `createExecutionContext` construction with `RUNTIME.CODEC_DESCRIPTOR_MISSING` or `RUNTIME.CODEC_PARAMETERIZATION_MISMATCH` rather than being silently skipped here.
 *
 * `forColumn(ns, t, c)` is a thin delegate over `forCodecRef(codecRefForColumn(ns, t, c))`; encode/decode hot paths read the resolver directly via `forCodecRef`. The only `undefined` `forColumn` returns is the legitimate "no such column in the contract" case.
 */
function buildContractCodecRegistry(
  contract: Contract<SqlStorage>,
  codecDescriptors: CodecDescriptorRegistry,
): ContractCodecRegistry {
  const refKeyOf = (ref: CodecRef): string => `${ref.codecId}:${canonicalizeJson(ref.typeParams)}`;

  const usedAtByKey = new Map<string, Array<{ readonly table: string; readonly column: string }>>();
  const nameByKey = new Map<string, string>();

  const typeRefSites = collectTypeRefSites(contract.storage);
  for (const [typeName, typeInstance] of Object.entries(documentScopedCodecTypes(contract) ?? {})) {
    const instanceTypeParams = typeInstance.typeParams;
    const hasParamKeys =
      instanceTypeParams !== undefined && Object.keys(instanceTypeParams).length > 0;
    const ref: CodecRef = hasParamKeys
      ? {
          codecId: typeInstance.codecId,
          typeParams: instanceTypeParams as JsonValue,
        }
      : { codecId: typeInstance.codecId };
    const key = refKeyOf(ref);
    const sites = typeRefSites.get(typeName) ?? [];
    const existing = usedAtByKey.get(key);
    // Two `storage.types` aliases that canonicalize to the same (codecId, typeParams) share a single codec instance via the resolver. Append sites instead of replacing so a stateful codec reading the aggregated site list sees every column behind every alias rather than just the last one.
    if (existing) {
      existing.push(...sites);
    } else {
      usedAtByKey.set(key, [...sites]);
      nameByKey.set(key, typeName);
    }
  }

  for (const [namespaceId, ns] of Object.entries(contract.storage.namespaces)) {
    for (const [tableName, table] of Object.entries(ns.entries.table ?? {})) {
      for (const [columnName, column] of Object.entries(table.columns)) {
        if (column.typeRef !== undefined) continue;
        const ref = codecDescriptors.codecRefForColumn(namespaceId, tableName, columnName);
        if (!ref) continue;
        const key = refKeyOf(ref);
        const site = { table: tableName, column: columnName };
        const existing = usedAtByKey.get(key);
        if (existing) {
          existing.push(site);
        } else {
          usedAtByKey.set(key, [site]);
          const name =
            ref.typeParams !== undefined
              ? `<col:${tableName}.${columnName}>`
              : `<codec:${ref.codecId}>`;
          nameByKey.set(key, name);
        }
      }
    }
  }

  const resolver = createAstCodecResolver(codecDescriptors, (ref) => {
    const key = refKeyOf(ref);
    // Fallback uses the canonical cache key as the instance name. Two ad-hoc refs with the same `codecId` but different `typeParams` resolve to distinct codecs (different cache keys) and must therefore expose distinct `name`s; a `codecId`-only fallback would collide and break stateful codecs that key per-instance state on `name`.
    return {
      name: nameByKey.get(key) ?? key,
      usedAt: usedAtByKey.get(key) ?? [],
    };
  });

  for (const [namespaceId, ns] of Object.entries(contract.storage.namespaces)) {
    for (const [tableName, table] of Object.entries(ns.entries.table ?? {})) {
      for (const columnName of Object.keys(table.columns)) {
        const ref = codecDescriptors.codecRefForColumn(namespaceId, tableName, columnName);
        if (!ref) continue;
        resolver.forCodecRef(ref);
      }
    }
  }

  const registry: ContractCodecRegistry = {
    forColumn(namespaceId, table, column) {
      const ref = codecDescriptors.codecRefForColumn(namespaceId, table, column);
      return ref ? resolver.forCodecRef(ref) : undefined;
    },
    forCodecRef(ref) {
      return resolver.forCodecRef(ref);
    },
  };

  return registry;
}

function assertMutationDefaultGeneratorsAvailable(
  contract: Contract<SqlStorage>,
  generatorRegistry: ReadonlyMap<string, RuntimeMutationDefaultGenerator>,
): void {
  const defaults = contract.execution?.mutations.defaults ?? [];
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

function collectMutationDefaultGenerators(
  contributors: ReadonlyArray<SqlStaticContributions & { readonly id: string }>,
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

function computeExecutionDefaultValue(
  spec: ExecutionMutationDefaultValue,
  generatorRegistry: ReadonlyMap<string, RuntimeMutationDefaultGenerator>,
): unknown {
  switch (spec.kind) {
    case 'generator': {
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
  }
}

function applyMutationDefaults(
  contract: Contract<SqlStorage>,
  generatorRegistry: ReadonlyMap<string, RuntimeMutationDefaultGenerator>,
  options: MutationDefaultsOptions,
): ReadonlyArray<AppliedMutationDefault> {
  const defaults = contract.execution?.mutations.defaults ?? [];
  if (defaults.length === 0) {
    return [];
  }

  const isEmptyUpdate = options.op === 'update' && Object.keys(options.values).length === 0;

  const applied: AppliedMutationDefault[] = [];
  const appliedColumns = new Set<string>();
  // Fresh per-call cache for `stability: 'row'` generators — they share across columns of a single row but regenerate on the next call.
  const rowCache = new Map<string, unknown>();

  for (const mutationDefault of defaults) {
    if (mutationDefault.ref.table !== options.table) {
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

    // RD2: empty update payloads skip onUpdate defaults — no write means no `@updatedAt` advance.
    if (isEmptyUpdate) {
      continue;
    }

    const columnName = mutationDefault.ref.column;
    if (Object.hasOwn(options.values, columnName) || appliedColumns.has(columnName)) {
      continue;
    }

    applied.push({
      column: columnName,
      value: resolveScopedValue(
        defaultSpec,
        generatorRegistry,
        rowCache,
        options.defaultValueCache,
      ),
    });
    appliedColumns.add(columnName);
  }

  return applied;
}

function resolveScopedValue(
  spec: ExecutionMutationDefaultValue,
  generatorRegistry: ReadonlyMap<string, RuntimeMutationDefaultGenerator>,
  rowCache: Map<string, unknown>,
  queryCache: Map<string, unknown> | undefined,
): unknown {
  if (spec.kind !== 'generator') {
    return computeExecutionDefaultValue(spec, generatorRegistry);
  }
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

export function createExecutionContext<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
  TTargetId extends string = string,
>(options: {
  readonly contract: TContract;
  readonly stack: SqlExecutionStack<TTargetId>;
  /**
   * Optional driver descriptor. When provided, its `capabilities` are folded into the contract's capability matrix alongside the target, adapter, and extension packs — matching the merge `enrichContract` performs at CLI emit time. The driver is *only* consulted as a capability source here; runtime driver lifecycle is wired separately via {@link instantiateExecutionStack} + `runtime.connect`.
   */
  readonly driver?: RuntimeDriverDescriptor<
    'sql',
    TTargetId,
    unknown,
    SqlRuntimeDriverInstance<TTargetId>
  >;
}): ExecutionContext<TContract> {
  const { stack, driver } = options;

  assertExecutionStackContractRequirements(options.contract, stack);

  const capabilityContributors: ReadonlyArray<{ readonly capabilities?: unknown }> = [
    stack.target,
    stack.adapter,
    ...(driver ? [driver] : []),
    ...stack.extensions,
  ];
  const mergedCapabilities = mergeCapabilityMatrices(
    options.contract.capabilities,
    capabilityContributors,
  );
  const contract: TContract = {
    ...options.contract,
    capabilities: mergedCapabilities,
  };

  const contributors: Array<SqlStaticContributions & ComponentDescriptor<string>> = [
    stack.target,
    stack.adapter,
    ...stack.extensions,
  ];

  const { all: allCodecDescriptors, parameterized: parameterizedCodecDescriptors } =
    collectCodecDescriptors(contributors);

  const queryOperationRegistry = createSqlOperationRegistry();
  for (const contributor of contributors) {
    const ops = contributor.queryOperations?.() ?? {};
    for (const [name, op] of Object.entries(ops)) {
      queryOperationRegistry.register(name, op);
    }
  }

  const codecDescriptors = buildCodecDescriptorRegistry(allCodecDescriptors, contract.storage);
  assertColumnCodecIntegrity(contract.storage, codecDescriptors);
  const aggregateDescriptors = buildSqlAggregateDescriptorRegistry(
    collectAggregateDescriptorContributions(contributors),
    codecDescriptors,
  );
  const mutationDefaultGeneratorRegistry = collectMutationDefaultGenerators(contributors);
  assertMutationDefaultGeneratorsAvailable(contract, mutationDefaultGeneratorRegistry);

  if (parameterizedCodecDescriptors.size > 0) {
    validateColumnTypeParams(contract.storage, parameterizedCodecDescriptors);
  }

  const types = initializeTypeHelpers(
    contract.storage,
    documentScopedCodecTypes(contract),
    parameterizedCodecDescriptors,
  );

  const contractCodecs = buildContractCodecRegistry(contract, codecDescriptors);

  return {
    contract,
    contractCodecs,
    codecDescriptors,
    aggregateDescriptors,
    queryOperations: queryOperationRegistry,
    types,
    applyMutationDefaults: (options) =>
      applyMutationDefaults(contract, mutationDefaultGeneratorRegistry, options),
  };
}
