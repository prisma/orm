import type { Contract } from '@internal/contract/types';
import type { ResolvedTableRename } from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { buildSqlitePlanDiff } from './diff-database-schema';
import { pairIndexReplacements, renamedTableIndex } from './index-replacements';
import { coalesceSubtreeIssues } from './issue-planner';
import { RenameTableCall } from './op-factory-call';
import { renameTableInSqliteSchema } from './working-schema';

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
  readonly rename: ResolvedTableRename;
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
