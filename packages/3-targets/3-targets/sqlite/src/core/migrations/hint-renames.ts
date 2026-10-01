import type { Contract } from '@internal/contract/types';
import type { ResolvedHints, ResolvedTableRename } from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { ConsumedHint } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import type { RenameTableCall } from './op-factory-call';
import { sqliteTableRenameCall } from './table-rename-calls';
import { createWorkingSchema } from './working-schema';

export interface HintRenames {
  readonly calls: readonly RenameTableCall[];
  /** The origin with every planned rename applied: the schema the rest of the plan diffs. */
  readonly adjustedOrigin: SqlSchemaIR;
  readonly consumed: readonly ConsumedHint[];
  /** The table renames applied, in order. */
  readonly renames: readonly ResolvedTableRename[];
  /** Always empty: SQLite applies a hint whatever the table's control policy. */
  readonly warnings: readonly [];
}

/**
 * Turns the resolved table renames into rename calls, in order, each computed against the origin as
 * the earlier renames leave it.
 */
export function planHintRenames(input: {
  readonly origin: SqlSchemaIR;
  readonly contract: Contract<SqlStorage>;
  readonly hints: Pick<ResolvedHints, 'tableRenames'>;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): HintRenames {
  const working = createWorkingSchema(input.origin);
  const calls: RenameTableCall[] = [];
  const consumed: ConsumedHint[] = [];
  const renames: ResolvedTableRename[] = [];
  for (const rename of input.hints.tableRenames) {
    const call = sqliteTableRenameCall({
      previous: working.current,
      contract: input.contract,
      rename,
      frameworkComponents: input.frameworkComponents,
    });
    working.apply(call);
    calls.push(call);
    renames.push(rename);
    consumed.push({
      kind: 'renamed',
      coordinate: { namespaceId: rename.namespaceId, entityKind: 'table', entityName: rename.to },
      from: rename.from,
    });
  }
  return { calls, adjustedOrigin: working.current, consumed, renames, warnings: [] };
}
