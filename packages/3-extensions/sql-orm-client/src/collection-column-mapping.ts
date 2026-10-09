import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  getFieldColumnsInScope,
  getModelFieldColumns,
  resolveFieldColumn,
} from './collection-contract';

/** The columns of a model's own and inherited fields, for operations that apply each column to the model's table: `groupBy`, `distinct` and `distinctOn`. */
export function mapFieldsToColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  fieldNames: readonly string[],
): string[] {
  const fieldColumns = getModelFieldColumns(contract, namespaceId, modelName);
  return fieldNames.map((fieldName) => resolveFieldColumn(fieldColumns, modelName, fieldName));
}

/** The columns a `select` names. It also accepts the fields of the variant in scope, or of every variant when the collection is not narrowed, because the polymorphic projection places each column on its own table. */
export function mapSelectedFieldsToColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  variantName: string | undefined,
  fieldNames: readonly string[],
): string[] {
  const fieldColumns = getFieldColumnsInScope(contract, namespaceId, modelName, variantName);
  return fieldNames.map((fieldName) => resolveFieldColumn(fieldColumns, modelName, fieldName));
}

export function mapCursorValuesToColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  cursorValues: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const fieldColumns = getModelFieldColumns(contract, namespaceId, modelName);
  const mappedCursor: Record<string, unknown> = {};

  for (const [fieldName, value] of Object.entries(cursorValues)) {
    if (value === undefined) {
      continue;
    }

    mappedCursor[resolveFieldColumn(fieldColumns, modelName, fieldName)] = value;
  }

  return mappedCursor;
}
