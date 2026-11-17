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
import type { SchemaTables } from './schema-tables';
import type { SqlPlannerConflict } from './types';

/**
 * An origin model planned as a destination model: by a statement, or, when `statement` is
 * `undefined`, because both contracts have a model with its namespace and name.
 */
export interface ModelRename {
  readonly from: ModelCoordinate;
  readonly to: ModelCoordinate;
  readonly statement: ResolvedModelRenameStatement | undefined;
}

/**
 * An origin field planned as a destination field: by a statement, or, when `statement` is
 * `undefined`, because the two models it belongs to are planned as one and both have a field of
 * its name.
 */
export interface FieldRename {
  readonly from: FieldCoordinate;
  readonly to: FieldCoordinate;
  readonly statement: ResolvedFieldRenameStatement | undefined;
}

/** The renames that move the rows of an origin table to a destination table. */
export interface TableChange {
  readonly origin: ModelTable;
  readonly destination: ModelTable;
  readonly renames: readonly ModelRename[];
}

/** The renames that move the values of a column of an origin table to a column of a destination table. */
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
  readonly kind: 'left' | 'joined';
  readonly objects: readonly TObject[];
}

function coordinateKey(coordinate: ModelCoordinate | FieldCoordinate): string {
  return JSON.stringify([
    coordinate.namespaceId,
    coordinate.model,
    'field' in coordinate ? coordinate.field : null,
  ]);
}

function fieldDisplayName(field: FieldCoordinate): string {
  return `${modelDisplayName(field)}.${field.field}`;
}

