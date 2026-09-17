/**
 * Migration strategies.
 *
 * Each strategy examines the node-typed diff-issue list, consumes issues it
 * handles, and returns the `PostgresOpFactoryCall[]` to address them. The
 * issue planner runs each strategy in order and routes whatever's left
 * through `mapNodeIssueToCall`.
 *
 * The full ordered list is exported as `postgresPlannerStrategies` and is
 * used unchanged by both `migration plan` and `db update` / `db init`. The
 * two journeys differ only in `policy.allowedOperationClasses`:
 *
 * - When `'data'` is in the policy, data-safe strategies (NOT NULL backfill,
 *   nullability tightening, unsafe type changes) emit
 *   `DataTransformCall` placeholders that the user fills in.
 * - When `'data'` is excluded, those strategies short-circuit so the
 *   downstream strategies (codec-hook type ops and temp-default backfill)
 *   and `mapNodeIssueToCall` defaults emit direct DDL instead.
 *
 * Structural decisions (type/nullability drift, DDL fragments) read the diff
 * node pair and resolve column DDL from the node's `codecRef` (`column-ddl-
 * rendering.ts`). The retained subsystems — codec type-operations
 * (`storageTypePlanCallStrategy`) and the NOT-NULL temp-default deferred DDL
 * (`notNullAddColumnCallStrategy`) — keep reading the contract + codec hooks
 * via `StrategyContext`, per the slice's scope (see `diff-database-schema.ts`
 * / the slice spec).
 */

import type { Contract } from '@internal/contract/types';
import type {
  CodecControlHooks,
  MigrationOperationPolicy,
  SqlMigrationPlanOperation,
} from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { issueOutcome } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage, StorageTable, StorageTypeInstance } from '@internal/sql-contract/types';
import * as contractFree from '@internal/sql-relational-core/contract-free';
import {
  RelationalSchemaNodeKind,
  type SqlColumnIR,
  type SqlSchemaIR,
} from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { isPostgresSchema } from '../postgres-schema';
import {
  renderColumnAlterType,
  renderColumnDdl,
  resolveColumnTemporaryDefault,
} from './column-ddl-rendering';
import { resolveNamespaceIdForDdlSchema } from './control-policy';
import { emissionSchemaName, issueNode, issueSchemaName, issueTableName } from './issue-planner';
import {
  AddColumnCall,
  AddNotNullColumnDirectCall,
  AddNotNullColumnWithTempDefaultCall,
  AlterColumnTypeCall,
  DataTransformCall,
  DropNotNullCall,
  type PostgresOpFactoryCall,
  RawSqlCall,
  SetNotNullCall,
} from './op-factory-call';
import { buildSchemaLookupMap, hasForeignKey, hasUniqueConstraint } from './planner-schema-lookup';
import { buildTargetDetails, type PostgresPlanTargetDetails } from './planner-target-details';

/**
 * Look up a storage table by its explicit namespace coordinate. Returns
 * `undefined` when the namespace has no table by that name (or no such
 * namespace exists). Callers that get `undefined` MUST treat it as an
 * explicit conflict — never silently fall back to a global default
 * schema or a name-only walk, because that footgun would resolve a
 * stale or duplicate table name to whichever namespace the iteration
 * order surfaced first (a real data-loss hazard in multi-namespace
 * contracts where two namespaces can carry the same table name).
 */
export function tableAt(
  storage: SqlStorage,
  namespaceId: string,
  tableName: string,
): StorageTable | undefined {
  const ns = storage.namespaces[namespaceId];
  if (ns === undefined) return undefined;
  return ns.entries.table?.[tableName];
}

