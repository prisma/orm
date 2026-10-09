import { compareCodeUnits } from '@internal/contract/hashing-utils';
import { type ControlPolicy, effectiveControlPolicy } from '@internal/contract/types';
import type { AuthoringWarning } from '@internal/framework-components/authoring';
import { lowerAuthoredCheck } from '@internal/sql-contract/authored-check-naming';
import { materializeForeignKeysAndIndexes } from '@internal/sql-contract/foreign-key-materialization';
import { type AuthoredIndexInput, lowerAuthoredIndex } from '@internal/sql-contract/index-naming';
import type { IndexTypeRegistry } from '@internal/sql-contract/index-types';
import {
  CheckConstraint,
  Index,
  type StorageColumn,
  type StorageTableInput,
} from '@internal/sql-contract/types';
import {
  type CheckKind,
  composeCheckWirePrefix,
  derivedCheckPrefixes,
} from '@internal/sql-schema-ir/naming';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { CheckNode, IndexNode } from './contract-definition';
import { contractError } from './contract-errors';
import { type ColumnLoweringContext, lowerColumn } from './lower-column';
import type { TableDescription } from './storage-description';

const DERIVABLE_CHECK_KINDS: readonly CheckKind[] = ['membership', 'elementNotNull'];

/**
 * Which of `columnNames` could have produced `prefix` for some
 * {@link CheckKind} — the reverse of {@link derivedCheckPrefixes}, used only
 * to name the collision in `CONTRACT.CHECK_NAME_RESERVED`'s message. Callers
 * already know `prefix` is a member of `derivedCheckPrefixes(tableName,
 * columnNames)`, so the result is never empty.
 */
function columnsProducingCheckPrefix(
  tableName: string,
  columnNames: readonly string[],
  prefix: string,
): readonly string[] {
  return columnNames.filter((columnName) =>
    DERIVABLE_CHECK_KINDS.some(
      (kind) => composeCheckWirePrefix(tableName, columnName, kind) === prefix,
    ),
  );
}

export interface TableLoweringContext extends ColumnLoweringContext {
  readonly defaultControlPolicy: ControlPolicy | undefined;
  readonly indexTypeRegistry: IndexTypeRegistry;
  /** Receives the warnings index, check and foreign key lowering raise. */
  readonly warnings: AuthoringWarning[];
}

/**
 * Lowers one table: each of its columns, then its indexes, checks, primary key, uniques and foreign keys, with the backing indexes its foreign keys need.
 *
 * Checks are derived only for tables Prisma 8 owns: the contract describes an external schema, it does not prescribe enforcement for it. This reads the policy the source declares; a policy applied by a contract specifier lands after the build and is handled by `stripDerivedChecksFromNonManagedTables`. Authored checks are kept whatever the policy: they are the author's statement about a constraint they know exists.
 */
export function lowerTable(
  table: TableDescription,
  context: TableLoweringContext,
): StorageTableInput {
  const { tableName } = table;
  const derivesChecks =
    effectiveControlPolicy(table.control, context.defaultControlPolicy) === 'managed';
  const placement = { namespaceId: table.namespaceId, tableName, derivesChecks };

  const columns: Record<string, StorageColumn> = {};
  const checks: CheckConstraint[] = [];
  for (const description of table.columns) {
    const lowered = lowerColumn(description, placement, context);
    columns[description.columnName] = lowered.column;
    checks.push(...lowered.derivedChecks);
  }

  const uniques = table.uniques.map((u) => ({
    columns: u.columns,
    ...ifDefined('name', u.name),
  }));
  const declaredIndexes = table.indexes.map((index) => ({
    namedByUser: index.name !== undefined || index.map !== undefined,
    index: lowerAuthoredIndex(
      tableName,
      authoredIndexInput(index),
      context.warnings,
      context.indexTypeRegistry,
    ),
  }));
  checks.push(...lowerAuthoredChecks(tableName, Object.keys(columns), table.checks, context));
  const primaryKey = table.id
    ? { columns: table.id.columns, ...ifDefined('name', table.id.name) }
    : undefined;
  const { foreignKeys, indexes } = materializeForeignKeysAndIndexes({
    tableName,
    foreignKeys: table.foreignKeys,
    declaredIndexes,
    uniques,
    primaryKey,
    warnings: context.warnings,
    indexTypes: context.indexTypeRegistry,
  });

  return {
    columns,
    ...ifDefined('control', table.control),
    uniques,
    // Constructed here rather than left as input: the `table` entity
    // kind's hydration tells an authored index from a stored one by
    // whether it is already an Index.
    indexes: indexes.map((i) => new Index(i)),
    foreignKeys,
    ...(primaryKey ? { primaryKey } : {}),
    ...(checks.length > 0 ? { checks: inCanonicalOrder(checks) } : {}),
  };
}

/**
 * The checks sorted by name in UTF-16 code-unit order, the order contract canonicalization gives them. The table's storage is then the same whichever declaration each column came from and in whatever order the columns were listed.
 */
function inCanonicalOrder(checks: readonly CheckConstraint[]): readonly CheckConstraint[] {
  return [...checks].sort((a, b) => compareCodeUnits(a.name, b.name));
}

function authoredIndexInput(index: IndexNode): AuthoredIndexInput {
  return blindCast<
    AuthoredIndexInput,
    'the definition tree already carries both unions; the spread loses the correlation, and lowerAuthoredIndex re-checks at runtime'
  >({
    ...ifDefined('columns', index.columns),
    ...ifDefined('expression', index.expression),
    where: index.where,
    unique: index.unique,
    map: index.map,
    name: index.name,
    type: index.type,
    options: index.options,
  });
}

/** Names the authored checks, and refuses one whose name could be taken for a derived check of a column of this table. */
function lowerAuthoredChecks(
  tableName: string,
  tableColumnNames: readonly string[],
  authoredChecks: readonly CheckNode[],
  context: TableLoweringContext,
): CheckConstraint[] {
  if (authoredChecks.length === 0) return [];
  const reservedCheckPrefixes = derivedCheckPrefixes(tableName, tableColumnNames);
  return authoredChecks.map((authoredCheck) => {
    const lowered = lowerAuthoredCheck(tableName, authoredCheck, context.warnings);
    if (lowered.naming.kind === 'wire' && reservedCheckPrefixes.has(lowered.naming.prefix)) {
      const collidingColumns = columnsProducingCheckPrefix(
        tableName,
        tableColumnNames,
        lowered.naming.prefix,
      );
      const columnList = collidingColumns.map((name) => `"${name}"`).join(', ');
      throw contractError(
        'CONTRACT.CHECK_NAME_RESERVED',
        `Check "${lowered.naming.prefix}" on table "${tableName}": this name's prefix matches the shape a derived enforcement check would use for column${collidingColumns.length === 1 ? '' : 's'} ${columnList} of this table, so it can't be told apart from one. Choose a different name.`,
        { meta: { tableName, prefix: lowered.naming.prefix, collidingColumns } },
      );
    }
    return new CheckConstraint(lowered);
  });
}
