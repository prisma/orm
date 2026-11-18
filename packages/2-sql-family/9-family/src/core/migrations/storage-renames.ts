import { asNamespaceId, type Contract } from '@internal/contract/types';
import {
  type FieldCoordinate,
  type MigrationOperationClass,
  type ModelCoordinate,
  modelDisplayName,
  type ResolvedFieldRenameStatement,
  type ResolvedMigrationStatement,
  type ResolvedModelRenameStatement,
  type ResolvedRenameStatement,
} from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  fieldColumn,
  fieldsStoring,
  type ModelTable,
  modelsStoring,
  modelTable,
  type SameName,
  sameTable,
  sqlModelStorage,
  tableControlPolicy,
} from './model-storage';
import { capitalized, fieldDisplayName, fieldsText, joinedList, modelsText } from './plan-text';
import type { SchemaTables } from './schema-tables';
import type { SqlPlannerConflict } from './types';

/**
 * An origin model planned as a destination model: by a statement, or, when `statement` is
 * `undefined`, because both contracts have a model with its namespace and name. It includes models
 * whose table does not change, which no `TableChange` holds.
 */
export interface ModelRename {
  readonly from: ModelCoordinate;
  readonly to: ModelCoordinate;
  readonly statement: ResolvedModelRenameStatement | undefined;
}

/**
 * An origin field planned as a destination field: by a statement, or, when `statement` is
 * `undefined`, because the two models it belongs to are planned as one and both have a field of
 * its name. It includes fields whose column does not change, which no `ColumnChange` holds.
 */
export interface FieldRename {
  readonly from: FieldCoordinate;
  readonly to: FieldCoordinate;
  readonly statement: ResolvedFieldRenameStatement | undefined;
}

/** A table that moves from the origin contract to the destination contract, with the model renames that move it; planned against the working schema as a `TableRename`. */
export interface TableChange {
  readonly origin: ModelTable;
  readonly destination: ModelTable;
  readonly renames: readonly ModelRename[];
}

/** A column that moves from the origin contract to the destination contract, with the field renames that move it; planned against the working schema as a `ColumnRename`. */
export interface ColumnChange {
  readonly origin: ModelTable;
  readonly destination: ModelTable;
  readonly from: string;
  readonly to: string;
  readonly renames: readonly FieldRename[];
}

/**
 * Why a table or column cannot be renamed whole: the objects stored in it that move elsewhere, or
 * the objects stored in the name it would move to that come from elsewhere.
 */
export interface SharedStorage<TObject> {
  readonly kind: 'split' | 'merged';
  readonly objects: readonly TObject[];
}

function coordinateKey(coordinate: ModelCoordinate | FieldCoordinate): string {
  return JSON.stringify([
    coordinate.namespaceId,
    coordinate.model,
    'field' in coordinate ? coordinate.field : null,
  ]);
}

/** The name each namespace has after the namespace rename statements, keyed by its origin name. */
function namespaceRenamesOf(
  statements: readonly ResolvedRenameStatement[],
): ReadonlyMap<string, string> {
  return new Map(
    statements.flatMap((statement) =>
      statement.entity === 'namespace' ? [[statement.from, statement.to] as const] : [],
    ),
  );
}

function modelRenamesOf(
  statements: readonly ResolvedRenameStatement[],
  namespaceRenames: ReadonlyMap<string, string>,
  fromContract: Contract<SqlStorage>,
  contract: Contract<SqlStorage>,
): readonly ModelRename[] {
  const stated = statements.flatMap((statement) =>
    statement.entity === 'model' ? [{ from: statement.from, to: statement.to, statement }] : [],
  );
  const named = new Set(stated.flatMap((rename) => [rename.from, rename.to]).map(coordinateKey));
  const kept = Object.entries(fromContract.domain.namespaces).flatMap(([namespaceId, namespace]) =>
    Object.keys(namespace.models).flatMap((model) => {
      const from = { namespaceId: asNamespaceId(namespaceId), model };
      const to = {
        namespaceId: asNamespaceId(namespaceRenames.get(namespaceId) ?? namespaceId),
        model,
      };
      const inDestination = Object.hasOwn(
        contract.domain.namespaces[to.namespaceId]?.models ?? {},
        model,
      );
      return inDestination && !named.has(coordinateKey(from)) && !named.has(coordinateKey(to))
        ? [{ from, to, statement: undefined }]
        : [];
    }),
  );
  return [...stated, ...kept];
}

