import { isArrayEqual } from '@internal/utils/array-equal';
import { assertDefined } from '@internal/utils/assertions';
import type { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import {
  defaultForeignKeyName,
  defaultPrimaryKeyName,
  defaultUniqueName,
} from './default-constraint-names';
import { RenameConstraintCall } from './op-factory-call';

export interface TableRenameConstraintInput {
  /** The schema name the rename calls carry: the unbound sentinel for the unbound namespace. */
  readonly schemaName: string;
  /**
   * The renamed table as the working schema has it after the rename, its constraint names as they
   * are in the database.
   */
  readonly previous: PostgresTableSchemaNode;
  /** The table in the destination schema. */
  readonly next: PostgresTableSchemaNode;
}

/**
 * The constraint renames that follow a table rename. Each primary key, unique constraint and
 * foreign key of the renamed table is paired with the destination constraint of the same kind on
 * the same columns, and for a foreign key the same referenced columns. Foreign keys pair first
 * with destination keys to the same referenced table, and the rest then pair with keys to another
 * table, because a later rename in the same plan may change that table and a foreign key's derived
 * name never depends on it. A paired constraint is renamed to the destination's explicit name, or else
 * to the name the planner derives from the new table name, when that differs from its name in the
 * database. Each destination constraint pairs with at most one constraint, in order. An unpaired
 * constraint is being dropped or changed and keeps its name. Indexes and checks are not handled
 * here: their wire names pair by content hash in the index and check rename passes.
 */
export function constraintRenamesForTableRename(
  input: TableRenameConstraintInput,
): readonly RenameConstraintCall[] {
  return pairedConstraintRenames(input, { primaryKey: true, onColumns: () => true });
}

/** Which of the renamed table's constraints a rename can have renamed. */
export interface ConstraintRenameScope {
  readonly primaryKey: boolean;
  readonly onColumns: (columns: readonly string[]) => boolean;
}

/**
 * The renames of the constraints in `scope` that pair with a destination constraint of the same
 * kind on the same columns, to the destination's explicit name or else the derived one.
 */
export function pairedConstraintRenames(
  input: TableRenameConstraintInput,
  scope: ConstraintRenameScope,
): readonly RenameConstraintCall[] {
  const { schemaName, previous, next } = input;
  const table = next.name;
  const rename = (
    kind: 'primaryKey' | 'unique' | 'foreignKey',
    actualName: string | undefined,
    target: string | undefined,
  ): readonly RenameConstraintCall[] => {
    assertDefined(
      actualName,
      `the table "${previous.name}" has a ${kind} that has no name; the working schema names every primary key, unique and foreign key a rename can change`,
    );
    return target === undefined || target === actualName
      ? []
      : [new RenameConstraintCall(schemaName, table, kind, actualName, target)];
  };

  const nextPrimaryKey = next.primaryKey;
  const primaryKey =
    previous.primaryKey === undefined || !scope.primaryKey
      ? []
      : rename(
          'primaryKey',
          previous.primaryKey.name,
          nextPrimaryKey !== undefined &&
            isArrayEqual(previous.primaryKey.columns, nextPrimaryKey.columns)
            ? (nextPrimaryKey.name ?? defaultPrimaryKeyName(table))
            : undefined,
        );

  const pairedUniques = new Set<PostgresTableSchemaNode['uniques'][number]>();
  const uniques = previous.uniques
    .filter((unique) => scope.onColumns(unique.columns))
    .flatMap((unique) => {
      const paired = next.uniques.find(
        (candidate) =>
          !pairedUniques.has(candidate) && isArrayEqual(candidate.columns, unique.columns),
      );
      if (paired !== undefined) pairedUniques.add(paired);
      return rename(
        'unique',
        unique.name,
        paired === undefined
          ? undefined
          : (paired.name ?? defaultUniqueName(table, paired.columns)),
      );
    });

  const previousForeignKeys = previous.foreignKeys.filter((fk) => scope.onColumns(fk.columns));
  const pairing = pairForeignKeys(previousForeignKeys, next.foreignKeys);
  const foreignKeys = previousForeignKeys.flatMap((fk) => {
    const paired = pairing.get(fk);
    return rename(
      'foreignKey',
      fk.name,
      paired === undefined ? undefined : (paired.name ?? defaultForeignKeyName(table, fk.columns)),
    );
  });

  return [...primaryKey, ...uniques, ...foreignKeys];
}

type ForeignKeyNode = PostgresTableSchemaNode['foreignKeys'][number];

/**
 * Pairs old foreign keys with destination keys on the same columns and referenced columns. Every
 * key to the same referenced table pairs first, so an old key with no such match cannot take the
 * destination key another old key keeps; the remaining keys then pair in order.
 */
function pairForeignKeys(
  previous: readonly ForeignKeyNode[],
  next: readonly ForeignKeyNode[],
): ReadonlyMap<ForeignKeyNode, ForeignKeyNode> {
  const pairs = new Map<ForeignKeyNode, ForeignKeyNode>();
  const taken = new Set<ForeignKeyNode>();
  const pass = (accepts: (fk: ForeignKeyNode, candidate: ForeignKeyNode) => boolean) => {
    for (const fk of previous) {
      if (pairs.has(fk)) continue;
      const paired = next.find(
        (candidate) =>
          !taken.has(candidate) &&
          isArrayEqual(candidate.columns, fk.columns) &&
          isArrayEqual(candidate.referencedColumns, fk.referencedColumns) &&
          accepts(fk, candidate),
      );
      if (paired === undefined) continue;
      pairs.set(fk, paired);
      taken.add(paired);
    }
  };
  pass(
    (fk, candidate) =>
      candidate.referencedTable === fk.referencedTable &&
      candidate.resolvedReferencedNamespace === fk.resolvedReferencedNamespace,
  );
  pass(() => true);
  return pairs;
}
