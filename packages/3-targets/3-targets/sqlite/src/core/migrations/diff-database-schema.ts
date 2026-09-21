import type { ColumnDefault, Contract, ControlPolicy } from '@internal/contract/types';
import type { NativeTypeExpander, SqlSchemaDiffResult } from '@internal/family-sql/control';
import { buildNativeTypeExpander, contractToSchemaIR } from '@internal/family-sql/control';
import { verifySqlSchemaByDiff } from '@internal/family-sql/diff';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  SchemaDiffIssue,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { diffSchemas } from '@internal/framework-components/control';
import { entityAt } from '@internal/framework-components/ir';
import type { SqlStorage, StorageColumn, StorageTable } from '@internal/sql-contract/types';
import type {
  SqlColumnIRInput,
  SqlSchemaIRInput,
  SqlSchemaIRNode,
  SqlTableIRInput,
} from '@internal/sql-schema-ir/types';
import { relationalNodeGranularity, SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { sqliteResolveDefault } from '../default-normalizer';
import { renderDefaultLiteral } from './planner-ddl-builders';

interface SqliteDiffDatabaseSchemaInput {
  readonly contract: Contract<SqlStorage>;
  readonly actualSchema: SqlSchemaIRNode;
  readonly strict: boolean;
  readonly typeMetadataRegistry: ReadonlyMap<string, { readonly nativeType?: string }>;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

/** Renders a column default for the SQLite dialect. */
export function sqliteRenderDefault(def: ColumnDefault, _column: StorageColumn): string {
  if (def.kind === 'function') {
    if (def.expression === 'now()') {
      return "datetime('now')";
    }
    return def.expression;
  }
  return renderDefaultLiteral(def.value);
}

/**
 * The SQLite expected-side projection: contract → flat relational schema IR.
 *
 * `extras` thread the plan-time derivation input: the native-type expander,
 * so the expected side carries resolved native types (like the verify
 * side). Every expected column also carries its `codecRef` unconditionally
 * (Decision 5) — the planner's op-builders resolve DDL rendering from it at
 * plan time, so no separate render stamper is threaded here.
 */
export function sqliteContractToSchema(
  contract: Contract<SqlStorage> | null,
  extras?: {
    readonly expandNativeType?: NativeTypeExpander;
  },
): SqlSchemaIR {
  // SQLite is single-schema: every contract FK targets the unbound namespace
  // node, so derivation stamps no referenced namespace — the same absence
  // flat introspection produces — and the derived expected FK pairs with its
  // introspected counterpart by construction. No pre-diff pass, no flag.
  return contractToSchemaIR(contract, {
    annotationNamespace: 'sqlite',
    renderDefault: sqliteRenderDefault,
    resolveDefault: sqliteResolveDefault,
    ...ifDefined('expandNativeType', extras?.expandNativeType),
  });
}

/**
 * The SQLite schema verify: the full-tree node-diff verdict wrapped in the
 * issue-based result envelope. Used by the runner's post-apply check; the
 * family `verifySchema` runs the same composition via the descriptor hook.
 */
export function verifySqliteDatabaseSchema(
  input: SqliteDiffDatabaseSchemaInput,
): VerifyDatabaseSchemaResult {
  return verifySqlSchemaByDiff({
    contract: input.contract,
    schema: input.actualSchema,
    strict: input.strict,
    frameworkComponents: input.frameworkComponents,
    diffSchema: diffSqliteSchema,
    granularityOf: relationalNodeGranularity,
  });
}

/**
 * Resolves a verdict-diff issue's subject table's declared control policy
 * directly from the contract. SQLite's expected tree is flat, so the issue
 * path carries no namespace segment — `path[1]` is the table name (`path[0]`
 * is the tree root's own id); every contract namespace is searched for that
 * table name (table names are globally unique in the flat tree — duplicates
 * across namespaces are rejected earlier, at `contractToSchemaIR`).
 */
function resolveControlPolicy(
  issue: SchemaDiffIssue,
  contract: Contract<SqlStorage>,
): ControlPolicy | undefined {
  const tableName = issue.path[1];
  if (tableName === undefined) return undefined;
  for (const namespaceId of Object.keys(contract.storage.namespaces)) {
    const table = entityAt<StorageTable>(contract.storage, {
      namespaceId,
      entityKind: 'table',
      entityName: tableName,
    });
    if (table !== undefined) return table.control;
  }
  return undefined;
}

/**
 * The SQLite full-tree node diff for the family verify verdict: derive the
 * expected flat tree with resolved leaf values (expander threaded so
 * parameterized types compare expanded; FK nodes born with the flat empty
 * `resolvedReferencedNamespace`), and run the generic differ over the trees
 * as derived. Flat targets need no ownership scoping. The codec `verifyType`
 * hooks run once per contract namespace with tables, each against the sole
 * flat actual root — exactly the legacy per-namespace pairing.
 */
export function diffSqliteSchema(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIRNode;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): SqlSchemaDiffResult {
  const expandNativeType = buildNativeTypeExpander(input.frameworkComponents);
  const expected = sqliteContractToSchema(input.contract, {
    ...ifDefined('expandNativeType', expandNativeType),
  });
  const actual =
    input.schema instanceof SqlSchemaIR
      ? input.schema
      : blindCast<
          SqlSchemaIR,
          'the SQLite introspection adapter always produces a flat SqlSchemaIR root'
        >(input.schema);
  const issues = diffSchemas(expected, actual);
  const namespacesWithTables = Object.values(input.contract.storage.namespaces).filter(
    (ns) => Object.keys(ns.entries.table ?? {}).length > 0,
  );
  return {
    issues,
    resolveControlPolicy: (issue) => resolveControlPolicy(issue, input.contract),
    namespacePairs: namespacesWithTables.map(() => ({ actual })),
  };
}

export interface SqlitePlanDiff {
  /** The desired ("end") tree — resolved leaf values, incl. `codecRef`, on every column. */
  readonly expected: SqlSchemaIR;
  /** The live ("start") tree. */
  readonly actual: SqlSchemaIR;
  readonly issues: readonly SchemaDiffIssue[];
}

/**
 * The SQLite planner's diff input: the same tree-building
 * `diffSqliteSchema` uses (expander threaded, FK nodes born flat). One differ
 * drives both verify and plan over the trees as derived; this is the plan-side
 * derivation — column DDL resolves from each expected column's `codecRef` at
 * plan time (`column-ddl-rendering.ts`), so no separate render stamping happens here.
 */
export function buildSqlitePlanDiff(input: {
  readonly contract: Contract<SqlStorage>;
  readonly actualSchema: SqlSchemaIRNode;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): SqlitePlanDiff {
  const expandNativeType = buildNativeTypeExpander(input.frameworkComponents);
  const expected = sqliteContractToSchema(input.contract, {
    ...ifDefined('expandNativeType', expandNativeType),
  });
  // The differ dispatches polymorphically (`.isEqualTo()` / `.children()`), so
  // the actual tree must be genuine `SqlSchemaIR`/`SqlTableIR`/`SqlColumnIR`
  // instances, not plain data shaped like them. `new SqlSchemaIR(...)`
  // normalizes either input uniformly (an already-real tree passes through
  // untouched — its nested values are already instances) and is a no-op
  // rebuild in the common (real-instance) case, so this is always safe to run.
  const actual = new SqlSchemaIR(withRecordKeyNames(input.actualSchema));
  const issues = diffSchemas(expected, actual);
  return { expected, actual, issues };
}

/**
 * Every schema-tree builder in this codebase derives a table's / column's
 * `name` from the record key it's stored under (`contractToSchemaIR`,
 * the SQLite introspection adapter) rather than trusting a redundant
 * embedded field — the record key IS the identity. Mirrors that discipline
 * for the actual/live tree before construction, so `SqlTableIR.id` /
 * `SqlColumnIR.id` (both derived from `.name`) are always correct without
 * requiring every caller to duplicate the key onto the value. A no-op for a
 * tree that already carries matching names (the real introspection adapter
 * always does).
 */
function withRecordKeyNames(actualSchema: SqlSchemaIRNode): SqlSchemaIRInput {
  const raw = blindCast<
    { readonly tables?: Readonly<Record<string, unknown>> },
    'the SQLite introspection adapter always produces a flat, tables-keyed root'
  >(actualSchema);
  const tables: Record<string, SqlTableIRInput> = {};
  for (const [tableName, table] of Object.entries(raw.tables ?? {})) {
    const rawTable = blindCast<
      Omit<SqlTableIRInput, 'name' | 'columns'>,
      'every table value in a tables record is SqlTableIR(Input)-shaped'
    >(table);
    const columns: Record<string, SqlColumnIRInput> = {};
    for (const [columnName, column] of Object.entries(
      blindCast<
        { readonly columns?: Readonly<Record<string, unknown>> },
        'every SqlTableIR(Input) carries a columns record keyed by column name'
      >(table).columns ?? {},
    )) {
      columns[columnName] = {
        ...blindCast<
          SqlColumnIRInput,
          'every column value in a columns record is SqlColumnIR(Input)-shaped'
        >(column),
        name: columnName,
      };
    }
    tables[tableName] = {
      ...rawTable,
      name: tableName,
      columns,
      foreignKeys: rawTable.foreignKeys ?? [],
      uniques: rawTable.uniques ?? [],
      indexes: rawTable.indexes ?? [],
    };
  }
  return { tables };
}