function fieldRenamesOf(
  statements: readonly ResolvedRenameStatement[],
  models: readonly ModelRename[],
  fromContract: Contract<SqlStorage>,
  contract: Contract<SqlStorage>,
): readonly FieldRename[] {
  const stated = statements.flatMap((statement) =>
    statement.entity === 'field' ? [{ from: statement.from, to: statement.to, statement }] : [],
  );
  const named = new Set(stated.flatMap((rename) => [rename.from, rename.to]).map(coordinateKey));
  const kept = models.flatMap((model) => {
    const originFields = Object.keys(sqlModelStorage(fromContract, model.from)?.fields ?? {});
    const destinationFields = sqlModelStorage(contract, model.to)?.fields ?? {};
    return originFields.flatMap((field) => {
      const from = { ...model.from, field };
      const to = { ...model.to, field };
      return Object.hasOwn(destinationFields, field) &&
        !named.has(coordinateKey(from)) &&
        !named.has(coordinateKey(to))
        ? [{ from, to, statement: undefined }]
        : [];
    });
  });
  return [...stated, ...kept];
}

function grouped<T, K>(
  items: readonly T[],
  keyOf: (item: T) => K | undefined,
  textOf: (key: K) => string,
): readonly { readonly key: K; readonly items: readonly T[] }[] {
  const groups = new Map<string, { readonly key: K; readonly items: T[] }>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === undefined) continue;
    const text = textOf(key);
    const group = groups.get(text);
    if (group === undefined) groups.set(text, { key, items: [item] });
    else group.items.push(item);
  }
  return [...groups.values()];
}

function tablesText(key: Pick<TableChange, 'origin' | 'destination'>): string {
  return JSON.stringify([
    key.origin.namespaceId,
    key.origin.table,
    key.destination.namespaceId,
    key.destination.table,
  ]);
}

function columnsText(key: Omit<ColumnChange, 'renames'>): string {
  return JSON.stringify([tablesText(key), key.from, key.to]);
}

/**
 * The renames a plan makes, from its statements and from the names both contracts keep, and the
 * tables and columns they move.
 */
export class StorageRenames {
  readonly models: readonly ModelRename[];
  readonly fields: readonly FieldRename[];
  readonly tableChanges: readonly TableChange[];
  readonly columnChanges: readonly ColumnChange[];
  readonly #fromContract: Contract<SqlStorage>;
  readonly #contract: Contract<SqlStorage>;
  readonly #namespaceRenames: ReadonlyMap<string, string>;
  readonly #byOrigin: ReadonlyMap<string, ModelRename | FieldRename>;
  readonly #byDestination: ReadonlyMap<string, ModelRename | FieldRename>;
  /** Whether the target takes two table or column names for one. */
  readonly sameName: SameName;

