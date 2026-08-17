import {
  type ApplicationDomain,
  type Contract,
  type ContractModelBase,
  coreHash,
  profileHash,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '@internal/contract/types';
import type { CodecDescriptor, CodecTrait } from '@internal/framework-components/codec';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import {
  instantiateExecutionStack,
  type RuntimeDriverDescriptor,
} from '@internal/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { ResultType } from '@internal/framework-components/runtime';
import { runtimeError } from '@internal/framework-components/runtime';
import { canonicalizeJson } from '@internal/framework-components/utils';
import { builtinGeneratorIds } from '@internal/ids';
import { generateId } from '@internal/ids/runtime';
import {
  SqlStorage,
  type SqlStorageInput,
  type StorageTableInput,
} from '@internal/sql-contract/types';
import type {
  Adapter,
  AnyQueryAst,
  Codec,
  ContractCodecRegistry,
  LoweredStatement,
  SelectAst,
} from '@internal/sql-relational-core/ast';
import { SelectAst as SelectAstCtor, TableSource } from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { ifDefined } from '@internal/utils/defined';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { createExecutionContext, createSqlExecutionStack } from '../src/exports';
import type {
  ExecutionContext,
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeDriverInstance,
  SqlRuntimeExtensionDescriptor,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { type Runtime, type RuntimeOptions, SqlRuntimeBase } from '../src/sql-runtime';
import { defineTestCodec } from './test-codec';

function createTestMutationDefaultGenerators() {
  return builtinGeneratorIds.map((id) => ({
    id,
    generate: (params?: Record<string, unknown>) => generateId(params ? { id, params } : { id }),
    stability: 'field' as const,
  }));
}

/**
 * The slice of a SQL client the database helpers below use.
 *
 * Structural rather than `pg.Client`: this package is the target-agnostic SQL
 * runtime, so its published test surface must not name a specific driver's
 * client class — doing so put `pg` (a devDependency here) into declarations
 * consumers install. A real `pg.Client` satisfies this as-is.
 */
export interface TestSqlClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/** Collects every value an async iterable yields. */
export async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

/** Exhausts an async iterable without retaining its values. */
export async function drainAsyncIterable<T>(iterable: AsyncIterable<T>): Promise<void> {
  for await (const _ of iterable) {
    // exhaust iterator
  }
}

function applicationDomainOf(params: {
  readonly models?: Record<string, ContractModelBase>;
  readonly namespaceId?: string;
}): ApplicationDomain {
  return {
    namespaces: {
      [params.namespaceId ?? UNBOUND_DOMAIN_NAMESPACE_ID]: { models: params.models ?? {} },
    },
  };
}

class TestSqlRuntime extends SqlRuntimeBase {}

type CreateTestRuntimeOptions<TContract extends Contract<SqlStorage>> = Omit<
  RuntimeOptions<TContract>,
  'adapter'
> & {
  readonly stackInstance: { readonly adapter: RuntimeOptions<TContract>['adapter'] };
};

/**
 * Test-only concrete runtime. Unpacks `stackInstance.adapter` and forwards
 * the rest into `TestSqlRuntime`, a trivial concrete leaf of the abstract
 * `SqlRuntimeBase`.
 */
export function createTestRuntime<TContract extends Contract<SqlStorage>>(
  options: CreateTestRuntimeOptions<TContract>,
): Runtime {
  const { stackInstance, context, driver, verifyMarker, middleware, mode, log } = options;
  return new TestSqlRuntime({
    context,
    adapter: stackInstance.adapter,
    driver,
    ...ifDefined('verifyMarker', verifyMarker),
    ...ifDefined('middleware', middleware),
    ...ifDefined('mode', mode),
    ...ifDefined('log', log),
  });
}

/**
 * Executes a plan and collects all results into an array. This helper DRYs up the common pattern of executing plans in tests. The return type is inferred from the plan's type parameter.
 */
export async function executePlanAndCollect<
  P extends SqlExecutionPlan<ResultType<P>> | SqlQueryPlan<ResultType<P>>,
>(runtime: Runtime, plan: P): Promise<ResultType<P>[]> {
  type Row = ResultType<P>;
  return collectAsync<Row>(runtime.query<Row>(plan));
}

/**
 * Drains a plan execution, consuming all results without collecting them. Useful for testing side effects without memory overhead.
 */
export async function drainPlanExecution(
  runtime: Runtime,
  plan: SqlExecutionPlan | SqlQueryPlan<unknown>,
): Promise<void> {
  return drainAsyncIterable(runtime.query(plan));
}

/**
 * Sets up database schema and data, then writes the contract marker. This helper DRYs up the common pattern of database setup in tests.
 *
 * Callers must supply `bootstrapMarkerTables` (typically
 * `bootstrapPostgresSignMarkerTables` from integration `postgres-bootstrap.ts`)
 * so this package does not depend on the postgres adapter/target packs.
 */
export async function setupTestDatabase<TClient extends TestSqlClient>(
  client: TClient,
  contract: Contract<SqlStorage>,
  setupFn: (client: TClient) => Promise<void>,
  bootstrapMarkerTables: (client: TClient) => Promise<void>,
): Promise<void> {
  await client.query('drop schema if exists prisma_contract cascade');
  await client.query('create schema if not exists public');

  await setupFn(client);

  await bootstrapMarkerTables(client);
  await writeTestContractMarker(client, contract);
}

export interface SeedMarkerInput {
  /** Logical space for the marker row; defaults to {@link APP_SPACE_ID}. */
  readonly space?: string;
  readonly storageHash: string;
  readonly profileHash: string;
  readonly contractJson?: unknown;
  readonly canonicalVersion?: number;
  readonly invariants?: readonly string[];
}

/**
 * Seeds a contract marker row directly via raw SQL. Test-only: the production
 * write path goes through the control adapter SPI (`initMarker`/`updateMarker`),
 * which needs a `ControlDriverInstance`; these fixtures hold a raw `pg.Client`,
 * so they perform a minimal `INSERT` over the columns the runtime reads back.
 */
export async function seedTestMarker(client: TestSqlClient, input: SeedMarkerInput): Promise<void> {
  await client.query(
    `insert into prisma_contract.marker
       (space, core_hash, profile_hash, contract_json, canonical_version, invariants, updated_at)
     values ($1, $2, $3, $4::jsonb, $5, $6::text[], now())`,
    [
      input.space ?? APP_SPACE_ID,
      input.storageHash,
      input.profileHash,
      input.contractJson === undefined ? null : JSON.stringify(input.contractJson),
      input.canonicalVersion ?? null,
      input.invariants ?? [],
    ],
  );
}

/**
 * Seeds the app-space marker for a contract. Thin wrapper over
 * {@link seedTestMarker} for the common "write the marker for this contract" case.
 */
export async function writeTestContractMarker(
  client: TestSqlClient,
  contract: Contract<SqlStorage>,
): Promise<void> {
  await seedTestMarker(client, {
    storageHash: contract.storage.storageHash,
    profileHash: contract.profileHash,
    contractJson: contract,
    canonicalVersion: 1,
  });
}

/**
 * Creates a test adapter descriptor from a raw adapter. Wraps the adapter in an SqlRuntimeAdapterDescriptor with static contributions derived from the adapter's codec registry.
 */
/**
 * Build a {@link ContractCodecRegistry} from a codec array for tests that exercise `encodeParam(s)` / `decodeRow` in isolation. The production runtime builds `ContractCodecRegistry` from contract walk + descriptor list and never goes through this helper; tests use it to wire a hand-built codec set into the surface those functions consume in production.
 */
export function buildTestContractCodecs(
  codecs: ReadonlyArray<Codec<string>>,
): ContractCodecRegistry {
  const byId = new Map<string, Codec<string>>();
  for (const codec of codecs) {
    byId.set(codec.id, codec);
  }
  // Canonical-key cache: production `forCodecRef` memoizes per `(codecId, canonicalize(typeParams))`. Tests resolve by codecId, but key the cache on the canonical pair so callers passing distinct typeParams get distinct (still codec-id-templated) entries — and so this helper cannot silently coalesce them.
  const byCanonicalKey = new Map<string, Codec<string>>();
  return {
    forColumn: () => undefined,
    forCodecRef: (ref) => {
      const canonicalKey = canonicalizeJson({
        codecId: ref.codecId,
        ...(ref.typeParams !== undefined ? { typeParams: ref.typeParams } : {}),
      });
      const cached = byCanonicalKey.get(canonicalKey);
      if (cached) return cached;
      const template = byId.get(ref.codecId);
      if (!template) {
        throw runtimeError(
          'RUNTIME.CODEC_DESCRIPTOR_MISSING',
          `Test ContractCodecRegistry has no codec for codecId '${ref.codecId}'.`,
          {
            codecId: ref.codecId,
            ...(ref.typeParams !== undefined ? { typeParams: ref.typeParams } : {}),
          },
        );
      }
      byCanonicalKey.set(canonicalKey, template);
      return template;
    },
  };
}

/**
 * Synthesize `CodecDescriptor`s from a codec array of non-parameterized codec instances. Test-only: the production synthesis bridge was retired under TML-2357. Lets the existing `createTestAdapterDescriptor` pattern keep wrapping a stub `Adapter` (whose `__codecs` slot still exposes the codec set) into the descriptor-list shape that `SqlStaticContributions.codecs:` now expects. The `Codec` instances carry
 * `traits`/`targetTypes` via the SQL family extension; the structural narrow reads those fields directly.
 */
export function descriptorsFromCodecs(
  codecs: ReadonlyArray<Codec<string>>,
): ReadonlyArray<CodecDescriptor> {
  // Permissive paramsSchema for synthesized test descriptors: accepts any
  // shape (incl. undefined) and passes it through. Stubs do not encode
  // parameterization, so marking them `isParameterized: true` with this
  // schema lets the runtime integrity check tolerate columns that legitimately
  // carry typeParams (e.g. `sql/char@1` length=36) without re-introducing
  // the legacy "non-parameterized + typeParams" silent skip.
  // Permissive schema for synthesized test descriptors. `validate()` always
  // succeeds and discards input, narrowed to `void` to match the
  // `paramsSchema: StandardSchemaV1<void, void>` slot on the descriptor.
  // The factory ignores typeParams, so typing the validated output as `void`
  // is honest about what the stub does with the value.
  const acceptAnyParamsSchema = {
    '~standard': {
      version: 1 as const,
      vendor: 'sql-runtime/test-utils',
      validate: (_value: unknown) => ({ value: undefined }),
    },
  };
  const descriptors: CodecDescriptor[] = [];
  for (const instance of codecs) {
    const legacy = instance as {
      readonly traits?: readonly CodecTrait[];
      readonly targetTypes?: readonly string[];
    };
    descriptors.push({
      codecId: instance.id,
      traits: legacy.traits ?? [],
      targetTypes: legacy.targetTypes ?? [],
      paramsSchema: acceptAnyParamsSchema,
      isParameterized: true,
      factory: () => () => instance,
    });
  }
  return descriptors;
}

export function createTestAdapterDescriptor(
  adapter: StubAdapter,
): SqlRuntimeAdapterDescriptor<'postgres'> {
  const descriptors = descriptorsFromCodecs(adapter.__codecs);
  return {
    kind: 'adapter' as const,
    rawCodecInferer: { inferCodec: () => 'pg/text' },
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptors,
    mutationDefaultGenerators: createTestMutationDefaultGenerators,
    create(_stack): SqlRuntimeAdapterInstance<'postgres'> {
      return Object.assign({ familyId: 'sql' as const, targetId: 'postgres' as const }, adapter);
    },
  };
}

/**
 * Creates a test target descriptor with empty static contributions.
 */
export function createTestTargetDescriptor(): SqlRuntimeTargetDescriptor<'postgres'> {
  return {
    kind: 'target' as const,
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

/**
 * Creates an ExecutionContext for testing. This helper DRYs up the common pattern of context creation in tests.
 *
 * Accepts a raw adapter and optional extension descriptors, wrapping the adapter in a descriptor internally for descriptor-first context creation.
 */
export function createTestContext<TContract extends Contract<SqlStorage>>(
  contract: TContract,
  adapter: StubAdapter,
  options?: {
    extensions?: ReadonlyArray<SqlRuntimeExtensionDescriptor<'postgres'>>;
  },
): ExecutionContext<TContract> {
  return createExecutionContext({
    contract,
    stack: {
      target: createTestTargetDescriptor(),
      adapter: createTestAdapterDescriptor(adapter),
      extensions: options?.extensions ?? [],
    },
  });
}

export function createTestStackInstance(options?: {
  extensions?: ReadonlyArray<SqlRuntimeExtensionDescriptor<'postgres'>>;
  driver?: RuntimeDriverDescriptor<
    'sql',
    'postgres',
    unknown,
    SqlRuntimeDriverInstance<'postgres'>
  >;
}) {
  const stack = createSqlExecutionStack({
    target: createTestTargetDescriptor(),
    adapter: createTestAdapterDescriptor(createStubAdapter()),
    driver: options?.driver,
    extensions: options?.extensions ?? [],
  });

  return instantiateExecutionStack(stack);
}

/**
 * Stub-adapter type augments the public {@link Adapter} surface with a `__codecs` slot that exposes the test stub's runtime codec set to descriptor-shaping helpers (`createTestAdapterDescriptor`). Production adapters do not declare this slot — runtime codecs flow through the descriptor list from `SqlRuntimeAdapterDescriptor.codecs()` — so the augmentation is intentionally test-only.
 */
export type StubAdapter = Adapter<SelectAst, Contract<SqlStorage>, LoweredStatement> & {
  readonly __codecs: ReadonlyArray<Codec<string>>;
};

/**
 * Creates a stub adapter for testing. This helper DRYs up the common pattern of adapter creation in tests.
 *
 * The stub adapter includes simple codecs for common test types (pg/int4@1, pg/text@1, pg/timestamptz-temporal@1) to enable type inference in tests without requiring the postgres adapter package.
 */
export function createStubAdapter(): StubAdapter {
  // Stub codecs for codec IDs that test contracts may reference. The set must
  // be complete enough to satisfy `assertColumnCodecIntegrity` against any
  // emitted test contract; the encode/decode bodies are passthrough since
  // the stub adapter never executes against a real driver.
  // The encode/decode bodies pass through; widen TInput to a JSON-safe type
  // so `defineTestCodec` does not require explicit JSON round-trip helpers.
  const passthroughCodec = (typeId: string, targetType: string): Codec<string> =>
    defineTestCodec({
      typeId,
      targetTypes: [targetType],
      encode: (value: string | number | boolean | null) => value,
      decode: (wire: string | number | boolean | null) => wire,
    });
  const codecs: ReadonlyArray<Codec<string>> = [
    passthroughCodec('pg/bit@1', 'bit'),
    passthroughCodec('pg/bool@1', 'bool'),
    passthroughCodec('pg/bytea@1', 'bytea'),
    passthroughCodec('pg/float4@1', 'float4'),
    passthroughCodec('pg/float8@1', 'float8'),
    passthroughCodec('pg/int2@1', 'int2'),
    defineTestCodec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      encode: (value: number) => value,
      decode: (wire: number) => wire,
    }),
    passthroughCodec('pg/int8@1', 'int8'),
    passthroughCodec('pg/interval@1', 'interval'),
    passthroughCodec('pg/json@1', 'json'),
    passthroughCodec('pg/jsonb@1', 'jsonb'),
    passthroughCodec('pg/numeric@1', 'numeric'),
    defineTestCodec({
      typeId: 'pg/text@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    }),
    passthroughCodec('pg/time-temporal@1', 'time'),
    defineTestCodec({
      typeId: 'pg/timestamp-temporal@1',
      targetTypes: ['timestamp'],
      encode: (value: Date) => value,
      decode: (wire: Date) => wire,
      encodeJson: (value: Date) => value.toISOString(),
      decodeJson: (json) => {
        if (typeof json !== 'string') throw new Error('expected ISO date string');
        return new Date(json);
      },
    }),
    defineTestCodec({
      typeId: 'pg/timestamptz-temporal@1',
      targetTypes: ['timestamptz'],
      encode: (value: Date) => value,
      decode: (wire: Date) => wire,
      // Date is not assignable to JsonValue, so the JSON round-trip pair must be supplied explicitly.
      encodeJson: (value: Date) => value.toISOString(),
      decodeJson: (json) => {
        if (typeof json !== 'string') throw new Error('expected ISO date string');
        return new Date(json);
      },
    }),
    passthroughCodec('pg/timetz@1', 'timetz'),
    passthroughCodec('pg/varbit@1', 'varbit'),
    passthroughCodec('pg/uuid@1', 'uuid'),
    passthroughCodec('sql/char@1', 'char'),
    passthroughCodec('sql/varchar@1', 'varchar'),
  ];

  return {
    __codecs: codecs,
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      readMarker: async () => ({ kind: 'absent' as const }),
    },
    lower(ast: SelectAst, _ctx: { contract: Contract<SqlStorage>; params?: readonly unknown[] }) {
      const sqlText = JSON.stringify(ast);
      const refs = ast.collectParamRefs();
      const params = refs.map((ref) =>
        ref.kind === 'prepared-param-ref'
          ? ({ kind: 'bind' as const, name: ref.name } as const)
          : ({ kind: 'literal' as const, value: ref.value } as const),
      );
      return Object.freeze({ sql: sqlText, params });
    },
  };
}

export function unboundNamespaceWithTables(
  tables: Record<string, StorageTableInput>,
): ReturnType<typeof createTestSqlNamespace> {
  return createTestSqlNamespace({ id: UNBOUND_NAMESPACE_ID, entries: { table: tables } });
}

export function emptySqlTestDomain() {
  return applicationDomainOf({ models: {} });
}

export function createTestContract(
  contract: Partial<Omit<Contract<SqlStorage>, 'profileHash' | 'storage' | 'domain'>> & {
    storageHash?: string;
    profileHash?: string;
    models?: Record<string, ContractModelBase>;
    domain?: Contract<SqlStorage>['domain'];
    storage?: Partial<Omit<SqlStorageInput, 'storageHash'>>;
  },
): Contract<SqlStorage> {
  const { execution, ...rest } = contract;
  const storageHashValue = coreHash(rest['storageHash'] ?? 'testcore');

  return {
    target: rest['target'] ?? 'postgres',
    targetFamily: rest['targetFamily'] ?? 'sql',
    storage: rest['storage']
      ? new SqlStorage({
          ...rest['storage'],
          storageHash: storageHashValue,
          namespaces: rest['storage'].namespaces ?? {
            __unbound__: createTestSqlNamespace({ id: '__unbound__', entries: { table: {} } }),
          },
        })
      : new SqlStorage({
          storageHash: storageHashValue,
          namespaces: {
            __unbound__: createTestSqlNamespace({ id: '__unbound__', entries: { table: {} } }),
          },
        }),
    domain: rest['domain'] ?? applicationDomainOf({ models: rest['models'] ?? {} }),
    roots: rest['roots'] ?? {},
    capabilities: rest['capabilities'] ?? {},
    extensions: rest['extensions'] ?? {},
    meta: rest['meta'] ?? {},
    ...(execution ? { execution } : {}),
    profileHash: profileHash(rest['profileHash'] ?? 'testprofile'),
  };
}

export function stubAst(): AnyQueryAst {
  return SelectAstCtor.from(TableSource.named('stub'));
}

// Re-export decode helpers so cross-package tests can exercise the row-decode
// path (e.g. RUNTIME.DECODE_FAILED for a malformed many-element) without going
// through the full query round-trip.
export { buildDecodeContext, decodeRow } from '../src/codecs/decoding';
