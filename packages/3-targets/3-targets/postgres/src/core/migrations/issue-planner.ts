/**
 * Postgres migration issue planner.
 *
 * Takes node-typed schema-diff issues (from the one differ — see
 * `buildPostgresPlanDiff` in `diff-database-schema.ts`) and emits migration
 * IR (`PostgresOpFactoryCall[]`). Strategies consume issues they recognize
 * and produce specialized call sequences (e.g. NOT NULL backfill →
 * addColumn(nullable) + dataTransform + setNotNull); remaining issues flow
 * through `mapNodeIssueToCall` for the default case.
 *
 * Structural op-render (column type/default DDL) resolves the column node's
 * `codecRef` against the codec hooks the caller holds (`column-ddl-
 * rendering.ts`) — never re-derived from the contract. The retained
 * subsystems (codec type-operations, the NOT-NULL temp-default deferred DDL,
 * control-policy disposition) still read the contract via the strategy
 * context, per the slice's scope.
 */

import type { Contract } from '@internal/contract/types';
import type {
  CodecControlHooks,
  MigrationOperationPolicy,
  SqlPlannerConflict,
  SqlPlannerConflictLocation,
} from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { DiffableNode, SchemaDiffIssue } from '@internal/framework-components/control';
import { issueOutcome, orderIssuesByDependencies } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage, StorageTypeInstance } from '@internal/sql-contract/types';
import type { DdlTableConstraint } from '@internal/sql-relational-core/ast';
import * as contractFree from '@internal/sql-relational-core/contract-free';
import {
  RelationalSchemaNodeKind,
  type SqlCheckConstraintIR,
  type SqlColumnDefaultIR,
  type SqlColumnIR,
  type SqlForeignKeyIR,
  type SqlIndexIR,
  SqlSchemaIR,
  type SqlSchemaIRNode,
  type SqlUniqueIR,
} from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { Result } from '@internal/utils/result';
import { notOk, ok } from '@internal/utils/result';
import type { PostgresNamespaceSchemaNode } from '../schema-ir/postgres-namespace-schema-node';
import type { PostgresNativeEnumSchemaNode } from '../schema-ir/postgres-native-enum-schema-node';
import type { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import { PostgresSchemaNodeKind } from '../schema-ir/schema-node-kinds';
import {
  renderColumnAlterType,
  renderColumnDdl,
  renderColumnDefaultSql,
} from './column-ddl-rendering';
import { resolveNamespaceIdForDdlSchema } from './control-policy';
import {
  AddCheckConstraintCall,
  AddColumnCall,
  AddForeignKeyCall,
  AddNativeEnumValueCall,
  AddPrimaryKeyCall,
  AddUniqueCall,
  AlterColumnTypeCall,
  CreateIndexCall,
  CreateNativeEnumTypeCall,
  CreateSchemaCall,
  CreateTableCall,
  DisableRowLevelSecurityCall,
  DropCheckConstraintCall,
  DropColumnCall,
  DropConstraintCall,
  DropDefaultCall,
  DropIndexCall,
  DropNativeEnumTypeCall,
  DropNotNullCall,
  DropTableCall,
  EnableRowLevelSecurityCall,
  type PostgresOpFactoryCall,
  SetDefaultCall,
  SetNotNullCall,
} from './op-factory-call';
import type { ForeignKeySpec } from './operations/shared';
import {
  type CallMigrationStrategy,
  postgresPlannerStrategies,
  type StrategyContext,
} from './planner-strategies';

export type { CallMigrationStrategy, StrategyContext };

// ============================================================================
// Conflict helpers
// ============================================================================

function issueConflict(
  kind: SqlPlannerConflict['kind'],
  summary: string,
  location?: SqlPlannerConflict['location'],
): SqlPlannerConflict {
  return {
    kind,
    summary,
    why: 'Use `migration new` to author a custom migration for this change.',
    ...(location ? { location } : {}),
  };
}

export interface IssuePlannerValue {
  readonly calls: readonly PostgresOpFactoryCall[];
}

/**
 * Classifies calls into dependency order categories for correct DDL sequencing.
 */
type CallCategory =
  | 'dep'
  | 'drop'
  | 'dropType'
  | 'table'
  | 'rlsEnable'
  | 'rlsPolicy'
  | 'column'
  | 'alter'
  | 'primaryKey'
  | 'unique'
  | 'index'
  | 'foreignKey';

/**
 * Classifies calls into DDL sequencing buckets. The order matches the
 * legacy walk-schema planner's emission order so `db init` and `db update`
 * produce byte-identical plans for the shared shape (deps → drops → tables
 * → columns → alters → PKs → uniques → indexes → FKs).
 *
 * `dropType` (DROP TYPE for a managed native enum) is its own bucket, ordered
 * after the general drop bucket: a type can only be dropped once every table
 * whose column uses it is gone. A column→enum edge would make this precise,
 * but `coalesceSubtreeIssues` removes the column issue under a whole-table
 * drop, so the edge never reaches the graph; the coarse bucket stands in until
 * that edge lands (the coordinate work is a later slice).
 */
function classifyCall(call: PostgresOpFactoryCall): CallCategory {
  switch (call.factoryName) {
    case 'createExtension':
    case 'createSchema':
    case 'createNativeEnumType':
    case 'addNativeEnumValue':
      return 'dep';
    case 'dropNativeEnumType':
      return 'dropType';
    case 'dropTable':
    case 'dropColumn':
    case 'dropConstraint':
    case 'dropCheckConstraint':
    case 'dropIndex':
    case 'dropDefault':
      return 'drop';
    case 'addCheckConstraint':
    case 'renameCheckConstraint':
      return 'unique'; // after uniques, before indexes
    case 'createTable':
      return 'table';
    case 'enableRowLevelSecurity':
    case 'disableRowLevelSecurity':
      return 'rlsEnable';
    case 'createRlsPolicy':
      return 'rlsPolicy';
    case 'dropRlsPolicy':
      return 'drop';
    case 'addColumn':
      return 'column';
    case 'alterColumnType':
    case 'setNotNull':
    case 'dropNotNull':
    case 'setDefault':
      return 'alter';
    case 'addPrimaryKey':
      return 'primaryKey';
    case 'addUnique':
      return 'unique';
    case 'createIndex':
    case 'renameIndex':
      return 'index';
    case 'addForeignKey':
      return 'foreignKey';
    case 'rawSql': {
      // Type ops lifted through `RawSqlCall` by `storageTypePlanCallStrategy`
      // to preserve the codec-emitted label and precheck/postcheck.
      // Classification falls back to inspecting the underlying op's target
      // details (`objectType: 'type'`).
      const op = (
        call as {
          op?: {
            target?: { details?: { objectType?: string } };
          };
        }
      ).op;
      const objectType = op?.target?.details?.objectType;
      if (objectType === 'type') return 'dep';
      return 'alter';
    }
    default:
      return 'alter';
  }
}

// When no policy is explicitly supplied (test-only path; production callers
// always pass one), allow every class so strategies that gate on
// `'data'` (data-safe placeholders) still fire — the test is treated as
// trusted. Filtering of actual emitted calls only runs when a policy was
// explicitly provided (see `policyProvided` below).
const DEFAULT_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

function emptySchemaIR(): SqlSchemaIR {
  return new SqlSchemaIR({ tables: {} });
}

function conflictKindForCall(call: PostgresOpFactoryCall): SqlPlannerConflict['kind'] {
  switch (call.factoryName) {
    case 'alterColumnType':
      return 'typeMismatch';
    case 'setNotNull':
    case 'dropNotNull':
      return 'nullabilityConflict';
    case 'addForeignKey':
    case 'dropConstraint':
      return 'foreignKeyConflict';
    case 'createIndex':
    case 'renameIndex':
    case 'dropIndex':
      return 'indexIncompatible';
    case 'createRlsPolicy':
    case 'dropRlsPolicy':
    case 'renameRlsPolicy':
      return 'rlsPolicyIncompatible';
    default:
      return 'missingButNonAdditive';
  }
}

function locationForCall(call: PostgresOpFactoryCall): SqlPlannerConflict['location'] | undefined {
  // Most Postgres call classes expose `tableName`/`columnName`/`indexName`/
  // `constraintName` as readonly fields. We avoid `toOp()` here because a
  // `DataTransformCall` intentionally throws from `toOp`.
  const anyCall = call as unknown as {
    tableName?: string;
    columnName?: string;
    indexName?: string;
    newIndexName?: string;
    constraintName?: string;
    newConstraintName?: string;
    typeName?: string;
    policyName?: string;
    newPolicyName?: string;
    policy?: { readonly name?: string };
  };
  const location: {
    entityKind?: string;
    entityName?: string;
    column?: string;
    index?: string;
    constraint?: string;
    rlsPolicy?: string;
  } = {};
  if (anyCall.tableName) {
    location.entityKind = 'table';
    location.entityName = anyCall.tableName;
  } else if (anyCall.typeName) {
    location.entityKind = 'native_enum';
    location.entityName = anyCall.typeName;
  }
  if (anyCall.columnName) location.column = anyCall.columnName;
  // A rename call carries old/new index names; the new name is the index's
  // contract-side identity, so it is the conflict location.
  if (anyCall.indexName) location.index = anyCall.indexName;
  else if (anyCall.newIndexName) location.index = anyCall.newIndexName;
  // Same convention as indexes and policies: a rename call's NEW name is the
  // constraint's contract-side identity.
  if (anyCall.constraintName) location.constraint = anyCall.constraintName;
  else if (anyCall.newConstraintName) location.constraint = anyCall.newConstraintName;
  // Same convention as indexes: a rename call's NEW name is the policy's
  // contract-side identity.
  if (anyCall.policyName) location.rlsPolicy = anyCall.policyName;
  else if (anyCall.policy?.name) location.rlsPolicy = anyCall.policy.name;
  else if (anyCall.newPolicyName) location.rlsPolicy = anyCall.newPolicyName;
  return Object.keys(location).length > 0 ? (location as SqlPlannerConflictLocation) : undefined;
}

export function conflictForDisallowedCall(
  call: PostgresOpFactoryCall,
  allowed: readonly string[],
): SqlPlannerConflict {
  const summary = `Operation "${call.label}" requires class "${call.operationClass}", but policy allows only: ${allowed.join(', ')}`;
  const location = locationForCall(call);
  return {
    kind: conflictKindForCall(call),
    summary,
    why: 'Use `migration new` to author a custom migration for this change.',
    ...(location ? { location } : {}),
  };
}

// ============================================================================
// Node-based issue planner
// ============================================================================
//
// Consumes node-typed `SchemaDiffIssue`s (from the one differ —
// `buildPostgresPlanDiff`) and reads the diff node each issue carries
// (`issue.expected` / `issue.actual`). Column DDL (type/default SQL) resolves
// from the column node's `codecRef` against the codec hooks the caller holds
// (`column-ddl-rendering.ts`), never the contract. The retained subsystems —
// codec type-operations, field-lifecycle hooks, the NOT-NULL temp-default
// deferred DDL, control-policy disposition — keep the contract via the
// strategy context, per the slice's scope.

/** The diff node an issue concerns — expected when present, else the actual (extra) node. */
export function issueNode(issue: SchemaDiffIssue): SqlSchemaIRNode | undefined {
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return undefined;
  return blindCast<
    SqlSchemaIRNode,
    'every node in a Postgres schema diff tree is a SqlSchemaIRNode; nodeKind is its required discriminant'
  >(node);
}

/** DDL schema segment of a table-or-descendant issue path: `[database, ddlSchema, table, …]`. */
export function issueSchemaName(issue: SchemaDiffIssue): string | undefined {
  return issue.path[1];
}

/** Table segment of a table-or-descendant issue path: `[database, ddlSchema, table, …]`. */
export function issueTableName(issue: SchemaDiffIssue): string | undefined {
  return issue.path[2];
}

/** Column name embedded in a column/default issue path segment (`column:<name>`). */
export function issueColumnName(issue: SchemaDiffIssue): string | undefined {
  const segment = issue.path[3];
  if (segment === undefined || !segment.startsWith('column:')) return undefined;
  return segment.slice('column:'.length);
}

/**
 * The DDL schema name to use when EMITTING an op against `ddlSchemaName` (the
 * diff tree's resolved physical schema, `issueSchemaName(issue)`). The
 * unbound namespace's diff-tree identity resolves to `public` (a concrete
 * physical default the differ needs in order to compare its tree against
 * introspection — `resolveDdlSchemaForNamespaceStorage`), but DDL EMISSION
 * must stay unqualified so the live connection's `search_path` resolves it
 * at runtime (`boundSchema`). Recovers the logical namespace id via the
 * contract and substitutes the unbound sentinel back in when it resolves
 * there; every other namespace's `ddlSchemaName` already agrees between the
 * two resolution paths, so it passes through unchanged.
 */
export function emissionSchemaName(ctx: StrategyContext, ddlSchemaName: string): string {
  const namespaceId = resolveNamespaceIdForDdlSchema(ctx.toContract, ddlSchemaName);
  return namespaceId === UNBOUND_NAMESPACE_ID ? UNBOUND_NAMESPACE_ID : ddlSchemaName;
}

/** Whether the expected/actual native type (resolved, or raw+many fallback) differs — mirrors `SqlColumnIR.isEqualTo`'s type comparison. */
export function columnTypeChanged(expected: SqlColumnIR, actual: SqlColumnIR): boolean {
  if (expected.resolvedNativeType !== undefined && actual.resolvedNativeType !== undefined) {
    return expected.resolvedNativeType !== actual.resolvedNativeType;
  }
  return (
    expected.nativeType !== actual.nativeType || Boolean(expected.many) !== Boolean(actual.many)
  );
}

// ----------------------------------------------------------------------------
// Subtree coalescing (the planner's responsibility per the differ's contract)
// ----------------------------------------------------------------------------

/**
 * The generic differ is total: a missing/extra table (or column) emits an
 * issue for itself AND for every node in its subtree. `CreateTable`/`DropTable`
 * and `AddColumn`/`DropColumn` already account for the whole subtree, so the
 * nested issues are redundant — coalescing drops any issue whose path is a
 * strict descendant of a `not-found`/`not-expected` issue's path. Run over the
 * relational subset ONLY (policy issues and synthesized namespace issues are
 * handled on their own paths, never coalesced against tables).
 */
export function coalesceSubtreeIssues<TNode extends DiffableNode = DiffableNode>(
  issues: readonly SchemaDiffIssue<TNode>[],
): readonly SchemaDiffIssue<TNode>[] {
  const collapsingPaths = issues
    .filter((issue) => issueOutcome(issue) !== 'not-equal')
    .map((issue) => issue.path);
  if (collapsingPaths.length === 0) return issues;
  return issues.filter(
    (issue) => !collapsingPaths.some((ancestor) => isStrictDescendantPath(issue.path, ancestor)),
  );
}

function isStrictDescendantPath(path: readonly string[], ancestor: readonly string[]): boolean {
  if (path.length <= ancestor.length) return false;
  for (let i = 0; i < ancestor.length; i += 1) {
    if (path[i] !== ancestor[i]) return false;
  }
  return true;
}

// ----------------------------------------------------------------------------
// Node → call construction
// ----------------------------------------------------------------------------

function fkSpecFromNode(fk: SqlForeignKeyIR, tableName: string): ForeignKeySpec {
  const name = fk.name ?? `${tableName}_${fk.columns.join('_')}_fkey`;
  return {
    name,
    columns: [...fk.columns],
    references: {
      // The raw target namespace coordinate, matching the retired coordinate
      // path's `references.schema: fk.target.namespaceId` (the FK node stamps
      // it verbatim). The op renderer qualifies the REFERENCES clause from it.
      schema: fk.referencedSchema ?? '',
      table: fk.referencedTable,
      columns: [...fk.referencedColumns],
    },
    ...ifDefined('onDelete', fk.onDelete),
    ...ifDefined('onUpdate', fk.onUpdate),
  };
}

/**
 * Builds the `CreateTable` + child `CreateIndex` / `AddForeignKey` / `AddUnique`
 * calls for a newly-expected table, reading only the table node's children. The
 * PK and every declared CHECK go inline as table constraints; indexes
 * (declared + FK-backing, already merged and ordered at derivation) and the
 * FK / unique constraints are separate calls (re-bucketed downstream). Every
 * column's DDL is resolved from its `codecRef` via `renderColumnDdl`.
 */
function buildCreateTableCallsFromNode(
  schemaName: string,
  ddlSchemaName: string,
  table: PostgresTableSchemaNode,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
): PostgresOpFactoryCall[] {
  const ddlColumns = Object.values(table.columns).map((c) =>
    renderColumnDdl(c.name, c, codecHooks),
  );
  const primaryKeyConstraints: DdlTableConstraint[] = table.primaryKey
    ? [
        contractFree.primaryKey([...table.primaryKey.columns], {
          ...ifDefined('name', table.primaryKey.name),
        }),
      ]
    : [];
  const declaredChecks: DdlTableConstraint[] = (table.checks ?? []).map((c) =>
    contractFree.checkExpression(c.name, c.expression),
  );
  const allTableConstraints = [...primaryKeyConstraints, ...declaredChecks];
  const calls: PostgresOpFactoryCall[] = [
    new CreateTableCall(
      schemaName,
      table.name,
      ddlColumns,
      allTableConstraints.length > 0 ? allTableConstraints : undefined,
    ),
  ];
  for (const index of table.indexes) {
    calls.push(createIndexCallFromNode(index, schemaName, table.name));
  }
  for (const fk of table.foreignKeys) {
    calls.push(new AddForeignKeyCall(schemaName, table.name, fkSpecFromNode(fk, table.name)));
  }
  for (const unique of table.uniques) {
    const constraintName = unique.name ?? `${table.name}_${unique.columns.join('_')}_key`;
    calls.push(new AddUniqueCall(schemaName, table.name, constraintName, [...unique.columns]));
  }
  // Marker-driven: a newly-created table that is RLS-controlled enables RLS
  // as part of its creation bundle. The policy set never decides this. The
  // resolved schema (not the emission sentinel) binds into the op's
  // relrowsecurity checks.
  if (table.rlsEnabled) {
    calls.push(new EnableRowLevelSecurityCall(ddlSchemaName, table.name));
  }
  return calls;
}

function nodeConflict(kind: SqlPlannerConflict['kind'], message: string): SqlPlannerConflict {
  return issueConflict(kind, message);
}

/**
 * True when `actualMembers` (the live database's ordered members) is a
 * strict, order-preserving prefix of `expectedMembers` (the contract's) —
 * the database already carries every contract member, in declaration
 * order, and the contract declares at least one member the database still
 * lacks. Any other relationship — a renamed value, a removed value, a
 * reordering, or the database holding members the contract lacks — is not
 * a suffix append.
 */
function isNativeEnumSuffixAppend(
  actualMembers: readonly string[],
  expectedMembers: readonly string[],
): boolean {
  if (actualMembers.length >= expectedMembers.length) return false;
  return actualMembers.every((member, index) => member === expectedMembers[index]);
}

/** Operator-worded refusal for a native-enum member change beyond a suffix append (design ruling — tests match this verbatim). */
function nativeEnumMemberChangeRefusal(options: {
  readonly ddlSchemaName: string;
  readonly typeName: string;
  readonly expectedMembers: readonly string[];
  readonly actualMembers: readonly string[];
}): string {
  return (
    `Native enum type "${options.ddlSchemaName}"."${options.typeName}" changed beyond appending new values ` +
    `(contract declares [${options.expectedMembers.join(', ')}], database has [${options.actualMembers.join(', ')}]). ` +
    "Prisma 8 does not modify a native enum's existing values (rename, removal, reorder) — " +
    'see https://pris.ly/d/postgres-native-enums. Author the change manually with `migration new`.'
  );
}

/**
 * Managed native-enum issue -> op lowering. A missing declared type creates
 * it; an unclaimed live type drops it (ownership-scoped upstream by
 * `retainUnownedExtras`, destructiveness gated by the operation-class
 * policy); a paired member-value mismatch lowers to one `ALTER TYPE ... ADD
 * VALUE` per appended member when the database's members are a strict,
 * order-preserving prefix of the contract's — any other change (rename,
 * removal, reorder, or the database holding members the contract lacks) is
 * refused with a NAMED diagnostic, never a silent no-op and never a
 * drop-and-recreate.
 */
function mapNativeEnumNodeIssue(
  issue: SchemaDiffIssue,
  ctx: StrategyContext,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  const ddlSchemaName = issueSchemaName(issue);
  if (ddlSchemaName === undefined) {
    return notOk(
      nodeConflict(
        'unsupportedOperation',
        `Enum issue has no schema in its path: ${issue.path.join('/')}`,
      ),
    );
  }
  const schemaName = emissionSchemaName(ctx, ddlSchemaName);
  if (issueOutcome(issue) === 'not-found') {
    const expected = blindCast<
      PostgresNativeEnumSchemaNode,
      'a not-found native-enum issue always carries the expected PostgresNativeEnumSchemaNode'
    >(issue.expected);
    return ok([new CreateNativeEnumTypeCall(schemaName, expected.typeName, expected.members)]);
  }
  if (issueOutcome(issue) === 'not-expected') {
    const actual = blindCast<
      PostgresNativeEnumSchemaNode,
      'a not-expected native-enum issue always carries the actual PostgresNativeEnumSchemaNode'
    >(issue.actual);
    return ok([new DropNativeEnumTypeCall(schemaName, actual.typeName)]);
  }
  const expected = blindCast<
    PostgresNativeEnumSchemaNode,
    'a not-equal native-enum issue carries both sides; the expected node names the type'
  >(issue.expected);
  const actual = blindCast<
    PostgresNativeEnumSchemaNode,
    'a not-equal native-enum issue carries both sides'
  >(issue.actual);
  if (isNativeEnumSuffixAppend(actual.members, expected.members)) {
    const appendedValues = expected.members.slice(actual.members.length);
    return ok(
      appendedValues.map(
        (value) => new AddNativeEnumValueCall(schemaName, expected.typeName, value),
      ),
    );
  }
  return notOk(
    nodeConflict(
      'unsupportedOperation',
      nativeEnumMemberChangeRefusal({
        ddlSchemaName,
        typeName: expected.typeName,
        expectedMembers: expected.members,
        actualMembers: actual.members,
      }),
    ),
  );
}

function mapTableNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
  // The diff tree's RESOLVED physical schema. Enablement ops bind it into
  // their `pg_class`/`pg_namespace` checks (the emission sentinel would
  // never match a live nspname), mirroring the schema the retired
  // policy-half enable resolved via `resolveDdlSchemaForNamespaceStorage`.
  ddlSchemaName: string,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  if (issueOutcome(issue) === 'not-found') {
    const table = blindCast<
      PostgresTableSchemaNode,
      'a not-found table issue always carries the expected PostgresTableSchemaNode'
    >(issue.expected);
    return ok(buildCreateTableCallsFromNode(schemaName, ddlSchemaName, table, codecHooks));
  }
  if (issueOutcome(issue) === 'not-expected') {
    const table = blindCast<
      PostgresTableSchemaNode,
      'a not-expected table issue always carries the actual PostgresTableSchemaNode'
    >(issue.actual);
    return ok([new DropTableCall(schemaName, table.name)]);
  }
  // A paired table `not-equal` means enablement drift TODAY, because
  // `isEqualTo` compares only name + `rlsEnabled`. Key on the actual
  // expected-vs-actual `rlsEnabled` delta rather than assuming it: emit ENABLE
  // when it flipped on, DISABLE when it flipped off, and fail loud when
  // `rlsEnabled` matches on both sides — that means a second table attribute
  // drifted into `isEqualTo` and this mapper does not yet handle it. The
  // expected side is authoritative (marker-driven, never the policy set).
  const expected = blindCast<
    PostgresTableSchemaNode,
    'a not-equal table issue always carries the expected PostgresTableSchemaNode'
  >(issue.expected);
  const actual = blindCast<
    PostgresTableSchemaNode,
    'a not-equal table issue always carries the actual PostgresTableSchemaNode'
  >(issue.actual);
  if (expected.rlsEnabled && !actual.rlsEnabled) {
    return ok([new EnableRowLevelSecurityCall(ddlSchemaName, expected.name)]);
  }
  if (!expected.rlsEnabled && actual.rlsEnabled) {
    return ok([new DisableRowLevelSecurityCall(ddlSchemaName, expected.name)]);
  }
  return notOk(
    nodeConflict(
      'unsupportedOperation',
      `unhandled table-attribute drift on "${expected.name}": table not-equal with no rlsEnabled delta (a second table attribute drifted)`,
    ),
  );
}

function mapColumnNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
  tableName: string,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  if (issueOutcome(issue) === 'not-found') {
    const column = blindCast<
      SqlColumnIR,
      'a not-found column issue always carries the expected column node'
    >(issue.expected);
    return ok([
      new AddColumnCall(schemaName, tableName, renderColumnDdl(column.name, column, codecHooks)),
    ]);
  }
  if (issueOutcome(issue) === 'not-expected') {
    const column = blindCast<
      SqlColumnIR,
      'a not-expected column issue always carries the actual column node'
    >(issue.actual);
    return ok([new DropColumnCall(schemaName, tableName, column.name)]);
  }
  // not-equal: Postgres alters in place — type drift and/or nullability drift.
  const expected = blindCast<
    SqlColumnIR,
    'a not-equal column issue always carries the expected column node'
  >(issue.expected);
  const actual = blindCast<
    SqlColumnIR,
    'a not-equal column issue always carries the actual column node'
  >(issue.actual);
  const calls: PostgresOpFactoryCall[] = [];
  if (columnTypeChanged(expected, actual)) {
    const { qualifiedTargetType, formatTypeExpected } = renderColumnAlterType(expected, codecHooks);
    calls.push(
      new AlterColumnTypeCall(schemaName, tableName, expected.name, {
        qualifiedTargetType,
        formatTypeExpected,
        rawTargetTypeForLabel: qualifiedTargetType,
      }),
    );
  }
  if (expected.nullable !== actual.nullable) {
    calls.push(
      expected.nullable
        ? new DropNotNullCall(schemaName, tableName, expected.name)
        : new SetNotNullCall(schemaName, tableName, expected.name),
    );
  }
  return ok(calls);
}

function mapColumnDefaultNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
  tableName: string,
  columnName: string,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  if (issueOutcome(issue) === 'not-expected') {
    return ok([new DropDefaultCall(schemaName, tableName, columnName)]);
  }
  // not-found (SET DEFAULT, additive) or not-equal (SET DEFAULT, widening).
  if (issue.expected === undefined) return ok([]);
  const defaultNode = blindCast<
    SqlColumnDefaultIR,
    'a not-found/not-equal column-default issue always carries the expected default node'
  >(issue.expected);
  const defaultSql = renderColumnDefaultSql(defaultNode, codecHooks);
  if (!defaultSql) return ok([]);
  return ok([
    new SetDefaultCall(
      schemaName,
      tableName,
      columnName,
      defaultSql,
      issueOutcome(issue) === 'not-equal' ? 'widening' : 'additive',
    ),
  ]);
}

function mapPrimaryKeyNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
  tableName: string,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  if (issueOutcome(issue) === 'not-found') {
    const pk = blindCast<
      { readonly columns: readonly string[]; readonly name?: string },
      'a not-found primary-key issue always carries the expected PrimaryKey node'
    >(issue.expected);
    const constraintName = pk.name ?? `${tableName}_pkey`;
    return ok([new AddPrimaryKeyCall(schemaName, tableName, constraintName, [...pk.columns])]);
  }
  if (issueOutcome(issue) === 'not-expected') {
    const pk = blindCast<
      { readonly name?: string },
      'a not-expected primary-key issue always carries the actual PrimaryKey node'
    >(issue.actual);
    return ok([
      new DropConstraintCall(schemaName, tableName, pk.name ?? `${tableName}_pkey`, 'primaryKey'),
    ]);
  }
  return notOk(nodeConflict('indexIncompatible', issue.path.join('/')));
}

function mapForeignKeyNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
  tableName: string,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  if (issueOutcome(issue) === 'not-found') {
    const fk = blindCast<
      SqlForeignKeyIR,
      'a not-found foreign-key issue always carries the expected foreign-key node'
    >(issue.expected);
    return ok([new AddForeignKeyCall(schemaName, tableName, fkSpecFromNode(fk, tableName))]);
  }
  if (issueOutcome(issue) === 'not-expected') {
    const fk = blindCast<
      SqlForeignKeyIR,
      'a not-expected foreign-key issue always carries the actual foreign-key node'
    >(issue.actual);
    const name = fk.name ?? `${tableName}_${fk.columns.join('_')}_fkey`;
    return ok([new DropConstraintCall(schemaName, tableName, name, 'foreignKey')]);
  }
  return notOk(nodeConflict('foreignKeyConflict', issue.path.join('/')));
}

function mapUniqueNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
  tableName: string,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  if (issueOutcome(issue) === 'not-found') {
    const unique = blindCast<
      SqlUniqueIR,
      'a not-found unique issue always carries the expected unique node'
    >(issue.expected);
    const name = unique.name ?? `${tableName}_${unique.columns.join('_')}_key`;
    return ok([new AddUniqueCall(schemaName, tableName, name, [...unique.columns])]);
  }
  if (issueOutcome(issue) === 'not-expected') {
    const unique = blindCast<
      SqlUniqueIR,
      'a not-expected unique issue always carries the actual unique node'
    >(issue.actual);
    const name = unique.name ?? `${tableName}_${unique.columns.join('_')}_key`;
    return ok([new DropConstraintCall(schemaName, tableName, name, 'unique')]);
  }
  return notOk(nodeConflict('indexIncompatible', issue.path.join('/')));
}

