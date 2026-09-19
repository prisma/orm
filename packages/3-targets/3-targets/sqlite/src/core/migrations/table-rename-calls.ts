import type { Contract } from '@internal/contract/types';
import { applyTableRename, type TableRename } from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { SqlStorage } from '@internal/sql-contract/types';
import { buildSqlitePlanDiff, sqliteContractToSchema } from './diff-database-schema';
import { pairIndexReplacements, renamedTableIndex } from './index-replacements';
import { coalesceSubtreeIssues } from './issue-planner';
import { RenameTableCall, type SqliteOpFactoryCall } from './op-factory-call';

/**
 * The calls a migration's `renameTable` emits: the table rename, then a drop of each wire-named index whose prefix derives from the old table name and a create of it under the new name, since SQLite cannot rename an index. SQLite names no primary key, unique constraint or foreign key the contract leaves unnamed, so those need nothing. Throws `MIGRATION.TABLE_RENAME_UNMATCHED` when the start contract lacks the table or the end contract lacks the new name.
 */
export function sqliteTableRenameCalls(input: {
  readonly startContract: Contract<SqlStorage> | null;
  readonly endContract: Contract<SqlStorage>;
  readonly rename: TableRename;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): readonly SqliteOpFactoryCall[] {
  const applied = applyTableRename({
    startContract: input.startContract,
    endContract: input.endContract,
    rename: input.rename,
    renameTableReferences: undefined,
  });
  if (!applied.ok) {
    throw applied.failure;
  }
  const { rename } = applied.value;
  const { issues } = buildSqlitePlanDiff({
    contract: input.endContract,
    actualSchema: sqliteContractToSchema(applied.value.contract),
    frameworkComponents: input.frameworkComponents,
  });
  return [
    new RenameTableCall(rename.from, rename.to),
    ...pairIndexReplacements(coalesceSubtreeIssues(issues), renamedTableIndex(new Set([rename.to])))
      .calls,
  ];
}