/**
 * Resolve the DDL schema name for a namespace coordinate. Postgres-aware
 * namespaces dispatch to their polymorphic `ddlSchemaName` override —
 * named schemas return their own id; the unbound singleton returns
 * `UNBOUND_NAMESPACE_ID`. Legacy single-namespace contracts whose
 * `__unbound__` slot is the framework-default `SqlUnboundNamespace`
 * (rather than the Postgres-aware `PostgresUnboundSchema`) flow the
 * coordinate through unchanged so downstream `qualifyTableName`
 * resolves polymorphically.
 */
export function resolveDdlSchemaForNamespace(ctx: StrategyContext, namespaceId: string): string {
  const namespace = ctx.toContract.storage.namespaces[namespaceId];
  if (isPostgresSchema(namespace)) {
    return namespace.ddlSchemaName(ctx.toContract.storage);
  }
  return namespaceId;
}

/**
 * Recovers the contract namespace id for a DDL schema name embedded in a
 * diff-issue path (`path[1]`). The strategies need the CONTRACT column/table
 * (for codec-hook reads and eligibility probes the retained subsystems still
 * run) even though the issue itself only carries the resolved DDL schema —
 * this is the reverse of `resolveDdlSchemaForNamespace`.
 */
function namespaceIdForDdlSchema(ctx: StrategyContext, ddlSchemaName: string): string {
  return resolveNamespaceIdForDdlSchema(ctx.toContract, ddlSchemaName);
}

// ============================================================================
// Strategy types
// ============================================================================

/**
 * Context passed to each migration strategy.
 *
 * Strategies read the source (`fromContract`), target (`toContract`), current
 * database state (`schema`), operation policy (`policy`), and component list
 * (`frameworkComponents`) to make planning decisions. `fromContract` is null
 * when no prior contract is available (e.g. `db update`, where the current
 * DB state is approximated via `schema`).
 */
export interface StrategyContext {
  readonly toContract: Contract<SqlStorage>;
  readonly fromContract: Contract<SqlStorage> | null;
  readonly schemaName: string;
  readonly codecHooks: ReadonlyMap<string, CodecControlHooks>;
  readonly storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  readonly schema: SqlSchemaIR;
  readonly policy: MigrationOperationPolicy;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

// ============================================================================
// Call strategies (for issue planner)
// ============================================================================

/**
 * Consumes node-typed diff issues (`SchemaDiffIssue`, from the one differ —
 * `buildPostgresPlanDiff`), reading the issue's node pair for structural
 * decisions and resolving column DDL from the node's `codecRef`. The
 * retained subsystems (codec type-operations, the NOT-NULL temp-default
 * backfill) keep reading the contract via `StrategyContext`.
 */
export type CallMigrationStrategy = (
  issues: readonly SchemaDiffIssue[],
  context: StrategyContext,
) =>
  | {
      kind: 'match';
      issues: readonly SchemaDiffIssue[];
      calls: readonly PostgresOpFactoryCall[];
      /**
       * `true` for strategies that emit cohesive sequential recipes whose
       * calls must stay contiguous and in the returned order — e.g.
       * `notNullBackfillCallStrategy` (addColumn → dataTransform → setNotNull).
       * Defaults to `false`, which lets `planIssues` hoist individual calls
       * into their DDL sequencing bucket.
       */
      recipe?: boolean;
    }
  | { kind: 'no_match' };

/** A `not-equal` column issue whose node pair is narrowed to `SqlColumnIR`. */
function columnNodePair(
  issue: SchemaDiffIssue,
): { readonly expected: SqlColumnIR; readonly actual: SqlColumnIR } | undefined {
  const node = issueNode(issue);
  if (node === undefined || node.nodeKind !== RelationalSchemaNodeKind.column) return undefined;
  if (issue.expected === undefined || issue.actual === undefined) return undefined;
  return {
    expected: blindCast<SqlColumnIR, 'a column diff node is always a SqlColumnIR'>(issue.expected),
    actual: blindCast<SqlColumnIR, 'a column diff node is always a SqlColumnIR'>(issue.actual),
  };
}

export const notNullBackfillCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  // `DataTransformCall` is operation class `'data'`. When the policy excludes
  // it (`db update` / `db init`), skip so `notNullAddColumnCallStrategy`
  // (temp-default backfill) or `mapNodeIssueToCall` can take the issue.
  if (!ctx.policy.allowedOperationClasses.includes('data')) return { kind: 'no_match' };

