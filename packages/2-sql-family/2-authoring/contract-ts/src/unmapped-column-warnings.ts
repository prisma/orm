import type { AuthoringWarning } from '@internal/framework-components/authoring';
import { type ModelStorage, type TableDescription, tableKey } from './storage-description';

/**
 * A warning for each column a table node adds to a table some model maps, when the column is required and has no default. The ORM writes only the columns fields map, so every insert it makes into that table fails. Prisma 7 accepts such a schema, so this warns rather than refuses.
 */
export function requiredUnmappedColumnWarnings(
  storages: readonly ModelStorage[],
  tables: readonly TableDescription[],
): AuthoringWarning[] {
  const modelOfTable = new Map<string, string>();
  for (const storage of storages) {
    if (storage.kind === 'ownTable') {
      modelOfTable.set(
        tableKey(storage.table.namespaceId, storage.table.tableName),
        storage.modelName,
      );
    }
  }
  const warnings: AuthoringWarning[] = [];
  for (const table of tables) {
    const modelName = modelOfTable.get(tableKey(table.namespaceId, table.tableName));
    if (modelName === undefined) continue;
    for (const column of table.columns) {
      if (column.site.kind !== 'tableNode' || column.nullable || column.default !== undefined) {
        continue;
      }
      warnings.push({
        code: 'PN_COLUMN_REQUIRED_UNMAPPED',
        message: `Column "${column.columnName}" of table "${table.tableName}" is required and has no default, and no field of model "${modelName}" maps it, so every insert the ORM makes into the table fails. Make the column nullable, give it a database default, or map it with a field.`,
        item: `table "${table.tableName}": column "${column.columnName}"`,
        summary:
          'columns are required, have no default, and no field maps them, so every insert the ORM makes into their tables fails. Make each column nullable, give it a database default, or map it with a field.',
      });
    }
  }
  return warnings;
}
