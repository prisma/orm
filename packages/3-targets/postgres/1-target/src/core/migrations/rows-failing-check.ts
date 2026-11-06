import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { RowsFailingCheck } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { CHECK_KINDS, composeCheckWirePrefix, parseWireName } from '@internal/sql-schema-ir/naming';
import { ifDefined } from '@internal/utils/defined';
import { dropCheckConstraintId } from './operations/constraints';
import { qualifyTableName } from './planner-sql-checks';
import type { PostgresPlanTargetDetails } from './planner-target-details';

/** SQLSTATE `check_violation`: a row fails a check. */
export const CHECK_VIOLATION = '23514';

type Operation = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

/**
 * The existing rows that the check `operation` adds refuses, when `constraint`, the check the
 * database names in its `check_violation`, is that check and the contract declares it.
 */
export function rowsFailingCheckOf(input: {
  readonly operation: Operation;
  readonly constraint: string | undefined;
  readonly storage: SqlStorage;
  readonly operations: readonly Operation[];
  readonly operationIndex: number;
}):
  | { readonly summary: string; readonly why: string; readonly fact: RowsFailingCheck }
  | undefined {
  const details = input.operation.target.details;
  const table = details?.table;
  if (details?.objectType !== 'checkConstraint' || table === undefined) return undefined;
  if (input.constraint !== details.name) return undefined;
  const declared = declaredCheck(input.storage, table, details.name);
  if (declared === undefined) return undefined;
  const { prefix, expression } = declared.check;
  const column =
    prefix === undefined
      ? undefined
      : declared.columns.find((name) =>
          CHECK_KINDS.some((kind) => composeCheckWirePrefix(table, name, kind) === prefix),
        );
  const replacedCheck =
    prefix === undefined
      ? undefined
      : input.operations
          .slice(0, input.operationIndex)
          .reverse()
          .map(({ id, target }) =>
            target.details === undefined ? undefined : { id, ...target.details },
          )
          .find(
            (dropped) =>
              dropped !== undefined &&
              dropped.id === dropCheckConstraintId(table, dropped.name) &&
              parseWireName(dropped.name)?.prefix === prefix,
          )?.name;
  const query = `SELECT * FROM ${qualifyTableName(details.schema, table)} WHERE NOT (${expression})`;
  const onColumn = column === undefined ? '' : ` on column "${column}"`;
  return {
    summary: `Rows of table "${table}" fail check "${details.name}"${onColumn}, so the check cannot be added.`,
    why: `Find them with \`${query}\`.`,
    fact: {
      check: details.name,
      ...ifDefined('replacedCheck', replacedCheck),
      operationIndex: input.operationIndex,
    },
  };
}

function declaredCheck(
  storage: SqlStorage,
  table: string,
  name: string,
):
  | {
      readonly check: { readonly prefix?: string; readonly expression: string };
      readonly columns: readonly string[];
    }
  | undefined {
  for (const namespace of Object.values(storage.namespaces)) {
    const declared = namespace.entries.table?.[table];
    const check = declared?.checks?.find((candidate) => candidate.name === name);
    if (declared !== undefined && check !== undefined) {
      return { check, columns: Object.keys(declared.columns) };
    }
  }
  return undefined;
}