  const matched: SchemaDiffIssue[] = [];
  const calls: PostgresOpFactoryCall[] = [];

  for (const issue of issues) {
    if (issueOutcome(issue) !== 'not-found') continue;
    const node = issueNode(issue);
    if (node === undefined || node.nodeKind !== RelationalSchemaNodeKind.column) continue;
    const expected = blindCast<
      SqlColumnIR,
      'a not-found column issue always carries the expected column node'
    >(issue.expected);
    if (expected.nullable !== false || expected.resolvedDefault !== undefined) continue;

    const ddlSchemaName = issueSchemaName(issue);
    const tableName = issueTableName(issue);
    if (ddlSchemaName === undefined || tableName === undefined) continue;
    const schemaName = emissionSchemaName(ctx, ddlSchemaName);

    matched.push(issue);
    const ddl = renderColumnDdl(expected.name, expected, ctx.codecHooks);
    const nullableSpec = contractFree.col(ddl.name, ddl.type, {
      ...(ddl.codecRef !== undefined ? { codecRef: ddl.codecRef } : {}),
    });
    calls.push(
      new AddColumnCall(schemaName, tableName, nullableSpec),
      new DataTransformCall(
        `backfill-${tableName}-${expected.name}`,
        `backfill-${tableName}-${expected.name}:check`,
        `backfill-${tableName}-${expected.name}:run`,
      ),
      new SetNotNullCall(schemaName, tableName, expected.name),
    );
  }

  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    calls,
    recipe: true,
  };
};

const SAFE_WIDENINGS = new Set(['int2→int4', 'int2→int8', 'int4→int8', 'float4→float8']);

/**
 * Handles `not-equal` column issues whose TYPE differs. `fromContract` is
 * only supplied by `migration plan` — for reconciliation (`db update` /
 * `db init`, `fromContract === null`) this strategy never fires, mirroring
 * the legacy `typeChangeCallStrategy`'s requirement of a prior contract:
 * `mapNodeIssueToCall`'s in-place ALTER covers reconciliation directly.
 *
 * A single node issue can carry BOTH type and nullability drift (Postgres
 * alters in place, so the differ emits one `not-equal` column issue where
 * the legacy coordinate walk emitted two: `type_mismatch` +
 * `nullability_mismatch`). When this strategy consumes the issue for its
 * type portion, it also emits whatever nullability delta the same node pair
 * carries — using the same construction `nullableTighteningCallStrategy` /
 * the mapper's direct dispatch would have used — so the issue is never
 * partially handled.
 */
