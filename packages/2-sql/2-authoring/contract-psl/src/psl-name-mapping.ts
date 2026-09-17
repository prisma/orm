import { lowerFirst } from './psl-attribute-parsing';

/**
 * The `@@map` name a model must carry for its table to read back as
 * `tableName`, or `undefined` when the name this source derives from the model
 * name already matches it.
 */
export function pslModelMapName(modelName: string, tableName: string): string | undefined {
  return tableName === lowerFirst(modelName) ? undefined : tableName;
}

/**
 * The `@map` name a field must carry for its column to read back as
 * `columnName`, or `undefined` when the field name already matches it.
 */
export function pslFieldMapName(fieldName: string, columnName: string): string | undefined {
  return columnName === fieldName ? undefined : columnName;
}
