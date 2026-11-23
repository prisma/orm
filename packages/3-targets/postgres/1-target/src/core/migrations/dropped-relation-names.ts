import type { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import type { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import {
  DropConstraintCall,
  DropIndexCall,
  DropTableCall,
  type PostgresOpFactoryCall,
} from './op-factory-call';

function constraintAndIndexNames(table: PostgresTableSchemaNode): readonly string[] {
  return [
    table.primaryKey?.name,
    ...table.uniques.map(({ name }) => name),
    ...table.indexes.map(({ name }) => name),
    ...table.foreignKeys.map(({ name }) => name),
    ...(table.checks ?? []).map(({ name }) => name),
  ].filter((name): name is string => name !== undefined);
}

/**
 * Whether one of `calls` drops a constraint or index named `name` in schema `schemaName`, by
 * dropping it or the table it is on in `schema`. Schema names go through `ddlSchemaOf`, as calls
 * name the unbound namespace by its id.
 */
export function droppedRelationNames(
  calls: readonly PostgresOpFactoryCall[],
  schema: PostgresDatabaseSchemaNode,
  ddlSchemaOf: (schemaName: string) => string,
): (schemaName: string, name: string) => boolean {
  const key = (schemaName: string, name: string) => JSON.stringify([ddlSchemaOf(schemaName), name]);
  const dropped = new Set<string>();
  for (const call of calls) {
    if (call instanceof DropTableCall) {
      const table = Object.values(schema.namespaces).find(
        (namespace) => namespace.schemaName === ddlSchemaOf(call.schemaName),
      )?.tables[call.tableName];
      for (const name of table === undefined ? [] : constraintAndIndexNames(table)) {
        dropped.add(key(call.schemaName, name));
      }
    } else if (call instanceof DropIndexCall) {
      dropped.add(key(call.schemaName, call.indexName));
    } else if (call instanceof DropConstraintCall) {
      dropped.add(key(call.schemaName, call.constraintName));
    }
  }
  return (schemaName, name) => dropped.has(key(schemaName, name));
}