export const typeChangeCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  if (ctx.fromContract === null) return { kind: 'no_match' };
  const dataAllowed = ctx.policy.allowedOperationClasses.includes('data');

  const matched: SchemaDiffIssue[] = [];
  const calls: PostgresOpFactoryCall[] = [];

  for (const issue of issues) {
    if (issueOutcome(issue) !== 'not-equal') continue;
    const pair = columnNodePair(issue);
    if (pair === undefined) continue;
    const { expected, actual } = pair;
    if (!columnTypeChangedNativeOnly(expected, actual)) continue;

    const fromType = actual.nativeType;
    const toType = expected.nativeType;
    const isSafeWidening = SAFE_WIDENINGS.has(`${fromType}→${toType}`);
    if (!isSafeWidening && !dataAllowed) continue;

    const ddlSchemaName = issueSchemaName(issue);
    const tableName = issueTableName(issue);
    if (ddlSchemaName === undefined || tableName === undefined) continue;
    const schemaName = emissionSchemaName(ctx, ddlSchemaName);

    matched.push(issue);
    const { qualifiedTargetType, formatTypeExpected } = renderColumnAlterType(
      expected,
      ctx.codecHooks,
    );
    const alterOpts = {
      qualifiedTargetType,
      formatTypeExpected,
      rawTargetTypeForLabel: qualifiedTargetType,
    };
    if (isSafeWidening) {
      calls.push(new AlterColumnTypeCall(schemaName, tableName, expected.name, alterOpts));
    } else {
      calls.push(
        new DataTransformCall(
          `typechange-${tableName}-${expected.name}`,
          `typechange-${tableName}-${expected.name}:check`,
          `typechange-${tableName}-${expected.name}:run`,
        ),
        new AlterColumnTypeCall(schemaName, tableName, expected.name, alterOpts),
      );
    }

    if (expected.nullable !== actual.nullable) {
      if (expected.nullable) {
        calls.push(new DropNotNullCall(schemaName, tableName, expected.name));
      } else if (dataAllowed) {
        calls.push(
          new DataTransformCall(
            `handle-nulls-${tableName}-${expected.name}`,
            `handle-nulls-${tableName}-${expected.name}:check`,
            `handle-nulls-${tableName}-${expected.name}:run`,
          ),
          new SetNotNullCall(schemaName, tableName, expected.name),
        );
      } else {
        calls.push(new SetNotNullCall(schemaName, tableName, expected.name));
      }
    }
  }

  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    calls,
    recipe: true,
  };
};

/**
 * Whether the raw (unresolved) native type differs — the SAME comparison
 * `typeChangeCallStrategy` always used (`fromColumn.nativeType !==
 * toColumn.nativeType`), which for the widenable numeric/float types
 * `SAFE_WIDENINGS` lists is identical to the resolved comparison
 * `columnTypeChanged` (in `issue-planner.ts`) performs.
 */
function columnTypeChangedNativeOnly(expected: SqlColumnIR, actual: SqlColumnIR): boolean {
  return expected.nativeType !== actual.nativeType;
}

/**
 * Handles `not-equal` column issues whose type did NOT change but
 * nullability tightened (contract requires NOT NULL, live column is
 * nullable). A type-changed issue's nullability delta (if any) is already
 * handled by `typeChangeCallStrategy`, which runs first — this strategy
 * only ever sees issues that strategy left behind.
 */
export const nullableTighteningCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  // `DataTransformCall` is operation class `'data'`. When the policy excludes
  // it (`db update` / `db init`), skip so `mapNodeIssueToCall` emits a direct
  // `SET NOT NULL` instead.
  if (!ctx.policy.allowedOperationClasses.includes('data')) return { kind: 'no_match' };

  const matched: SchemaDiffIssue[] = [];
  const calls: PostgresOpFactoryCall[] = [];

  for (const issue of issues) {
    if (issueOutcome(issue) !== 'not-equal') continue;
    const pair = columnNodePair(issue);
    if (pair === undefined) continue;
    const { expected, actual } = pair;
    if (columnTypeChangedNativeOnly(expected, actual)) continue; // typeChangeCallStrategy's concern
    if (expected.nullable !== false || actual.nullable !== true) continue;

    const ddlSchemaName = issueSchemaName(issue);
    const tableName = issueTableName(issue);
    if (ddlSchemaName === undefined || tableName === undefined) continue;
    const schemaName = emissionSchemaName(ctx, ddlSchemaName);

    matched.push(issue);
    calls.push(
      new DataTransformCall(
        `handle-nulls-${tableName}-${expected.name}`,
        `handle-nulls-${tableName}-${expected.name}:check`,
        `handle-nulls-${tableName}-${expected.name}:run`,
      ),
      new SetNotNullCall(schemaName, tableName, expected.name),
    );
  }

  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    calls,
    recipe: true,
  };
};

