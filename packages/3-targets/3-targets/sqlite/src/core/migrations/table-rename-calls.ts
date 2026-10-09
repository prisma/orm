import type { Contract } from '@internal/contract/types';
import type { ColumnRename, TableRename, TableRenameRequest } from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { buildSqlitePlanDiff } from './diff-database-schema';
import { pairIndexReplacements, renamedColumnIndex, renamedTableIndex } from './index-replacements';
import { coalesceSubtreeIssues } from './issue-planner';
import { RenameColumnCall, RenameTableCall } from './op-factory-call';
import { renameTableSteps } from './operations/tables';
import { renameColumnInSqliteSchema, renameTableInSqliteSchema } from './working-schema';

/** The SQL a user runs against the database to rename the table by hand. */
export function renameTableByHandStatements(rename: TableRenameRequest): readonly string[] {
  return renameTableSteps(rename.from, rename.to).map((renameStep) => renameStep.sql);
}

/** The `renameTable` call a user writes in `migration.ts` for `rename`; SQLite has no namespaces. */
export function renderRenameTableCall(rename: TableRenameRequest): string {
  return new RenameTableCall(rename.from, rename.to, []).renderTypeScript();
}

/**
 * The call that renames a table, carrying as companions a drop and a create under the new name of
 * each index whose wire name derives from the old table name, since SQLite cannot rename an index.
 * `previous` is the schema with the table under its old name; the renamed copy is diffed against
 * `contract`. SQLite names no primary key, unique constraint or foreign key the contract leaves
 * unnamed, so those need nothing.
 */
export function sqliteTableRenameCall(input: {
  readonly previous: SqlSchemaIR;
  readonly contract: Contract<SqlStorage>;
  readonly rename: TableRename;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): RenameTableCall {
  const { from, to } = input.rename;
  const { issues } = buildSqlitePlanDiff({
    contract: input.contract,
    actualSchema: renameTableInSqliteSchema(input.previous, { from, to }),
    frameworkComponents: input.frameworkComponents,
  });
  const { replacements } = pairIndexReplacements(
    coalesceSubtreeIssues(issues),
    renamedTableIndex(new Set([to])),
  );
  return new RenameTableCall(from, to, replacements);
}

/**
 * The call that renames a column, carrying as companions a drop and a create under the new name of
 * each index on the column whose wire name derives from the column name, since SQLite cannot rename
 * an index and keeps the old name when it renames the column. `previous` is the schema with the
 * column under its old name; the renamed copy is diffed against `contract`.
 */
export function sqliteColumnRenameCall(input: {
  readonly previous: SqlSchemaIR;
  readonly contract: Contract<SqlStorage>;
  readonly rename: ColumnRename;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): RenameColumnCall {
  const { table, from, to } = input.rename;
  const { issues } = buildSqlitePlanDiff({
    contract: input.contract,
    actualSchema: renameColumnInSqliteSchema(input.previous, { table, from, to }),
    frameworkComponents: input.frameworkComponents,
  });
  const { replacements } = pairIndexReplacements(
    coalesceSubtreeIssues(issues),
    renamedColumnIndex(table, to),
  );
  return new RenameColumnCall(table, from, to, replacements);
}
