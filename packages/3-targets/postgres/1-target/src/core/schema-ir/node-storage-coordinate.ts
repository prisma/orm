import type { EntityCoordinate } from '@internal/contract/types';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { PostgresExtensionSchemaNode } from './postgres-extension-schema-node';
import { PostgresNativeEnumSchemaNode } from './postgres-native-enum-schema-node';
import { PostgresTableSchemaNode } from './postgres-table-schema-node';
import { postgresNodeEntityKind } from './schema-node-kinds';

/**
 * The storage-`entries` coordinate `(entityKind, entityName)` a Postgres diff
 * node addresses — a table by its name, a native enum by its physical type
 * name. `undefined` for a node that is not a whole storage entity (a namespace,
 * a column, a policy). Lets ownership/subject resolution treat every entity kind
 * uniformly, the node self-describing its storage identity.
 */
export function postgresNodeStorageCoordinate(
  node: SqlSchemaIRNode,
): Pick<EntityCoordinate, 'entityKind' | 'entityName'> | undefined {
  if (PostgresTableSchemaNode.is(node)) {
    const entityKind = postgresNodeEntityKind(node.nodeKind);
    return entityKind === undefined ? undefined : { entityKind, entityName: node.name };
  }
  if (PostgresNativeEnumSchemaNode.is(node)) {
    const entityKind = postgresNodeEntityKind(node.nodeKind);
    return entityKind === undefined ? undefined : { entityKind, entityName: node.typeName };
  }
  if (PostgresExtensionSchemaNode.is(node)) {
    const entityKind = postgresNodeEntityKind(node.nodeKind);
    return entityKind === undefined ? undefined : { entityKind, entityName: node.name };
  }
  return undefined;
}