/**
 * Dispatches codec-typed storage types through their codec's
 * `planTypeOperations` hook (the authoritative source for codec-driven DDL
 * such as custom type creation). Codec extension/type ops are not modeled as
 * diff nodes — this strategy drives entirely off `ctx.toContract.storage.types`
 * + codec hooks, consuming nothing from the node issue list (there is no
 * node-vocabulary equivalent of `type_missing` / `enum_values_changed`).
 */
export const storageTypePlanCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  const storageTypes = ctx.toContract.storage.types ?? {};
  if (Object.keys(storageTypes).length === 0) return { kind: 'no_match' };

  const calls: PostgresOpFactoryCall[] = [];

  for (const [typeName, typeInstance] of Object.entries(storageTypes).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const codecInstance = blindCast<
      StorageTypeInstance,
      'Postgres storage type registry values are StorageTypeInstance entries'
    >(typeInstance);
    const hook = ctx.codecHooks.get(codecInstance.codecId);
    if (!hook?.planTypeOperations) continue;
    const planResult = hook.planTypeOperations({
      typeName,
      typeInstance: codecInstance,
      contract: ctx.toContract,
      schema: ctx.schema,
      schemaName: ctx.schemaName,
      policy: ctx.policy,
    });
    if (!planResult) continue;
    for (const op of planResult.operations) {
      calls.push(
        new RawSqlCall(
          blindCast<
            SqlMigrationPlanOperation<PostgresPlanTargetDetails>,
            'codec type operation target details are rewritten to Postgres type target details'
          >({
            ...op,
            target: {
              id: op.target.id,
              details: buildTargetDetails('type', typeName, ctx.schemaName),
            },
          }),
        ),
      );
    }
  }

  if (calls.length === 0) return { kind: 'no_match' };
  return { kind: 'match', issues, calls };
};

/**
 * Handles `not-found` column issues for NOT NULL columns without a contract
 * default. Replaces the legacy `buildAddColumnItem` non-default branches.
 *
 * Two shapes:
 *  - Shared-temp-default safe: emit a single atomic composite op (add
 *    nullable → backfill identity value → `SET NOT NULL` → `DROP DEFAULT`).
 *    The temp-default value is resolved from the column node's `codecRef`
 *    (`resolveColumnTemporaryDefault`, wrapping `resolveIdentityValue`).
 *  - Empty-table guarded: emit a hand-built op with a `tableIsEmptyCheck`
 *    precheck so the failure message is "table is not empty" rather than the
 *    raw PG NOT NULL violation.
 *
 * "Normal" not-found column cases (nullable or has a contract default) are
 * left for `mapNodeIssueToCall`'s default `AddColumnCall` emission.
 */