/**
 * The CreateIndexCall for a name-identified index node: the node's own name
 * verbatim, its element list (column tuple or opaque expression), and the
 * unique/type/options/where attributes carried through.
 */
export function createIndexCallFromNode(
  index: SqlIndexIR,
  schemaName: string,
  tableName: string,
): CreateIndexCall {
  const extras: {
    type?: string;
    options?: Record<string, unknown>;
    where?: string;
    unique?: boolean;
  } = {};
  if (index.type !== undefined) extras.type = index.type;
  if (index.options !== undefined) extras.options = index.options;
  if (index.where !== undefined) extras.where = index.where;
  if (index.unique) extras.unique = true;
  return new CreateIndexCall(
    schemaName,
    tableName,
    index.name,
    index.columns !== undefined
      ? { columns: [...index.columns] }
      : { expression: index.expression ?? '' },
    extras,
  );
}

function mapIndexNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
  tableName: string,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  if (issueOutcome(issue) === 'not-found') {
    const index = blindCast<
      SqlIndexIR,
      'a not-found index issue always carries the expected index node'
    >(issue.expected);
    return ok([createIndexCallFromNode(index, schemaName, tableName)]);
  }
  if (issueOutcome(issue) === 'not-expected') {
    const index = blindCast<
      SqlIndexIR,
      'a not-expected index issue always carries the actual index node'
    >(issue.actual);
    return ok([new DropIndexCall(schemaName, tableName, index.name)]);
  }
  return notOk(nodeConflict('indexIncompatible', issue.path.join('/')));
}