  constructor(
    statements: readonly ResolvedRenameStatement[],
    fromContract: Contract<SqlStorage>,
    contract: Contract<SqlStorage>,
    sameName: SameName,
  ) {
    this.#fromContract = fromContract;
    this.#contract = contract;
    this.sameName = sameName;
    this.#namespaceRenames = namespaceRenamesOf(statements);
    this.models = modelRenamesOf(statements, this.#namespaceRenames, fromContract, contract);
    this.fields = fieldRenamesOf(statements, this.models, fromContract, contract);
    const renames = [...this.models, ...this.fields];
    this.#byOrigin = new Map(renames.map((rename) => [coordinateKey(rename.from), rename]));
    this.#byDestination = new Map(renames.map((rename) => [coordinateKey(rename.to), rename]));
    this.tableChanges = grouped(
      this.models,
      (rename) => {
        const tables = this.#tablesOf(rename);
        return tables === undefined || this.inPlace(tables.origin, tables.destination)
          ? undefined
          : tables;
      },
      tablesText,
    ).map(({ key, items }) => ({ ...key, renames: items }));
    this.columnChanges = grouped(
      this.fields,
      (rename) => {
        const columns = this.#columnsOf(rename);
        return columns === undefined || columns.from === columns.to ? undefined : columns;
      },
      columnsText,
    ).map(({ key, items }) => ({ ...key, renames: items }));
  }

  #tablesOf(rename: { readonly from: ModelCoordinate; readonly to: ModelCoordinate }) {
    const origin = modelTable(this.#fromContract, rename.from);
    const destination = modelTable(this.#contract, rename.to);
    return origin === undefined || destination === undefined ? undefined : { origin, destination };
  }

  #columnsOf(rename: FieldRename) {
    const tables = this.#tablesOf(rename);
    const from = fieldColumn(this.#fromContract, rename.from);
    const to = fieldColumn(this.#contract, rename.to);
    return tables === undefined || from === undefined || to === undefined
      ? undefined
      : { ...tables, from, to };
  }

  /** The namespace an origin namespace has after the namespace rename statements. */
  namespaceAfterRenames(namespaceId: string): string {
    return this.#namespaceRenames.get(namespaceId) ?? namespaceId;
  }

  /** Whether the origin table is the destination table once the namespace renames are made. */
  inPlace(origin: ModelTable, destination: ModelTable): boolean {
    return sameTable(
      { namespaceId: this.namespaceAfterRenames(origin.namespaceId), table: origin.table },
      destination,
    );
  }

  /** The table change that moves the table of `rename`'s origin model, if its table changes. */
  tableChangeOf(rename: ModelRename): TableChange | undefined {
    return this.tableChanges.find((change) => change.renames.includes(rename));
  }

  /** The column change that moves the column of `rename`'s origin field, if its column changes. */
  columnChangeOf(rename: FieldRename): ColumnChange | undefined {
    return this.columnChanges.find((change) => change.renames.includes(rename));
  }

  /** Whether the control policy is `managed` for the origin table and the destination table. */
  managedOnBothSides(change: TableChange | ColumnChange): boolean {
    return (
      tableControlPolicy(this.#fromContract, change.origin) === 'managed' &&
      tableControlPolicy(this.#contract, change.destination) === 'managed'
    );
  }

  #renameFrom(origin: ModelCoordinate | FieldCoordinate) {
    return this.#byOrigin.get(coordinateKey(origin));
  }

  #renameTo(destination: ModelCoordinate | FieldCoordinate) {
    return this.#byDestination.get(coordinateKey(destination));
  }

  #storedIn(contract: Contract<SqlStorage>, coordinate: ModelCoordinate | FieldCoordinate) {
    const table = modelTable(contract, coordinate);
    if (table === undefined) return undefined;
    return 'field' in coordinate
      ? { table, column: fieldColumn(contract, coordinate) }
      : { table, column: undefined };
  }

  /** The destination table of an origin model, through the renames: `undefined` when the destination removes the model. */
  destinationTableOf(model: ModelCoordinate): ModelTable | undefined {
    const rename = this.#renameFrom(model);
    return rename === undefined ? undefined : modelTable(this.#contract, rename.to);
  }

  /**
   * Why the rows of table `origin` cannot move whole to table `destination`: an origin model stored
   * in it that the destination keeps in another table, or a destination model stored in the new
   * table, as the target compares names, whose origin model is stored elsewhere. Models pair through
   * the renames. `undefined` when the whole table moves, and nothing else moves there. A model the
   * destination removes, or a new model, blocks nothing.
   */
  sharedTable(
    change: Pick<TableChange, 'origin' | 'destination'>,
  ): SharedStorage<ModelCoordinate> | undefined {
    const split = this.originModelsIn(change.origin).filter((model) => {
      const destination = this.destinationTableOf(model);
      return destination !== undefined && !sameTable(destination, change.destination);
    });
    if (split.length > 0) return { kind: 'split', objects: split };
    const merged = this.destinationModelsIn(change.destination).flatMap((model) => {
      const rename = this.#renameTo(model);
      const origin = rename === undefined ? undefined : modelTable(this.#fromContract, rename.from);
      return origin !== undefined && rename !== undefined && !sameTable(origin, change.origin)
        ? [rename.from]
        : [];
    });
    return merged.length > 0 ? { kind: 'merged', objects: merged } : undefined;
  }

  /**
   * Why the change cannot rename its column: an origin field stored in it that the destination
   * keeps in another column, or a destination field stored in the new column, as the target
   * compares names, whose origin field is stored elsewhere. `undefined` when the whole column
   * moves, and nothing else moves there.
   */
  sharedColumn(change: ColumnChange): SharedStorage<FieldCoordinate> | undefined {
    const split = fieldsStoring(
      this.#fromContract,
      change.origin,
      change.from,
      this.sameName,
    ).filter((field) => {
      const rename = this.#renameFrom(field);
      const destination =
        rename === undefined ? undefined : this.#storedIn(this.#contract, rename.to);
      return (
        destination?.column !== undefined &&
        (!sameTable(destination.table, change.destination) || destination.column !== change.to)
      );
    });
    if (split.length > 0) return { kind: 'split', objects: split };
    const merged = fieldsStoring(
      this.#contract,
      change.destination,
      change.to,
      this.sameName,
    ).flatMap((field) => {
      const rename = this.#renameTo(field);
      const origin =
        rename === undefined ? undefined : this.#storedIn(this.#fromContract, rename.from);
      return rename !== undefined &&
        'field' in rename.from &&
        origin?.column !== undefined &&
        (!sameTable(origin.table, change.origin) || origin.column !== change.from)
        ? [rename.from]
        : [];
    });
    return merged.length > 0 ? { kind: 'merged', objects: merged } : undefined;
  }

  /**
   * A name for `name` to move through that no table of the namespace has in either contract, as
   * the target compares names.
   */
  unusedTableName(namespaceId: string, name: string): string {
    const used = [this.#fromContract, this.#contract].flatMap((contract) =>
      Object.keys(contract.storage.namespaces[namespaceId]?.entries.table ?? {}),
    );
    return this.#unused(used, name);
  }

  /**
   * A name for `name` to move through that no column of the change's table has in either
   * contract, as the target compares names.
   */
  unusedColumnName(change: ColumnChange, name: string): string {
    const columnsOf = (contract: Contract<SqlStorage>, table: ModelTable) =>
      Object.keys(
        contract.storage.namespaces[table.namespaceId]?.entries.table?.[table.table]?.columns ?? {},
      );
    return this.#unused(
      [
        ...columnsOf(this.#fromContract, change.origin),
        ...columnsOf(this.#contract, change.destination),
      ],
      name,
    );
  }

  #unused(used: readonly string[], name: string): string {
    let candidate = `prisma_swap_${name}`;
    while (used.some((existing) => this.sameName(existing, candidate))) candidate = `${candidate}_`;
    return candidate;
  }

  /** Whether the origin contract has `table`, as the target compares names. */
  originHasTable(table: ModelTable): boolean {
    const tables = this.#fromContract.storage.namespaces[table.namespaceId]?.entries.table ?? {};
    return Object.keys(tables).some((name) => this.sameName(name, table.table));
  }

  /** Whether the origin contract has `column` on `table`, as the target compares names. */
  originHasColumn(table: ModelTable, column: string): boolean {
    const stored =
      this.#fromContract.storage.namespaces[table.namespaceId]?.entries.table?.[table.table];
    return Object.keys(stored?.columns ?? {}).some((name) => this.sameName(name, column));
  }

  /** The models of the origin contract stored in `table`, as the target compares names. */
  originModelsIn(table: ModelTable): readonly ModelCoordinate[] {
    return modelsStoring(this.#fromContract, table, this.sameName).map(
      ({ coordinate }) => coordinate,
    );
  }

  /** The models of the destination contract stored in `table`, as the target compares names. */
  destinationModelsIn(table: ModelTable): readonly ModelCoordinate[] {
    return modelsStoring(this.#contract, table, this.sameName).map(({ coordinate }) => coordinate);
  }

  /** The fields of the origin contract stored in `column` of `table`, as the target compares names. */
  originFieldsIn(table: ModelTable, column: string): readonly FieldCoordinate[] {
    return fieldsStoring(this.#fromContract, table, column, this.sameName);
  }
}

/** What a table or column change does, in words: the contract change, or the statement that asks for it. */
export function tableChangeText(change: TableChange): string {
  const stated = change.renames.find((rename) => rename.statement !== undefined);
  if (stated !== undefined) {
    return `model "${modelDisplayName(stated.from)}" is renamed to "${modelDisplayName(stated.to)}", which renames table "${change.origin.table}" to "${change.destination.table}"`;
  }
  return `the table of ${modelsText(change.renames.map((rename) => rename.from))} changes from "${change.origin.table}" to "${change.destination.table}"`;
}

export function columnChangeText(change: ColumnChange): string {
  const stated = change.renames.find((rename) => rename.statement !== undefined);
  if (stated !== undefined) {
    return `field "${fieldDisplayName(stated.from)}" is renamed to "${fieldDisplayName(stated.to)}", which renames column "${change.from}" to "${change.to}"`;
  }
  return `the column of ${fieldsText(change.renames.map((rename) => rename.from))} changes from "${change.from}" to "${change.to}"`;
}

/** One object's move in the route through names nothing uses: what moves, through which name, to which. */
interface RouteMove {
  readonly objects: string;
  readonly through: string;
  readonly to: string;
}

/**
 * The route that works on both commands for a chain or swap of names: a plan that moves each
 * object to a name nothing uses, then a plan that moves it to its final name.
 */
function temporaryNamesRoute(
  noun: 'table' | 'column',
  moves: readonly RouteMove[],
  withStatements: boolean,
): string {
  const give = (name: (move: RouteMove) => string) =>
    joinedList(moves.map((move) => `${move.objects} the ${noun} "${name(move)}"`));
  return `Make the change in two plans: first give ${give(({ through }) => through)}, ${noun}s nothing uses, and plan and apply that${withStatements ? ' with the same statements' : ''}; then give ${give(({ to }) => to)}, and plan again${withStatements ? ' without them' : ''}.`;
}

function tableMoves(
  changes: readonly TableChange[],
  renames: StorageRenames,
): readonly RouteMove[] {
  return changes.map((change) => ({
    objects: modelsText(change.renames.map((rename) => rename.to)),
    through: renames.unusedTableName(change.destination.namespaceId, change.destination.table),
    to: change.destination.table,
  }));
}

function columnMoves(
  changes: readonly ColumnChange[],
  renames: StorageRenames,
): readonly RouteMove[] {
  return changes.map((change) => ({
    objects: fieldsText(change.renames.map((rename) => rename.to)),
    through: renames.unusedColumnName(change, change.to),
    to: change.to,
  }));
}

const ORDER =
  'A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out';

export interface ConflictLocation extends ModelTable {
  readonly column?: string;
}

/**
 * Refuses a rename. With the statement that asks for it, the conflict carries the statement; a
 * rename no statement asks for is refused as a contract change the plan cannot make, and its text
 * names that change.
 */
export function renameRefused(
  statement: ResolvedMigrationStatement | undefined,
  summary: string,
  why: string,
  location: ConflictLocation | undefined,
  refusedOperationClass?: MigrationOperationClass,
): SqlPlannerConflict {
  return {
    ...(statement === undefined
      ? { kind: 'unsupportedOperation' as const }
      : { kind: 'statementRefused' as const, refusedStatement: statement }),
    summary,
    why,
    ...(refusedOperationClass === undefined ? {} : { refusedOperationClass }),
    ...(location === undefined
      ? {}
      : {
          location: {
            namespaceId: location.namespaceId,
            entityKind: 'table',
            entityName: location.table,
            ...(location.column === undefined ? {} : { column: location.column }),
          },
        }),
  };
}

function contractChangeRefused(
  summary: string,
  why: string,
  location: ConflictLocation,
): SqlPlannerConflict {
  return renameRefused(undefined, summary, why, location);
}

function hasStatement(change: TableChange | ColumnChange): boolean {
  return change.renames.some((rename) => rename.statement !== undefined);
}

/** How the first of two plans frees a name: it removes what the origin stores there, or the table or column itself when nothing is. */
function freeName(
  kind: 'table' | 'column',
  held: string,
  holders: { readonly text: string; readonly count: number },
  unused: string,
): string {
  if (holders.count === 0) {
    return `remove ${kind} "${held}" or give it a name nothing uses, such as "${unused}"`;
  }
  const [them, their] = holders.count === 1 ? ['it', 'its'] : ['them', 'their'];
  return `remove ${holders.text}, or keep ${them} and change ${their} ${kind} to a name nothing uses, such as "${unused}"`;
}

/**
 * Refuses a table rename that no statement asks for when it swaps, chains or merges with another
 * rename, or moves onto a name the schema being planned from already has. Names compare the way
 * the target compares them, through `tables`.
 */
function tableRenameConflict(
  change: TableChange,
  current: string | undefined,
  changes: readonly TableChange[],
  tables: SchemaTables,
  renames: StorageRenames,
): SqlPlannerConflict | undefined {
  const { namespaceId } = change.origin;
  const from = change.origin.table;
  const to = change.destination.table;
  const label = `Cannot rename table "${from}" to "${to}"`;
  const location = change.origin;
  const changeText = capitalized(tableChangeText(change));
  const movingModels = modelsText(change.renames.map((rename) => rename.from));
  const misread = (table: string) => `rows of table "${table}" as rows of ${movingModels}`;
  const others = changes.filter((other) => other !== change);
  const { sameName } = renames;
  const [held] = tables
    .tablesNamed(namespaceId, to)
    .filter((table) => !sameName(table, from) && table !== current);
  if (held !== undefined) {
    const heldTable = { namespaceId, table: held };
    const moved = others.find(
      (other) => other.origin.namespaceId === namespaceId && sameName(other.origin.table, held),
    );
    if (moved !== undefined) {
      return contractChangeRefused(
        `${label}: table "${held}" is renamed in the same plan`,
        `${changeText}, and ${tableChangeText(moved)}. ${ORDER}, and without the renames the plan would read the ${misread(held)}. ${temporaryNamesRoute('table', tableMoves([change, moved], renames), hasStatement(moved))}`,
        location,
      );
    }
    if (!renames.originHasTable(heldTable)) {
      return contractChangeRefused(
        `${label}: the database has both tables`,
        `${changeText}, and the database has both table "${from}" and table "${held}". One of two things happened, and each has its own fix. If the rename was half done by hand, or something created table "${held}" before db update ran, table "${from}" holds the rows of ${movingModels}: move into table "${from}" the rows of table "${held}" that it does not already hold, and where both tables hold a row with the same key, keep the version you want in table "${from}"; then drop table "${held}", and run again. If table "${from}" was renamed to "${held}" by hand and the name "${from}" then used for another table, table "${held}" holds the rows of ${movingModels}: drop table "${from}", and run again; to keep the rows of that other table, first move them into a table the contract has, since db update drops every table the contract does not have.`,
        location,
      );
    }
    const holders = renames.originModelsIn(heldTable);
    return contractChangeRefused(
      `${label}: the schema being planned from already has a table "${to}"${held === to ? '' : `, as "${held}"`}`,
      `${changeText}, and the schema being planned from already has table "${held}"${holders.length === 0 ? '' : `, the table of ${modelsText(holders)}`}. Without the rename the plan would read the ${misread(held)}. Make the change in two plans: first ${freeName('table', held, { text: modelsText(holders), count: holders.length }, renames.unusedTableName(namespaceId, held))}, and plan and apply that; then make this change and plan again.`,
      location,
    );
  }
  const takes = others.find(
    (other) =>
      hasStatement(other) &&
      other.destination.namespaceId === change.destination.namespaceId &&
      sameName(other.destination.table, from),
  );
  if (takes !== undefined) {
    return contractChangeRefused(
      `${label}: another rename in the same plan takes table name "${takes.destination.table}"`,
      `${changeText}, and ${tableChangeText(takes)}. ${ORDER}. ${temporaryNamesRoute('table', tableMoves([change, takes], renames), true)}`,
      location,
    );
  }
  return undefined;
}

function columnRenameConflict(
  change: ColumnChange,
  table: string,
  current: string | undefined,
  changes: readonly ColumnChange[],
  tables: SchemaTables,
  renames: StorageRenames,
): SqlPlannerConflict | undefined {
  const { namespaceId } = change.origin;
  const label = `Cannot rename column "${table}"."${change.from}" to "${change.to}"`;
  const location = { namespaceId, table, column: change.from };
  const changeText = capitalized(columnChangeText(change));
  const movingFields = fieldsText(change.renames.map((rename) => rename.from));
  const misread = (column: string) => `values of column "${column}" as values of ${movingFields}`;
  const others = changes.filter(
    (other) => other !== change && sameTable(other.origin, change.origin),
  );
  const { sameName } = renames;
  const [held] = tables
    .columnsNamed(namespaceId, table, change.to)
    .filter((column) => !sameName(column, change.from) && column !== current);
  if (held !== undefined) {
    const moved = others.find((other) => sameName(other.from, held));
    if (moved !== undefined) {
      return contractChangeRefused(
        `${label}: column "${held}" is renamed in the same plan`,
        `${changeText}, and ${columnChangeText(moved)}. ${ORDER}, and without the renames the plan would read the ${misread(held)}. ${temporaryNamesRoute('column', columnMoves([change, moved], renames), hasStatement(moved))}`,
        location,
      );
    }
    if (!renames.originHasColumn(change.origin, held)) {
      return contractChangeRefused(
        `${label}: the database has both columns`,
        `${changeText}, and table "${table}" in the database has both column "${change.from}" and column "${held}". One of two things happened, and each has its own fix. If the rename was half done by hand, or something created column "${held}" before db update ran, column "${change.from}" holds the values of ${movingFields}: copy into column "${change.from}" the value of column "${held}" in each row where column "${held}" holds one and column "${change.from}" holds none, and where both hold a value, keep the one you want in column "${change.from}"; then drop column "${held}", and run again. If column "${change.from}" was renamed to "${held}" by hand and the name "${change.from}" then used for another column, column "${held}" holds the values of ${movingFields}: drop column "${change.from}", and run again; to keep the values of that other column, first move them into a column the contract has, since db update drops every column the contract does not have.`,
        location,
      );
    }
    const holders = renames.originFieldsIn(change.origin, held);
    return contractChangeRefused(
      `${label}: the schema being planned from already has a column "${change.to}" on table "${table}"${held === change.to ? '' : `, as "${held}"`}`,
      `${changeText}, and the schema being planned from already has column "${held}" on table "${table}"${holders.length === 0 ? '' : `, the column of ${fieldsText(holders)}`}. Without the rename the plan would read the ${misread(held)}. Make the change in two plans: first ${freeName('column', held, { text: fieldsText(holders), count: holders.length }, renames.unusedColumnName(change, held))}, and plan and apply that; then make this change and plan again.`,
      location,
    );
  }
  const takes = others.find((other) => hasStatement(other) && sameName(other.to, change.from));
  if (takes !== undefined) {
    return contractChangeRefused(
      `${label}: another rename in the same plan takes column name "${takes.to}"`,
      `${changeText}, and ${columnChangeText(takes)}. ${ORDER}. ${temporaryNamesRoute('column', columnMoves([change, takes], renames), true)}`,
      location,
    );
  }
  return undefined;
}

/**
 * Where the schema being planned from has the table or column of a change under a name other than
 * its old one, as `name`: the new name, when the rename is already done, or a name the target takes
 * for the old or new one, which differs from it only in case.
 */
export interface FoundUnder<TChange> {
  readonly change: TChange;
  readonly name: string;
}

/** The table and column renames a plan makes, those its statements ask for and those it makes for names both contracts keep. */
export interface PlannedStorageRenames {
  readonly tables: readonly TableChange[];
  readonly columns: readonly ColumnChange[];
  /** The changes no statement asks for whose table the schema being planned from has under another name. */
  readonly foundTables: readonly FoundUnder<TableChange>[];
  readonly foundColumns: readonly FoundUnder<ColumnChange>[];
}

function foundName<TChange>(
  found: readonly FoundUnder<TChange>[],
  matches: (change: TChange) => boolean,
): string | undefined {
  return found.find(({ change }) => matches(change))?.name;
}

/**
 * The name the table of a column change has in the schema being planned from: its origin name
 * when the table stays or is renamed from it, the name the schema has it under when that differs,
 * and `undefined` when the plan does not move the table.
 */
function columnTableInSchema(
  change: ColumnChange,
  tables: readonly TableChange[],
  foundTables: readonly FoundUnder<TableChange>[],
  renames: StorageRenames,
): string | undefined {
  if (renames.inPlace(change.origin, change.destination)) return change.origin.table;
  const matches = (table: TableChange) =>
    sameTable(table.origin, change.origin) && sameTable(table.destination, change.destination);
  const found = foundName(foundTables, matches);
  if (found !== undefined) return found;
  return tables.some(matches) ? change.origin.table : undefined;
}

/**
 * Checks every rename that no statement asks for against all the renames of the plan, before any
 * is applied, and returns the first that cannot be planned.
 */
export function storageRenameConflict(
  planned: PlannedStorageRenames,
  tables: SchemaTables,
  renames: StorageRenames,
): SqlPlannerConflict | undefined {
  for (const change of planned.tables) {
    if (hasStatement(change)) continue;
    const current = foundName(planned.foundTables, (found) => found === change);
    const conflict = tableRenameConflict(change, current, planned.tables, tables, renames);
    if (conflict !== undefined) return conflict;
  }
  for (const change of planned.columns) {
    if (hasStatement(change)) continue;
    const table = columnTableInSchema(change, planned.tables, planned.foundTables, renames);
    if (table === undefined) continue;
    const current = foundName(planned.foundColumns, (found) => found === change);
    const conflict = columnRenameConflict(change, table, current, planned.columns, tables, renames);
    if (conflict !== undefined) return conflict;
  }
  return undefined;
}

type Disposition =
  | { readonly kind: 'none' }
  | { readonly kind: 'rename' | 'alreadyDone'; readonly found: string | undefined };

/**
 * What the plan does for a change no statement asks for, from what the schema being planned from
 * has, as the target compares names: `current`, the name it has for the old one, and `held`, a
 * name it has for the new one that is not the old one. With the old name, the plan renames it from
 * `current`, unless `current` is the new name already. With only the new name, the rename is already
 * done, and a rename gives it the contract's case; when the origin contract has that name too, it is a
 * rename, which the conflict check refuses. With neither, nothing is planned.
 */
function disposition(
  to: string,
  current: string | undefined,
  held: string | undefined,
  originHasHeld: (held: string) => boolean,
): Disposition {
  if (current !== undefined) {
    return current === to
      ? { kind: 'alreadyDone', found: current }
      : { kind: 'rename', found: current };
  }
  if (held === undefined) return { kind: 'none' };
  if (originHasHeld(held)) return { kind: 'rename', found: undefined };
  return held === to ? { kind: 'alreadyDone', found: held } : { kind: 'rename', found: held };
}

/**
 * The renames the plan makes: every change a statement asks for, and each change no statement
 * asks for whose whole table or column moves, whose control policy is `managed` in both
 * contracts, and whose old table or column the schema being planned from has, under the old name
 * or one the target takes for it. A change whose new name the schema has in place of the old one is
 * already done. A column change on a table that changes needs the table change planned or already
 * done.
 */
export function plannedStorageRenames(
  renames: StorageRenames,
  tables: SchemaTables,
): PlannedStorageRenames {
  const { sameName } = renames;
  const plannedTables: TableChange[] = [];
  const foundTables: FoundUnder<TableChange>[] = [];
  const record = <TChange>(
    change: TChange,
    from: string,
    outcome: Disposition,
    planned: TChange[],
    found: FoundUnder<TChange>[],
  ) => {
    if (outcome.kind === 'none') return;
    if (outcome.kind === 'rename') planned.push(change);
    if (outcome.found !== undefined && outcome.found !== from) {
      found.push({ change, name: outcome.found });
    }
  };
  for (const change of renames.tableChanges) {
    if (hasStatement(change)) {
      plannedTables.push(change);
      continue;
    }
    if (
      renames.namespaceAfterRenames(change.origin.namespaceId) !== change.destination.namespaceId ||
      !renames.managedOnBothSides(change) ||
      renames.sharedTable(change) !== undefined
    ) {
      continue;
    }
    const { namespaceId, table: from } = change.origin;
    const to = change.destination.table;
    const [current] = tables.tablesNamed(namespaceId, from);
    const [held] = tables.tablesNamed(namespaceId, to).filter((table) => !sameName(table, from));
    const outcome = disposition(to, current, held, (name) =>
      renames.originHasTable({ namespaceId, table: name }),
    );
    record(change, from, outcome, plannedTables, foundTables);
  }
  const plannedColumns: ColumnChange[] = [];
  const foundColumns: FoundUnder<ColumnChange>[] = [];
  for (const change of renames.columnChanges) {
    if (hasStatement(change)) {
      plannedColumns.push(change);
      continue;
    }
    const table = columnTableInSchema(change, plannedTables, foundTables, renames);
    if (
      table === undefined ||
      !renames.managedOnBothSides(change) ||
      renames.sharedColumn(change) !== undefined
    ) {
      continue;
    }
    const { namespaceId } = change.origin;
    const [current] = tables.columnsNamed(namespaceId, table, change.from);
    const [held] = tables
      .columnsNamed(namespaceId, table, change.to)
      .filter((column) => !sameName(column, change.from));
    const outcome = disposition(change.to, current, held, (name) =>
      renames.originHasColumn(change.origin, name),
    );
    record(change, change.from, outcome, plannedColumns, foundColumns);
  }
  return { tables: plannedTables, columns: plannedColumns, foundTables, foundColumns };
}
