import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  addressedModelName,
  callerFieldUnknown,
  columnOfCallerField,
  getModelAndEveryVariantFieldColumns,
  getModelAndVariantFieldColumns,
  getModelFieldColumns,
} from './collection-contract';

/** The columns of a model's own and inherited fields, for operations that apply each column to the model's table: `groupBy`, `distinct` and `distinctOn`. */
export function mapFieldsToColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  fieldNames: readonly string[],
): string[] {
  const fieldColumns = getModelFieldColumns(contract, namespaceId, modelName);
  return fieldNames.map((fieldName) =>
    columnOfCallerField(contract, namespaceId, fieldColumns, modelName, fieldName),
  );
}

/** The columns a `select` names: the narrowed variant's fields too, or, when the collection is not narrowed, every variant's fields, each name reading every column a variant maps it to. See `getModelAndVariantFieldColumns` for why `select` accepts more than other surfaces. */
export function mapSelectedFieldsToColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  variantName: string | undefined,
  fieldNames: readonly string[],
): string[] {
  const addressed = addressedModelName(modelName, variantName);
  if (variantName !== undefined) {
    const fieldColumns = getModelAndVariantFieldColumns(
      contract,
      namespaceId,
      modelName,
      variantName,
    );
    return fieldNames.map((fieldName) =>
      columnOfCallerField(contract, namespaceId, fieldColumns, addressed, fieldName),
    );
  }
  const fieldColumns = getModelAndEveryVariantFieldColumns(contract, namespaceId, modelName);
  return fieldNames.flatMap((fieldName) => {
    const columns = Object.hasOwn(fieldColumns, fieldName) ? fieldColumns[fieldName] : undefined;
    if (columns === undefined)
      throw callerFieldUnknown(contract, namespaceId, fieldColumns, addressed, fieldName);
    return [...columns];
  });
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

    mappedCursor[columnOfCallerField(contract, namespaceId, fieldColumns, modelName, fieldName)] =
      value;
  }

  return mappedCursor;
}
