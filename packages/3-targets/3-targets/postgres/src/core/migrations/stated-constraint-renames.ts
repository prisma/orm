import type { SqlMigrationPlannerPlanOptions } from '@internal/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import { resolveNamespaceIdForDdlSchema } from './control-policy';
import { RenameConstraintCall } from './op-factory-call';
import { postgresContractToSchema } from './postgres-contract-to-schema';

function tableRenames(
  schemaName: string,
  tableName: string,
  previous: PostgresTableSchemaNode,
  next: PostgresTableSchemaNode,
): readonly RenameConstraintCall[] {
  const calls: RenameConstraintCall[] = [];
  const previousKey = previous.primaryKey;
  const nextKey = next.primaryKey;
  if (
    previousKey?.name !== undefined &&
    nextKey?.name !== undefined &&
    previousKey.name !== nextKey.name &&
    nextKey.isEqualTo(previousKey)
  ) {
    calls.push(
      new RenameConstraintCall(schemaName, tableName, 'primaryKey', previousKey.name, nextKey.name),
    );
  }
  for (const previousForeignKey of previous.foreignKeys) {
    if (previousForeignKey.name === undefined) continue;
    const nextForeignKey = next.foreignKeys.find(
      (candidate) =>
        candidate.id === previousForeignKey.id && candidate.isEqualTo(previousForeignKey),
    );
    if (nextForeignKey?.name === undefined || nextForeignKey.name === previousForeignKey.name) {
      continue;
    }
    calls.push(
      new RenameConstraintCall(
        schemaName,
        tableName,
        'foreignKey',
        previousForeignKey.name,
        nextForeignKey.name,
      ),
    );
  }
  return calls;
}

/**
 * The renames of each primary key and foreign key whose name both the start and end contracts state, when the stated name changes and the constraint is otherwise unchanged. The diff never compares constraint names, so without these the database keeps the old name. A constraint only one contract names is left alone: an end contract that starts stating a name describes the name the database already has.
 */
export function statedConstraintRenames(
  options: Pick<
    SqlMigrationPlannerPlanOptions,
    'contract' | 'fromContract' | 'policy' | 'frameworkComponents'
  >,
): readonly RenameConstraintCall[] {
  const fromContract = options.fromContract;
  if (fromContract === null || !options.policy.allowedOperationClasses.includes('widening')) {
    return [];
  }
  const contract = options.contract;
  const previous = postgresContractToSchema(fromContract, options.frameworkComponents);
  const next = postgresContractToSchema(contract, options.frameworkComponents);
  return Object.entries(next.namespaces).flatMap(([namespaceKey, namespace]) => {
    const previousTables = previous.namespaces[namespaceKey]?.tables ?? {};
    const emissionSchema =
      resolveNamespaceIdForDdlSchema(contract, namespace.schemaName) === UNBOUND_NAMESPACE_ID
        ? UNBOUND_NAMESPACE_ID
        : namespace.schemaName;
    return Object.entries(namespace.tables).flatMap(([tableName, table]) => {
      const previousTable = previousTables[tableName];
      return previousTable === undefined
        ? []
        : tableRenames(emissionSchema, tableName, previousTable, table);
    });
  });
}