/**
 * The index treatment: a missing check is added, an undeclared live check is
 * dropped, and a paired divergence is a conflict. `not-equal` is reachable only
 * for an exact-named expected check — a wire-named one compares by name, so a
 * changed predicate re-suffixes the name and arrives as missing + extra
 * instead.
 */
function mapCheckNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
  tableName: string,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  if (issueOutcome(issue) === 'not-found') {
    const check = blindCast<
      SqlCheckConstraintIR,
      'a not-found check issue always carries the expected check node'
    >(issue.expected);
    return ok([new AddCheckConstraintCall(schemaName, tableName, check.name, check.expression)]);
  }
  if (issueOutcome(issue) === 'not-expected') {
    const check = blindCast<
      SqlCheckConstraintIR,
      'a not-expected check issue always carries the actual check node'
    >(issue.actual);
    return ok([new DropCheckConstraintCall(schemaName, tableName, check.name)]);
  }
  return notOk(nodeConflict('unsupportedOperation', issue.path.join('/')));
}

/**
 * Maps one node-typed diff issue to its migration call(s), dispatching on the
 * node's `nodeKind` and the issue's presence-derived `issueOutcome`, reading
 * nodes and resolving column DDL from `codecRef` via `column-ddl-rendering.ts`.
 */
export function mapNodeIssueToCall(
  issue: SchemaDiffIssue,
  ctx: StrategyContext,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  const node = issueNode(issue);
  if (node === undefined) {
    return notOk(
      nodeConflict(
        'unsupportedOperation',
        `Issue carries neither an expected nor an actual node: ${issue.path.join('/')}`,
      ),
    );
  }
  if (node.nodeKind === PostgresSchemaNodeKind.namespace) {
    if (issueOutcome(issue) !== 'not-found') {
      return notOk(
        nodeConflict('unsupportedOperation', `Unexpected namespace drift: ${issue.path.join('/')}`),
      );
    }
    const namespace = blindCast<
      PostgresNamespaceSchemaNode,
      'a namespace-presence issue always carries a PostgresNamespaceSchemaNode'
    >(issue.expected);
    return ok([new CreateSchemaCall(namespace.schemaName)]);
  }

  if (node.nodeKind === PostgresSchemaNodeKind.nativeEnum) {
    return mapNativeEnumNodeIssue(issue, ctx);
  }

  const ddlSchemaName = issueSchemaName(issue);
  const tableName = issueTableName(issue);
  if (ddlSchemaName === undefined || tableName === undefined) {
    return notOk(
      nodeConflict(
        'unsupportedOperation',
        `Issue has no schema/table in its path: ${issue.path.join('/')}`,
      ),
    );
  }
  const schemaName = emissionSchemaName(ctx, ddlSchemaName);

  switch (node.nodeKind) {
    case PostgresSchemaNodeKind.table:
      return mapTableNodeIssue(issue, schemaName, ddlSchemaName, ctx.codecHooks);
    case RelationalSchemaNodeKind.column:
      return mapColumnNodeIssue(issue, schemaName, tableName, ctx.codecHooks);
    case RelationalSchemaNodeKind.columnDefault: {
      const columnName = issueColumnName(issue);
      if (columnName === undefined) {
        return notOk(
          nodeConflict(
            'unsupportedOperation',
            `Default issue has no column in its path: ${issue.path.join('/')}`,
          ),
        );
      }
      return mapColumnDefaultNodeIssue(issue, schemaName, tableName, columnName, ctx.codecHooks);
    }
    case RelationalSchemaNodeKind.primaryKey:
      return mapPrimaryKeyNodeIssue(issue, schemaName, tableName);
    case RelationalSchemaNodeKind.foreignKey:
      return mapForeignKeyNodeIssue(issue, schemaName, tableName);
    case RelationalSchemaNodeKind.unique:
      return mapUniqueNodeIssue(issue, schemaName, tableName);
    case RelationalSchemaNodeKind.index:
      return mapIndexNodeIssue(issue, schemaName, tableName);
    case RelationalSchemaNodeKind.check:
      return mapCheckNodeIssue(issue, schemaName, tableName);
    default:
      return notOk(nodeConflict('unsupportedOperation', `Unhandled node kind: ${node.nodeKind}`));
  }
}