function listed(noun: string, names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  if (quoted.length === 1) return `${noun} ${quoted[0]}`;
  return `${noun}s ${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
}

export function modelsText(models: readonly ModelCoordinate[]): string {
  return listed('model', models.map(modelDisplayName));
}

export function fieldsText(fields: readonly FieldCoordinate[]): string {
  return listed('field', fields.map(fieldDisplayName));
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
  same: (left: K, right: K) => boolean,
): readonly { readonly key: K; readonly items: readonly T[] }[] {
  const groups: { key: K; items: T[] }[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (key === undefined) continue;
    const group = groups.find((existing) => same(existing.key, key));
    if (group === undefined) groups.push({ key, items: [item] });
    else group.items.push(item);
  }
  return groups;
}

function sameColumnKey(
  left: Omit<ColumnChange, 'renames'>,
  right: Omit<ColumnChange, 'renames'>,
): boolean {
  return (
    sameTable(left.origin, right.origin) &&
    sameTable(left.destination, right.destination) &&
    left.from === right.from &&
    left.to === right.to
  );
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
    this.tableChanges = grouped(
      this.models,
      (rename) => this.#tablesOf(rename),
      (left, right) =>
        sameTable(left.origin, right.origin) && sameTable(left.destination, right.destination),
    ).flatMap(({ key, items }) =>
      this.inPlace(key.origin, key.destination) ? [] : [{ ...key, renames: items }],
    );
    this.columnChanges = grouped(
      this.fields,
      (rename) => this.#columnsOf(rename),
      sameColumnKey,
    ).flatMap(({ key, items }) => (key.from === key.to ? [] : [{ ...key, renames: items }]));
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
    const key = coordinateKey(origin);
    return [...this.models, ...this.fields].find((rename) => coordinateKey(rename.from) === key);
  }

  #renameTo(destination: ModelCoordinate | FieldCoordinate) {
    const key = coordinateKey(destination);
    return [...this.models, ...this.fields].find((rename) => coordinateKey(rename.to) === key);
  }

  #storedIn(contract: Contract<SqlStorage>, coordinate: ModelCoordinate | FieldCoordinate) {
    const table = modelTable(contract, coordinate);
    if (table === undefined) return undefined;
    return 'field' in coordinate
      ? { table, column: fieldColumn(contract, coordinate) }
      : { table, column: undefined };
  }

  /**
   * Why the change cannot rename its table: an origin model stored in it that the destination
   * keeps in another table, or a destination model stored in the new table, as the target compares
   * names, whose origin model is stored elsewhere. `undefined` when the whole table moves, and
   * nothing else moves there. A model the destination removes, or a new model, blocks nothing.
   */
  sharedTable(change: TableChange): SharedStorage<ModelCoordinate> | undefined {
    const left = modelsStoring(this.#fromContract, change.origin)
      .map(({ coordinate }) => coordinate)
      .filter((model) => {
        const rename = this.#renameFrom(model);
        const destination =
          rename === undefined ? undefined : this.#storedIn(this.#contract, rename.to);
        return destination !== undefined && !sameTable(destination.table, change.destination);
      });
    if (left.length > 0) return { kind: 'left', objects: left };
    const joined = modelsStoring(this.#contract, change.destination, this.sameName).flatMap(
      ({ coordinate }) => {
        const rename = this.#renameTo(coordinate);
        const origin =
          rename === undefined ? undefined : this.#storedIn(this.#fromContract, rename.from);
        return origin !== undefined &&
          rename !== undefined &&
          !sameTable(origin.table, change.origin)
          ? [rename.from]
          : [];
      },
    );
    return joined.length > 0 ? { kind: 'joined', objects: joined } : undefined;
  }

  /**
   * Why the change cannot rename its column: an origin field stored in it that the destination
   * keeps in another column, or a destination field stored in the new column, as the target
   * compares names, whose origin field is stored elsewhere. `undefined` when the whole column
   * moves, and nothing else moves there.
   */
  sharedColumn(change: ColumnChange): SharedStorage<FieldCoordinate> | undefined {
    const left = fieldsStoring(this.#fromContract, change.origin, change.from).filter((field) => {
      const rename = this.#renameFrom(field);
      const destination =
        rename === undefined ? undefined : this.#storedIn(this.#contract, rename.to);
      return (
        destination?.column !== undefined &&
        (!sameTable(destination.table, change.destination) || destination.column !== change.to)
      );
    });
    if (left.length > 0) return { kind: 'left', objects: left };
    const joined = fieldsStoring(
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
    return joined.length > 0 ? { kind: 'joined', objects: joined } : undefined;
  }

  /** The models of the origin contract stored in `table`, as the target compares names. */
  originModelsIn(table: ModelTable): readonly ModelCoordinate[] {
    return modelsStoring(this.#fromContract, table, this.sameName).map(
      ({ coordinate }) => coordinate,
    );
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

export function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

const TEMPORARY_NAMES_ROUTE =
  'Make the change in two plans: first give the tables and columns that change names that nothing uses, and plan and apply that; then give them their final names and plan again.';

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

/**
 * Refuses a table rename that no statement asks for when it swaps, chains or merges with another
 * rename, or moves onto a name the schema being planned from already has. Names compare the way
 * the target compares them, through `tables`.
 */
function tableRenameConflict(
  change: TableChange,
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
  const misread = (table: string) =>
    `rows of table "${table}" as rows of ${modelsText(change.renames.map((rename) => rename.from))}`;
  const others = changes.filter((other) => other !== change);
  const { sameName } = renames;
  const [held] = tables.tablesNamed(namespaceId, to).filter((table) => table !== from);
  if (held !== undefined) {
    const heldTable = { namespaceId, table: held };
    const moved = others.find(
      (other) => other.origin.namespaceId === namespaceId && sameName(other.origin.table, held),
    );
    if (moved !== undefined) {
      return contractChangeRefused(
        `${label}: table "${held}" is renamed in the same plan`,
        `${changeText}, and ${tableChangeText(moved)}. ${ORDER}, and without the renames the plan would read the ${misread(held)}. ${TEMPORARY_NAMES_ROUTE}`,
        location,
      );
    }
    const holders = renames.originModelsIn(heldTable);
    return contractChangeRefused(
      `${label}: the schema being planned from already has a table "${to}"${held === to ? '' : `, as "${held}"`}`,
      `${changeText}, and the schema being planned from already has table "${held}"${holders.length === 0 ? '' : `, the table of ${modelsText(holders)}`}. Without the rename the plan would read the ${misread(held)}. Make the change in two plans: first remove table "${held}" or give it a name nothing uses, and plan and apply that; then make this change and plan again.`,
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
      `${changeText}, and ${tableChangeText(takes)}. ${ORDER}. ${TEMPORARY_NAMES_ROUTE}`,
      location,
    );
  }
  return undefined;
}

function columnRenameConflict(
  change: ColumnChange,
  changes: readonly ColumnChange[],
  tables: SchemaTables,
  renames: StorageRenames,
): SqlPlannerConflict | undefined {
  const { namespaceId, table } = change.origin;
  const label = `Cannot rename column "${table}"."${change.from}" to "${change.to}"`;
  const location = { ...change.origin, column: change.from };
  const changeText = capitalized(columnChangeText(change));
  const misread = (column: string) =>
    `values of column "${column}" as values of ${fieldsText(change.renames.map((rename) => rename.from))}`;
  const others = changes.filter(
    (other) => other !== change && sameTable(other.origin, change.origin),
  );
  const { sameName } = renames;
  const [held] = tables
    .columnsNamed(namespaceId, table, change.to)
    .filter((column) => column !== change.from);
  if (held !== undefined) {
    const moved = others.find((other) => sameName(other.from, held));
    if (moved !== undefined) {
      return contractChangeRefused(
        `${label}: column "${held}" is renamed in the same plan`,
        `${changeText}, and ${columnChangeText(moved)}. ${ORDER}, and without the renames the plan would read the ${misread(held)}. ${TEMPORARY_NAMES_ROUTE}`,
        location,
      );
    }
    const holders = renames.originFieldsIn(change.origin, held);
    return contractChangeRefused(
      `${label}: the schema being planned from already has a column "${change.to}" on table "${table}"${held === change.to ? '' : `, as "${held}"`}`,
      `${changeText}, and the schema being planned from already has column "${held}" on table "${table}"${holders.length === 0 ? '' : `, the column of ${fieldsText(holders)}`}. Without the rename the plan would read the ${misread(held)}. Make the change in two plans: first remove column "${held}" or give it a name nothing uses, and plan and apply that; then make this change and plan again.`,
      location,
    );
  }
  const takes = others.find((other) => hasStatement(other) && sameName(other.to, change.from));
  if (takes !== undefined) {
    return contractChangeRefused(
      `${label}: another rename in the same plan takes column name "${takes.to}"`,
      `${changeText}, and ${columnChangeText(takes)}. ${ORDER}. ${TEMPORARY_NAMES_ROUTE}`,
      location,
    );
  }
  return undefined;
}

/** The table and column renames a plan makes, those its statements ask for and those it makes for names both contracts keep. */
export interface PlannedStorageRenames {
  readonly tables: readonly TableChange[];
  readonly columns: readonly ColumnChange[];
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
    const conflict = tableRenameConflict(change, planned.tables, tables, renames);
    if (conflict !== undefined) return conflict;
  }
  for (const change of planned.columns) {
    if (hasStatement(change)) continue;
    const conflict = columnRenameConflict(change, planned.columns, tables, renames);
    if (conflict !== undefined) return conflict;
  }
  return undefined;
}

/**
 * The renames the plan makes: every change a statement asks for, and each change no statement
 * asks for whose whole table or column moves, whose control policy is `managed` in both
 * contracts, and whose table and column the schema being planned from has. A column change on a
 * table that changes needs the table change planned.
 */
export function plannedStorageRenames(
  renames: StorageRenames,
  tables: SchemaTables,
): PlannedStorageRenames {
  const plannedTables = renames.tableChanges.filter(
    (change) =>
      hasStatement(change) ||
      (renames.namespaceAfterRenames(change.origin.namespaceId) ===
        change.destination.namespaceId &&
        renames.managedOnBothSides(change) &&
        tables.hasTable(change.origin.namespaceId, change.origin.table) &&
        renames.sharedTable(change) === undefined),
  );
  const tableMoves = (change: ColumnChange) =>
    renames.inPlace(change.origin, change.destination) ||
    plannedTables.some(
      (table) =>
        sameTable(table.origin, change.origin) && sameTable(table.destination, change.destination),
    );
  const plannedColumns = renames.columnChanges.filter(
    (change) =>
      hasStatement(change) ||
      (tableMoves(change) &&
        renames.managedOnBothSides(change) &&
        tables.hasColumn(change.origin.namespaceId, change.origin.table, change.from) &&
        renames.sharedColumn(change) === undefined),
  );
  return { tables: plannedTables, columns: plannedColumns };
}
