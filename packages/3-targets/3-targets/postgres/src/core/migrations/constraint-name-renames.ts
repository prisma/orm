import type { SqlMigrationPlannerPlanOptions } from '@internal/family-sql/control';
import type { DiffableNode } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import type { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import { resolveNamespaceIdForDdlSchema } from './control-policy';
import {
  defaultForeignKeyName,
  defaultPrimaryKeyName,
  defaultUniqueName,
} from './default-constraint-names';
import { RenameConstraintCall } from './op-factory-call';
import { postgresContractToSchema } from './postgres-contract-to-schema';

export interface ConstraintNameRenameInput {
  readonly schemaName: string;
  /** The table's name in the start tree. */
  readonly from: string;
  /** The table's name in the end tree; the same as `from` unless the table is renamed. */
  readonly to: string;
  /** The table as the start tree describes it, from a contract or from the database. */
  readonly previous: PostgresTableSchemaNode;
  readonly next: PostgresTableSchemaNode;
}

/** The constraint of `nextNodes` the diff pairs with `node` and finds unchanged. */
function unchangedIn<TNode extends DiffableNode>(
  node: TNode,
  nextNodes: readonly TNode[],
): TNode | undefined {
  return nextNodes.find((next) => next.id === node.id && next.isEqualTo(node));
}

/**
 * The renames of the primary key, unique constraints and foreign keys of one table that the end tree keeps otherwise unchanged but names differently. A constraint's name is its stated name, or the one the planner derives from its table; a start tree read from the database states every name. A constraint whose start and end names differ is renamed to the end name. The diff never compares constraint names, so without these the database keeps the old name. A database may already have the new name, as when Prisma 7 created it and the contract only now states it; the rename's postcheck then holds before it runs, and the runner skips it.
 */
export function constraintNameRenames(
  input: ConstraintNameRenameInput,
): readonly RenameConstraintCall[] {
  const { schemaName, from, to, previous, next } = input;
  const rename = (
    kind: 'primaryKey' | 'unique' | 'foreignKey',
    oldName: string,
    unchanged: { readonly name?: string } | undefined,
    derivedName: string,
  ): readonly RenameConstraintCall[] => {
    if (unchanged === undefined) return [];
    const newName = unchanged.name ?? derivedName;
    return oldName === newName
      ? []
      : [new RenameConstraintCall(schemaName, to, kind, oldName, newName)];
  };

  const primaryKey =
    previous.primaryKey === undefined
      ? []
      : rename(
          'primaryKey',
          previous.primaryKey.name ?? defaultPrimaryKeyName(from),
          unchangedIn(previous.primaryKey, next.primaryKey === undefined ? [] : [next.primaryKey]),
          defaultPrimaryKeyName(to),
        );
  const uniques = previous.uniques.flatMap((unique) =>
    rename(
      'unique',
      unique.name ?? defaultUniqueName(from, unique.columns),
      unchangedIn(unique, next.uniques),
      defaultUniqueName(to, unique.columns),
    ),
  );
  const foreignKeys = previous.foreignKeys.flatMap((fk) =>
    rename(
      'foreignKey',
      fk.name ?? defaultForeignKeyName(from, fk.columns),
      unchangedIn(fk, next.foreignKeys),
      defaultForeignKeyName(to, fk.columns),
    ),
  );
  return [...primaryKey, ...uniques, ...foreignKeys];
}

/**
 * The constraint renames of a plan: {@link constraintNameRenames} for every table the start tree and the end contract both have, with the start tree as the plan's rename statements left it. The start tree comes from the start contract for `migration plan` and from the database for `db update`, so a database Prisma 8 created under derived names is renamed too once the contract states other names.
 */
export function plannedConstraintNameRenames(
  options: Pick<
    SqlMigrationPlannerPlanOptions,
    'contract' | 'schema' | 'policy' | 'frameworkComponents'
  >,
): readonly RenameConstraintCall[] {
  if (!options.policy.allowedOperationClasses.includes('widening')) return [];
  PostgresDatabaseSchemaNode.assert(options.schema);
  const startTablesBySchema = new Map(
    Object.values(options.schema.namespaces).map((namespace) => [
      namespace.schemaName,
      namespace.tables,
    ]),
  );
  const contract = options.contract;
  const end = postgresContractToSchema(contract, options.frameworkComponents);
  return Object.values(end.namespaces).flatMap((namespace) => {
    const startTables = startTablesBySchema.get(namespace.schemaName) ?? {};
    const schemaName =
      resolveNamespaceIdForDdlSchema(contract, namespace.schemaName) === UNBOUND_NAMESPACE_ID
        ? UNBOUND_NAMESPACE_ID
        : namespace.schemaName;
    return Object.entries(namespace.tables).flatMap(([tableName, next]) => {
      const previous = startTables[tableName];
      return previous === undefined
        ? []
        : constraintNameRenames({ schemaName, from: tableName, to: tableName, previous, next });
    });
  });
}
