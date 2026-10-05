import type { SqlMigrationPlannerPlanOptions } from '@internal/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import { resolveNamespaceIdForDdlSchema } from './control-policy';
import { defaultForeignKeyName, defaultPrimaryKeyName } from './default-constraint-names';
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
  if (previousKey !== undefined && nextKey?.isEqualTo(previousKey)) {
    const oldName = previousKey.name ?? defaultPrimaryKeyName(tableName);
    const newName = nextKey.name ?? defaultPrimaryKeyName(tableName);
    if (oldName !== newName) {
      calls.push(new RenameConstraintCall(schemaName, tableName, 'primaryKey', oldName, newName));
    }
  }
  for (const previousForeignKey of previous.foreignKeys) {
    const nextForeignKey = next.foreignKeys.find(
      (candidate) =>
        candidate.id === previousForeignKey.id && candidate.isEqualTo(previousForeignKey),
    );
    if (nextForeignKey === undefined) continue;
    const derivedName = defaultForeignKeyName(tableName, previousForeignKey.columns);
    const oldName = previousForeignKey.name ?? derivedName;
    const newName = nextForeignKey.name ?? derivedName;
    if (oldName !== newName) {
      calls.push(new RenameConstraintCall(schemaName, tableName, 'foreignKey', oldName, newName));
    }
  }
  return calls;
}

/**
 * The renames of each primary key and foreign key the start and end contracts both have, otherwise unchanged, whose name changes: a stated name that changes, a name the end contract starts or stops stating. The diff never compares constraint names, so without these the database keeps the old name. A database may already have the new name, as when Prisma 7 created it and the contract only now states it; the rename's postcheck then holds before it runs, and the runner skips it.
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