export interface IssuePlannerOptions {
  readonly issues: readonly SchemaDiffIssue[];
  readonly toContract: Contract<SqlStorage>;
  readonly fromContract: Contract<SqlStorage> | null;
  readonly schemaName: string;
  readonly codecHooks: ReadonlyMap<string, CodecControlHooks>;
  readonly storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  /**
   * Current database schema IR. Strategies read this to detect whether a
   * structure already exists (e.g. `buildSchemaLookupMap` for shared-temp-
   * default safety, extension dependency checks). Defaults to an empty schema
   * when omitted so the planner can still run over "fresh DB" contract
   * snapshots.
   */
  readonly schema?: SqlSchemaIR;
  /**
   * Operation-class policy. `planIssues` filters calls whose `operationClass`
   * is not in `policy.allowedOperationClasses` and surfaces them as conflicts
   * instead of emitting disallowed DDL. Defaults to additive-only.
   */
  readonly policy?: MigrationOperationPolicy;
  /**
   * Framework components participating in this composition. Available to
   * future strategies that may consult component metadata at plan time.
   */
  readonly frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  readonly strategies?: readonly CallMigrationStrategy[];
}

/**
 * Runs the ordered strategy list over the node-typed diff issues, maps
 * leftover issues via {@link mapNodeIssueToCall}, applies operation-class
 * policy gating, and buckets calls into the fixed DDL emission order (dep →
 * drop → table → column → recipe → alter → primaryKey → unique → index →
 * foreignKey).
 */
