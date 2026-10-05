import type { DiffableNode } from '@internal/framework-components/control';
import type { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import {
  defaultForeignKeyName,
  defaultPrimaryKeyName,
  defaultUniqueName,
} from './default-constraint-names';
import { RenameConstraintCall } from './op-factory-call';

export interface TableRenameConstraintInput {
  readonly schemaName: string;
  readonly from: string;
  readonly to: string;
  /** The renamed table as the start contract describes it, under its new name. */
  readonly previous: PostgresTableSchemaNode;
  readonly next: PostgresTableSchemaNode;
}

/** The constraint of the next table the diff pairs with `node` and finds unchanged, as the diff compares them. */
function unchangedIn<TNode extends DiffableNode>(
  node: TNode,
  nextNodes: readonly TNode[],
): TNode | undefined {
  return nextNodes.find((next) => next.id === node.id && next.isEqualTo(node));
}

/**
 * The constraint renames that follow a table rename. A primary key, unique constraint or foreign key the start contract left unnamed carries a name derived from the old table name. When the end contract keeps the same constraint unchanged, it is renamed to the name the end contract gives it explicitly, or otherwise to the name derived from the new table name. A primary key or foreign key both contracts name is renamed when the end contract states a different name. A constraint the end contract changes is not renamed, so it keeps its name in the database. Any other constraint the start contract named keeps its name. Indexes and checks are not handled here: their wire names pair by content hash in the index and check rename passes.
 */
export function constraintRenamesForTableRename(
  input: TableRenameConstraintInput,
): readonly RenameConstraintCall[] {
  const { schemaName, from, to, previous, next } = input;
  const rename = (
    kind: 'primaryKey' | 'unique' | 'foreignKey',
    oldName: string,
    newName: string | undefined,
  ): readonly RenameConstraintCall[] =>
    newName === undefined || oldName === newName
      ? []
      : [new RenameConstraintCall(schemaName, to, kind, oldName, newName)];
  const unchangedName = (
    oldName: string | undefined,
    unchanged: { readonly name?: string } | undefined,
    derivedName: string,
  ): string | undefined => {
    if (unchanged === undefined) return undefined;
    if (oldName === undefined) return unchanged.name ?? derivedName;
    return unchanged.name;
  };

  const previousKey = previous.primaryKey;
  const primaryKey =
    previousKey === undefined
      ? []
      : rename(
          'primaryKey',
          previousKey.name ?? defaultPrimaryKeyName(from),
          unchangedName(
            previousKey.name,
            unchangedIn(previousKey, next.primaryKey === undefined ? [] : [next.primaryKey]),
            defaultPrimaryKeyName(to),
          ),
        );

  const uniques = previous.uniques
    .filter((unique) => unique.name === undefined)
    .flatMap((unique) =>
      rename(
        'unique',
        defaultUniqueName(from, unique.columns),
        unchangedName(
          undefined,
          unchangedIn(unique, next.uniques),
          defaultUniqueName(to, unique.columns),
        ),
      ),
    );

  const foreignKeys = previous.foreignKeys.flatMap((fk) =>
    rename(
      'foreignKey',
      fk.name ?? defaultForeignKeyName(from, fk.columns),
      unchangedName(
        fk.name,
        unchangedIn(fk, next.foreignKeys),
        defaultForeignKeyName(to, fk.columns),
      ),
    ),
  );

  return [...primaryKey, ...uniques, ...foreignKeys];
}
