import type { Contract, ControlPolicy } from '@internal/contract/types';
import type {
  MigrationOperationPolicy,
  SchemaOwnership,
} from '@internal/framework-components/control';
import {
  assertContractHintsConsistent,
  type SqlTableHints,
  sqlContractHints,
} from '@internal/sql-contract/hints';
import type { SqlStorage } from '@internal/sql-contract/types';
import { isStructuredError } from '@internal/utils/structured-error';
import { deletedHintsShipped } from '../release-switches';
import type { ResolvedTableRename } from './resolve-table-rename';
import type { SchemaTables } from './schema-tables';
import type { SqlPlannerConflict } from './types';

export const HINT_CONTRADICTED_CODE = 'MIGRATION.HINT_CONTRADICTED';
export const HINT_FOREIGN_TABLE_CODE = 'MIGRATION.HINT_FOREIGN_TABLE';

const HINT_INVALID_CODE = 'CONTRACT.HINT_INVALID';

export interface ResolvedColumnRename {
  readonly namespaceId: string;
  readonly table: string;
  readonly originTable: string;
  readonly from: string;
  readonly to: string;
}

export interface StatedTableDrop {
  readonly namespaceId: string;
  readonly table: string;
  readonly control: ControlPolicy | undefined;
}

export interface StatedColumnDrop {
  readonly namespaceId: string;
  readonly table: string;
  readonly column: string;
}

export interface ResolvedHints {
  readonly tableRenames: readonly ResolvedTableRename[];
  readonly columnRenames: readonly ResolvedColumnRename[];
  readonly tableDrops: readonly StatedTableDrop[];
  readonly columnDrops: readonly StatedColumnDrop[];
  readonly conflicts: readonly SqlPlannerConflict[];
}

export interface ResolveHintsInput {
  readonly contract: Contract<SqlStorage>;
  readonly origin: SchemaTables;
  readonly policy: MigrationOperationPolicy;
  readonly ownership: SchemaOwnership | undefined;
  readonly spaceId: string;
}

function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedEntries<T>(record: Readonly<Record<string, T>>): [string, T][] {
  return Object.entries(record).sort(([a], [b]) => compareCodePoints(a, b));
}

function resolved(parts: Pick<ResolvedHints, 'tableRenames' | 'conflicts'>): ResolvedHints {
  return { ...parts, columnRenames: [], tableDrops: [], columnDrops: [] };
}

function inconsistentHints(input: ResolveHintsInput): SqlPlannerConflict | undefined {
  try {
    assertContractHintsConsistent(input.contract);
    return undefined;
  } catch (error) {
    if (isStructuredError(error) && error.code === HINT_INVALID_CODE) {
      return { kind: 'hintRejected', summary: error.message, meta: { code: HINT_INVALID_CODE } };
    }
    throw error;
  }
}

function tableRenameConflict(input: {
  readonly code: string;
  readonly namespaceId: string;
  readonly from: string;
  readonly to: string;
  readonly problem: string;
  readonly why: string;
}): SqlPlannerConflict {
  const { code, namespaceId, from, to } = input;
  return {
    kind: 'hintRejected',
    summary: `${code}: the rename hint on table "${to}" (was "${from}") ${input.problem}.`,
    why: input.why,
    location: { namespaceId, entityKind: 'table', entityName: to },
    meta: { code, from, to },
  };
}

function resolveTableHint(
  input: ResolveHintsInput,
  namespaceId: string,
  table: string,
  was: string,
): { readonly rename?: ResolvedTableRename; readonly conflict?: SqlPlannerConflict } {
  const owner = input.ownership?.ownerOf({ namespaceId, entityKind: 'table', entityName: was });
  if (owner !== undefined && owner !== input.spaceId) {
    return {
      conflict: tableRenameConflict({
        code: HINT_FOREIGN_TABLE_CODE,
        namespaceId,
        from: was,
        to: table,
        problem: `names a table that contract space "${owner}" owns`,
        why: 'A hint may rename only tables this contract space declares. Remove the hint, or move the table into this space first.',
      }),
    };
  }
  const hasOld = input.origin.hasTable(namespaceId, was);
  const hasNew = input.origin.hasTable(namespaceId, table);
  if (hasOld && hasNew) {
    return {
      conflict: tableRenameConflict({
        code: HINT_CONTRADICTED_CODE,
        namespaceId,
        from: was,
        to: table,
        problem: `cannot apply: namespace "${namespaceId}" has both "${was}" and "${table}"`,
        why: `A rename hint applies only while the old name exists and the new one does not. If "${was}" was already renamed, remove the hint. If "${was}" is a different table that should stay, remove the hint and give the model another table name.${deletedHintsShipped ? ` If "${was}" should be dropped, remove the hint and state the drop with a deleted hint on a model mapped to "${was}".` : ''}`,
      }),
    };
  }
  if (hasOld) {
    return { rename: { namespaceId, from: was, to: table } };
  }
  return {};
}

/**
 * Decides what each hint of the destination contract does against the schema the plan starts
 * from: a rename to apply, nothing, or a conflict that fails the plan.
 */
export function resolveHints(input: ResolveHintsInput): ResolvedHints {
  const invalid = inconsistentHints(input);
  if (invalid !== undefined) {
    return resolved({ tableRenames: [], conflicts: [invalid] });
  }
  if (!input.policy.allowedOperationClasses.includes('widening')) {
    return resolved({ tableRenames: [], conflicts: [] });
  }
  const tableRenames: ResolvedTableRename[] = [];
  const conflicts: SqlPlannerConflict[] = [];
  const hints = sqlContractHints(input.contract);
  for (const [namespaceId, namespaceHints] of sortedEntries(hints?.namespaces ?? {})) {
    for (const [table, entry] of sortedEntries<SqlTableHints>(namespaceHints.tables)) {
      const { rename, conflict } = resolveTableHint(input, namespaceId, table, entry.was);
      if (rename !== undefined) tableRenames.push(rename);
      if (conflict !== undefined) conflicts.push(conflict);
    }
  }
  return resolved({ tableRenames, conflicts });
}