export function planIssues(
  options: IssuePlannerOptions,
): Result<IssuePlannerValue, readonly SqlPlannerConflict[]> {
  const policyProvided = options.policy !== undefined;
  const policy = options.policy ?? DEFAULT_POLICY;
  const schema = options.schema ?? emptySchemaIR();
  const frameworkComponents = options.frameworkComponents ?? [];

  const context: StrategyContext = {
    toContract: options.toContract,
    fromContract: options.fromContract,
    schemaName: options.schemaName,
    codecHooks: options.codecHooks,
    storageTypes: options.storageTypes,
    schema,
    policy,
    frameworkComponents,
  };

  const strategies = options.strategies ?? postgresPlannerStrategies;

  let remaining = options.issues;
  const recipeCalls: PostgresOpFactoryCall[] = [];
  const bucketablePatternCalls: PostgresOpFactoryCall[] = [];

  for (const strategy of strategies) {
    const result = strategy(remaining, context);
    if (result.kind === 'match') {
      remaining = result.issues;
      if (result.recipe) {
        recipeCalls.push(...result.calls);
      } else {
        bucketablePatternCalls.push(...result.calls);
      }
    }
  }

  // Dependency-graph order: a topological sort over the issues' `dependsOn`
  // cross-links and containment edges (the ordering law drives edge direction
  // by presence), path-tiebroken for determinism. `classifyCall` bucketing
  // downstream fixes the coarse cross-entity DDL sequence; this settles the
  // order within each bucket (notably the teardown order among drops).
  const sorted = orderIssuesByDependencies(remaining);

  const defaultCalls: PostgresOpFactoryCall[] = [];
  const conflicts: SqlPlannerConflict[] = [];

  for (const issue of sorted) {
    const result = mapNodeIssueToCall(issue, context);
    if (result.ok) {
      defaultCalls.push(...result.value);
    } else {
      conflicts.push(result.failure);
    }
  }

  const allowed = policy.allowedOperationClasses;
  let gatedDefault = defaultCalls;
  let gatedRecipe = recipeCalls;
  let gatedBucketable = bucketablePatternCalls;
  if (policyProvided) {
    const keepIfAllowed = (bucket: PostgresOpFactoryCall[]) => (call: PostgresOpFactoryCall) => {
      if (allowed.includes(call.operationClass)) {
        bucket.push(call);
        return;
      }
      conflicts.push(conflictForDisallowedCall(call, allowed));
    };
    const gatedDefaultBucket: PostgresOpFactoryCall[] = [];
    const gatedRecipeBucket: PostgresOpFactoryCall[] = [];
    const gatedBucketableBucket: PostgresOpFactoryCall[] = [];
    defaultCalls.forEach(keepIfAllowed(gatedDefaultBucket));
    recipeCalls.forEach(keepIfAllowed(gatedRecipeBucket));
    bucketablePatternCalls.forEach(keepIfAllowed(gatedBucketableBucket));
    gatedDefault = gatedDefaultBucket;
    gatedRecipe = gatedRecipeBucket;
    gatedBucketable = gatedBucketableBucket;
  }

  if (conflicts.length > 0) {
    return notOk(conflicts);
  }

  const combinedBucketable = [...gatedDefault, ...gatedBucketable];
  const byCategory = (cat: CallCategory) =>
    combinedBucketable.filter((c) => classifyCall(c) === cat);

  const calls: PostgresOpFactoryCall[] = [
    ...byCategory('dep'),
    ...byCategory('drop'),
    // DROP TYPE after every table drop — a managed enum type can only go once
    // no live column still uses it.
    ...byCategory('dropType'),
    ...byCategory('table'),
    ...byCategory('column'),
    ...gatedRecipe,
    ...byCategory('alter'),
    ...byCategory('primaryKey'),
    ...byCategory('unique'),
    ...byCategory('index'),
    ...byCategory('foreignKey'),
    // Enablement changes run after all relational DDL (the table must exist)
    // and before the policy calls the planner appends after `planIssues` —
    // the same position the retired imperative enable-on-first-policy used.
    ...byCategory('rlsEnable'),
  ];

  return ok({ calls });
}