export const notNullAddColumnCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  const matched: SchemaDiffIssue[] = [];
  const calls: PostgresOpFactoryCall[] = [];

  const schemaLookups = buildSchemaLookupMap(ctx.schema);

  const mutableCodecHooks = blindCast<
    Map<string, CodecControlHooks>,
    'strategy context owns a mutable codec hook map during planning'
  >(ctx.codecHooks);
  const mutableStorageTypes = blindCast<
    Record<string, StorageTypeInstance>,
    'strategy context owns mutable storage type entries during planning'
  >(ctx.storageTypes);

  for (const issue of issues) {
    if (issueOutcome(issue) !== 'not-found') continue;
    const node = issueNode(issue);
    if (node === undefined || node.nodeKind !== RelationalSchemaNodeKind.column) continue;
    const expected = blindCast<
      SqlColumnIR,
      'a not-found column issue always carries the expected column node'
    >(issue.expected);
    if (expected.nullable !== false || expected.resolvedDefault !== undefined) continue;

    const ddlSchemaName = issueSchemaName(issue);
    const tableName = issueTableName(issue);
    if (ddlSchemaName === undefined || tableName === undefined) continue;

    const namespaceId = namespaceIdForDdlSchema(ctx, ddlSchemaName);
    const schemaName = namespaceId === UNBOUND_NAMESPACE_ID ? UNBOUND_NAMESPACE_ID : ddlSchemaName;
    const contractTable = tableAt(ctx.toContract.storage, namespaceId, tableName);
    const column = contractTable?.columns[expected.name];
    if (!contractTable || !column) continue;

    const schemaTable = ctx.schema.tables[tableName];
    if (!schemaTable) continue;

    const temporaryDefault = resolveColumnTemporaryDefault(expected, ctx.codecHooks);
    const schemaLookup = schemaLookups.get(tableName);
    const canUseSharedTempDefault =
      temporaryDefault !== null &&
      canUseSharedTemporaryDefaultStrategy({
        table: contractTable,
        schemaTable,
        schemaLookup,
        columnName: expected.name,
      });

    matched.push(issue);

    if (canUseSharedTempDefault && temporaryDefault !== null) {
      calls.push(
        new AddNotNullColumnWithTempDefaultCall({
          schemaName,
          tableName,
          columnName: expected.name,
          column,
          codecHooks: mutableCodecHooks,
          storageTypes: mutableStorageTypes,
          temporaryDefault,
        }),
      );
      continue;
    }

    calls.push(
      new AddNotNullColumnDirectCall(
        schemaName,
        tableName,
        expected.name,
        renderColumnDdl(expected.name, expected, ctx.codecHooks),
      ),
    );
  }

  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    calls,
  };
};

// ============================================================================
// Strategy helpers
// ============================================================================

function canUseSharedTemporaryDefaultStrategy(options: {
  readonly table: StorageTable;
  readonly schemaTable: SqlSchemaIR['tables'][string];
  readonly schemaLookup: ReturnType<typeof buildSchemaLookupMap> extends ReadonlyMap<
    string,
    infer V
  >
    ? V | undefined
    : never;
  readonly columnName: string;
}): boolean {
  const { table, schemaTable, schemaLookup, columnName } = options;

  if (table.primaryKey?.columns.includes(columnName) && !schemaTable.primaryKey) {
    return false;
  }

  for (const unique of table.uniques) {
    if (!unique.columns.includes(columnName)) continue;
    if (!schemaLookup || !hasUniqueConstraint(schemaLookup, unique.columns)) return false;
  }

  for (const foreignKey of table.foreignKeys) {
    if (!foreignKey.source.columns.includes(columnName)) continue;
    if (!schemaLookup || !hasForeignKey(schemaLookup, foreignKey)) return false;
  }

  return true;
}

/**
 * Ordered list of Postgres planner strategies, shared by `migration plan`
 * and `db update` / `db init`. The issue planner runs each strategy in
 * order, letting it consume any issues it handles, and routes whatever's
 * left through `mapNodeIssueToCall`. Behavior diverges purely on
 * `policy.allowedOperationClasses`:
 *
 * - When `'data'` is allowed (`migration plan`), the data-safe strategies
 *   (`notNullBackfillCallStrategy`, `typeChangeCallStrategy`,
 *   `nullableTighteningCallStrategy`) consume their matching issues and emit
 *   `DataTransformCall` placeholders or recipe ops.
 *
 * - When `'data'` is not allowed (`db update` / `db init`), the
 *   placeholder-emitting strategies short-circuit to `no_match`, leaving
 *   the issue for the downstream strategies (`storageTypePlanCallStrategy`,
 *   `notNullAddColumnCallStrategy`) or the `mapNodeIssueToCall` default to
 *   handle with direct DDL.
 *
 * Codec-typed storage type entries are dispatched through
 * `storageTypePlanCallStrategy`.
 */
export const postgresPlannerStrategies: readonly CallMigrationStrategy[] = [
  notNullBackfillCallStrategy,
  typeChangeCallStrategy,
  nullableTighteningCallStrategy,
  storageTypePlanCallStrategy,
  notNullAddColumnCallStrategy,
];
