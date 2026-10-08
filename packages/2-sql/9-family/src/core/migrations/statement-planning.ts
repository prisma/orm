import type { Contract, ContractWithDomain, ModelStorageBase } from '@internal/contract/types';
import {
  type AppliedMigrationStatement,
  describeMigrationStatement,
  type FieldCoordinate,
  type MigrationOperationClass,
  type MigrationOperationPolicy,
  type ModelCoordinate,
  modelDisplayName,
  type ResolvedFieldRenameStatement,
  type ResolvedMigrationStatement,
  type ResolvedModelRenameStatement,
} from '@internal/framework-components/control';
import { type SqlModelStorage, type SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { notOk, ok, type Result } from '@internal/utils/result';
import { controlPolicyForCall } from './control-policy';
import {
  type ColumnRename,
  type ColumnRenameMismatch,
  checkColumnRename,
  columnRenameMismatchReason,
} from './resolve-column-rename';
import {
  checkTableRename,
  type TableRename,
  type TableRenameMismatch,
  tableRenameMismatchReason,
} from './resolve-table-rename';
import type { SchemaTables } from './schema-tables';
import type { SqlPlannerConflict } from './types';

/** Where a model's rows live: a table in a storage namespace. */
export interface ModelTable {
  readonly namespaceId: string;
  readonly table: string;
}

/** What a model rename does to storage. */
export type ModelStorageEffect =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'renameTable'; readonly rename: TableRename }
  | { readonly kind: 'moveNamespace'; readonly from: ModelTable; readonly to: ModelTable };

/** What a field rename does to storage. */
export type FieldStorageEffect =
  | { readonly kind: 'unchanged' }
  | {
      readonly kind: 'renameColumn';
      /** The origin model's table, as the origin contract names it. */
      readonly table: ModelTable;
      readonly from: string;
      readonly to: string;
    };

/** A model the contract stores in no table, so a statement on it has no storage effect. */
export interface NoTable {
  readonly kind: 'noTable';
  readonly model: ModelCoordinate;
}

/** A field stored in a column on one side of a statement only, which no rename can map. */
export interface ColumnOnOneSide {
  readonly kind: 'columnOnOneSide';
}

/** Whether a model's storage names a table, as a model a SQL contract stores in a table does. */
export function isSqlModelStorage(storage: ModelStorageBase): storage is SqlModelStorage {
  return (
    typeof storage['table'] === 'string' &&
    typeof storage['namespaceId'] === 'string' &&
    typeof storage['fields'] === 'object' &&
    storage['fields'] !== null
  );
}

/** The storage of a model the contract stores in a table, or `undefined` for any other model. */
function sqlModelStorage(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): SqlModelStorage | undefined {
  const storage =
    contract.domain.namespaces[coordinate.namespaceId]?.models[coordinate.model]?.storage;
  return storage !== undefined && isSqlModelStorage(storage) ? storage : undefined;
}

function modelTable(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): ModelTable | undefined {
  const storage = sqlModelStorage(contract, coordinate);
  return storage === undefined
    ? undefined
    : { namespaceId: storage.namespaceId, table: storage.table };
}

/**
 * The storage effect of a model rename: the origin model's table compared with the destination
 * model's. Equal tables mean the rename needs no storage change.
 */
export function modelRenameStorageEffect(
  statement: ResolvedModelRenameStatement,
  fromContract: ContractWithDomain,
  contract: ContractWithDomain,
): Result<ModelStorageEffect, NoTable> {
  const from = modelTable(fromContract, statement.from);
  if (from === undefined) return notOk({ kind: 'noTable', model: statement.from });
  const to = modelTable(contract, statement.to);
  if (to === undefined) return notOk({ kind: 'noTable', model: statement.to });
  if (from.namespaceId !== to.namespaceId) return ok({ kind: 'moveNamespace', from, to });
  if (from.table === to.table) return ok({ kind: 'unchanged' });
  return ok({
    kind: 'renameTable',
    rename: { namespaceId: from.namespaceId, from: from.table, to: to.table },
  });
}

function fieldColumn(
  contract: ContractWithDomain,
  coordinate: FieldCoordinate,
): string | undefined {
  const fields = sqlModelStorage(contract, coordinate)?.fields;
  return fields !== undefined && Object.hasOwn(fields, coordinate.field)
    ? fields[coordinate.field]?.column
    : undefined;
}

/**
 * The storage effect of a field rename: the origin field's column compared with the destination
 * field's. A relation field has no column on either side, and equal columns need no change.
 */
export function fieldRenameStorageEffect(
  statement: ResolvedFieldRenameStatement,
  fromContract: ContractWithDomain,
  contract: ContractWithDomain,
): Result<FieldStorageEffect, NoTable | ColumnOnOneSide> {
  const table = modelTable(fromContract, statement.from);
  if (table === undefined) return notOk({ kind: 'noTable', model: statement.from });
  const from = fieldColumn(fromContract, statement.from);
  const to = fieldColumn(contract, statement.to);
  if (from === undefined && to === undefined) return ok({ kind: 'unchanged' });
  if (from === undefined || to === undefined) return notOk({ kind: 'columnOnOneSide' });
  if (from === to) return ok({ kind: 'unchanged' });
  return ok({ kind: 'renameColumn', table, from, to });
}

/** A call that lowers to one operation, such as a companion of a rename. */
export interface SingleOperationCall {
  readonly operationClass: MigrationOperationClass;
}

/**
 * A call that lowers to its own operation, then each companion's, in that order: a table or column
 * rename, whether a statement plans it or a hand-written migration calls it.
 */
export interface CallWithCompanions extends SingleOperationCall {
  readonly companions: readonly SingleOperationCall[];
}

/** What a target supplies for planning statements against its working schema. */
export interface StatementPlanningTarget<TCall extends CallWithCompanions> {
  /** The tables of the working schema as earlier statements have left it. */
  tables(): SchemaTables;
  /** The call that renames a table, with its companions, computed against the working schema. */
  renameTableCall(rename: TableRename): TCall;
  /** The call that renames a column, with its companions, computed against the working schema. */
  renameColumnCall(rename: ColumnRename): TCall;
  /** Applies a call to the working schema. */
  apply(call: TCall): void;
  /** The `renameTable` call a user writes in `migration.ts` to make `rename` by hand. */
  renderTableRename(rename: TableRename): string;
  /** The SQL statements a user runs against the database to make `rename` by hand. */
  tableRenameByHand(rename: TableRename): readonly string[];
}

function operationsOf(call: CallWithCompanions): readonly SingleOperationCall[] {
  return [call, ...call.companions];
}

export interface PlannedStatements<TCall extends CallWithCompanions> {
  /**
   * The calls, which a target puts first in its plan: each statement's `operationIndexes` count
   * from the first operation of the first call.
   */
  readonly calls: readonly TCall[];
  readonly tableRenames: readonly TableRename[];
  readonly columnRenames: readonly ColumnRename[];
  readonly appliedStatements: readonly AppliedMigrationStatement[];
}

interface ConflictLocation extends ModelTable {
  readonly column?: string;
}

const DRIFTED =
  'so the database has drifted from that contract. Inspect it with prisma db schema, or leave out this statement.';

const UNMATCHED =
  'A statement plans the rename a hand-written rename call makes, and that call does not match the contracts. Leave out this statement.';

function statementRefused(
  statement: ResolvedMigrationStatement,
  summary: string,
  why: string,
  location: ConflictLocation | undefined,
  refusedOperationClass?: MigrationOperationClass,
): SqlPlannerConflict {
  return {
    kind: 'statementRefused',
    summary,
    why,
    refusedStatement: statement,
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

function tableControlPolicy(contract: Contract<SqlStorage>, table: ModelTable) {
  const node = contract.storage.namespaces[table.namespaceId]?.entries.table?.[table.table];
  return controlPolicyForCall(
    {
      namespaceId: table.namespaceId,
      entityKind: 'table',
      entityName: table.table,
      ...(StorageTable.is(node) && node.control !== undefined
        ? { explicitNodeControlPolicy: node.control }
        : {}),
      createsNewObject: false,
    },
    contract.defaultControlPolicy,
  );
}

function tableKey(table: ModelTable): string {
  return JSON.stringify([table.namespaceId, table.table]);
}

function tableRenameRefused(
  statement: ResolvedMigrationStatement,
  label: string,
  rename: TableRename,
  mismatch: TableRenameMismatch,
): SqlPlannerConflict {
  switch (mismatch.kind) {
    case 'tableMissing':
      return statementRefused(
        statement,
        `${label}: the schema being planned from has no table "${rename.from}"`,
        `The database has no table "${rename.from}", although the contract it was last updated to names it, ${DRIFTED}`,
        { namespaceId: rename.namespaceId, table: rename.from },
      );
    case 'nameTaken':
      return statementRefused(
        statement,
        `${label}: the schema being planned from already has a table "${rename.to}"${mismatch.taken === rename.to ? '' : `, as "${mismatch.taken}"`}`,
        `A rename cannot replace a table that already exists. Rename or drop table "${mismatch.taken}" first, or leave out this statement.`,
        { namespaceId: rename.namespaceId, table: rename.to },
      );
    case 'tableInManyNamespaces':
    case 'notInEndContract':
      return statementRefused(
        statement,
        `${label}: ${tableRenameMismatchReason(rename, mismatch)}`,
        UNMATCHED,
        { namespaceId: rename.namespaceId, table: rename.from },
      );
  }
}

function columnRenameRefused(
  statement: ResolvedMigrationStatement,
  label: string,
  rename: ColumnRename,
  mismatch: ColumnRenameMismatch,
): SqlPlannerConflict {
  const table = { namespaceId: rename.namespaceId, table: rename.table };
  switch (mismatch.kind) {
    case 'tableMissing':
      return statementRefused(
        statement,
        `${label}: the schema being planned from has no table "${rename.table}"`,
        `The database has no table "${rename.table}", although the contract it was last updated to names it, ${DRIFTED}`,
        table,
      );
    case 'columnMissing':
      return statementRefused(
        statement,
        `${label}: the schema being planned from has no column "${rename.from}" on table "${rename.table}"`,
        `The database has no column "${rename.from}" on table "${rename.table}", although the contract it was last updated to names it, ${DRIFTED}`,
        { ...table, column: rename.from },
      );
    case 'nameTaken':
      return statementRefused(
        statement,
        `${label}: the schema being planned from already has a column "${mismatch.taken}" on table "${rename.table}"`,
        `A rename cannot replace a column that already exists. Rename or drop column "${mismatch.taken}" of table "${rename.table}" first, or leave out this statement.`,
        { ...table, column: rename.to },
      );
    case 'tableInManyNamespaces':
    case 'notInEndContract':
      return statementRefused(
        statement,
        `${label}: ${columnRenameMismatchReason(rename, mismatch)}`,
        UNMATCHED,
        { ...table, column: rename.from },
      );
  }
}

class StatementPlanner<TCall extends CallWithCompanions> {
  readonly #fromContract: Contract<SqlStorage>;
  readonly #contract: Contract<SqlStorage>;
  readonly #policy: MigrationOperationPolicy;
  readonly #target: StatementPlanningTarget<TCall>;
  /** The name each table renamed so far has in the working schema, keyed by its origin name. */
  readonly #renamedTables = new Map<string, string>();
  readonly calls: TCall[] = [];
  /** How many operations the calls planned so far lower to. */
  #operationCount = 0;
  readonly tableRenames: TableRename[] = [];
  readonly columnRenames: ColumnRename[] = [];

  constructor(input: {
    readonly fromContract: Contract<SqlStorage>;
    readonly contract: Contract<SqlStorage>;
    readonly policy: MigrationOperationPolicy;
    readonly target: StatementPlanningTarget<TCall>;
  }) {
    this.#fromContract = input.fromContract;
    this.#contract = input.contract;
    this.#policy = input.policy;
    this.#target = input.target;
  }

  /** Plans one statement; the result is the positions of the operations it accounts for. */
  plan(statement: ResolvedMigrationStatement): Result<readonly number[], SqlPlannerConflict> {
    return statement.entity === 'model' ? this.#planModel(statement) : this.#planField(statement);
  }

  #controlPolicyRefusal(
    statement: ResolvedMigrationStatement,
    label: string,
    destinationTable: ModelTable,
  ): SqlPlannerConflict | undefined {
    const controlPolicy = tableControlPolicy(this.#contract, destinationTable);
    if (controlPolicy === 'managed') return undefined;
    return statementRefused(
      statement,
      `${label}: the table's control policy is "${controlPolicy}"`,
      `Statements rename only tables, and columns of tables, whose control policy is "managed"; table "${destinationTable.table}" is "${controlPolicy}". Make the change in the database yourself and leave out this statement.`,
      destinationTable,
    );
  }

  #emit(
    statement: ResolvedMigrationStatement,
    label: string,
    location: ConflictLocation,
    call: TCall,
  ): Result<readonly number[], SqlPlannerConflict> {
    const refused = operationsOf(call)
      .map((operation) => operation.operationClass)
      .find((operationClass) => !this.#policy.allowedOperationClasses.includes(operationClass));
    if (refused !== undefined) {
      return notOk(
        statementRefused(
          statement,
          `${label}: the plan does not allow "${refused}" operations`,
          `The rename produces a "${refused}" operation, and this command plans only ${this.#policy.allowedOperationClasses.map((c) => `"${c}"`).join(', ')} operations. Leave out this statement, or make the change with a command that allows "${refused}" operations, such as migration plan.`,
          location,
          refused,
        ),
      );
    }
    this.#target.apply(call);
    this.calls.push(call);
    const first = this.#operationCount;
    this.#operationCount += operationsOf(call).length;
    return ok(operationsOf(call).map((_, offset) => first + offset));
  }

  #planModel(
    statement: ResolvedModelRenameStatement,
  ): Result<readonly number[], SqlPlannerConflict> {
    const worked = modelRenameStorageEffect(statement, this.#fromContract, this.#contract);
    if (!worked.ok) {
      return notOk(
        statementRefused(
          statement,
          `Model "${modelDisplayName(worked.failure.model)}" has no table in its contract`,
          `A model rename renames the model's table, and model "${modelDisplayName(worked.failure.model)}" has none in its contract. Leave out this statement.`,
          undefined,
        ),
      );
    }
    const effect = worked.value;
    if (effect.kind === 'unchanged') return ok([]);
    if (effect.kind === 'moveNamespace') {
      return notOk(
        statementRefused(
          statement,
          `Moving a model to another namespace is not supported in this release: "${modelDisplayName(statement.from)}" to "${modelDisplayName(statement.to)}"`,
          `The model's table would move from namespace "${effect.from.namespaceId}" to namespace "${effect.to.namespaceId}". Leave out this statement and move the table yourself in a hand-written migration, or keep the model in namespace "${effect.from.namespaceId}".`,
          effect.from,
        ),
      );
    }
    const { rename } = effect;
    const destinationTable = { namespaceId: rename.namespaceId, table: rename.to };
    const label = `Cannot rename table "${rename.from}" to "${rename.to}"`;
    const policyRefusal = this.#controlPolicyRefusal(statement, label, destinationTable);
    if (policyRefusal !== undefined) return notOk(policyRefusal);
    const checked = checkTableRename(this.#target.tables(), this.#contract, rename);
    if (!checked.ok) {
      return notOk(tableRenameRefused(statement, label, rename, checked.failure));
    }
    const planned = this.#emit(
      statement,
      label,
      destinationTable,
      this.#target.renameTableCall(rename),
    );
    if (planned.ok) {
      this.tableRenames.push(rename);
      this.#renamedTables.set(
        tableKey({ namespaceId: rename.namespaceId, table: rename.from }),
        rename.to,
      );
    }
    return planned;
  }

  #planField(
    statement: ResolvedFieldRenameStatement,
  ): Result<readonly number[], SqlPlannerConflict> {
    const worked = fieldRenameStorageEffect(statement, this.#fromContract, this.#contract);
    if (!worked.ok && worked.failure.kind === 'noTable') {
      return notOk(
        statementRefused(
          statement,
          `Model "${modelDisplayName(worked.failure.model)}" has no table in its contract`,
          `A field rename renames the field's column, and model "${modelDisplayName(worked.failure.model)}" has no table in its contract. Leave out this statement.`,
          undefined,
        ),
      );
    }
    if (!worked.ok) {
      return notOk(
        statementRefused(
          statement,
          `Field "${modelDisplayName(statement.from)}.${statement.from.field}" has a column on one side only of ${describeMigrationStatement(statement, this.#fromContract, this.#contract)}`,
          'A field rename renames a column or changes nothing in storage, and this field gains or loses its column. Leave out this statement and plan the change without it.',
          undefined,
        ),
      );
    }
    const effect = worked.value;
    if (effect.kind === 'unchanged') return ok([]);
    const table = this.#renamedTables.get(tableKey(effect.table)) ?? effect.table.table;
    const destinationTable = modelTable(this.#contract, statement.to);
    if (
      destinationTable !== undefined &&
      (destinationTable.namespaceId !== effect.table.namespaceId ||
        destinationTable.table !== table)
    ) {
      const tableRename = {
        namespaceId: effect.table.namespaceId,
        from: table,
        to: destinationTable.table,
      };
      const model = modelDisplayName(statement.to);
      const fieldText = `${model}.${statement.from.field}:${model}.${statement.to.field}`;
      return notOk(
        statementRefused(
          statement,
          `Cannot rename column "${table}"."${effect.from}": the model's table changes from "${table}" to "${destinationTable.table}", and no statement renames the table`,
          `The column would be renamed on a table the plan then drops and creates under the new name, and a migration that only changes the table name is planned the same way. With migration plan, rename the table by hand in its own migration first. Change the contract so that only the table name changes, and run prisma contract emit. Run prisma migration new --name <name> --from <hash of the migration the database is at>, add ${this.#target.renderTableRename(tableRename)} to the operations of its migration.ts, and run node on that migration.ts to write its ops.json. Then change the contract to its final form, emit it, and plan the field rename with --from that migration. With db update, change the contract so that only the table name changes, and run prisma contract emit. Rename the table in the database yourself with ${this.#target.tableRenameByHand(tableRename).join('; ')}, check that prisma db update --dry-run plans no drop of a table or column, and run prisma db update to store that contract. Then emit the final contract and run prisma db update --rename ${fieldText}.`,
          { namespaceId: effect.table.namespaceId, table, column: effect.from },
        ),
      );
    }
    const rename: ColumnRename = {
      namespaceId: effect.table.namespaceId,
      table,
      from: effect.from,
      to: effect.to,
    };
    const tableLocation = { namespaceId: rename.namespaceId, table };
    const label = `Cannot rename column "${table}"."${rename.from}" to "${rename.to}"`;
    const policyRefusal = this.#controlPolicyRefusal(statement, label, tableLocation);
    if (policyRefusal !== undefined) return notOk(policyRefusal);
    const checked = checkColumnRename(this.#target.tables(), this.#contract, rename);
    if (!checked.ok) {
      return notOk(columnRenameRefused(statement, label, rename, checked.failure));
    }
    const planned = this.#emit(
      statement,
      label,
      { ...tableLocation, column: rename.from },
      this.#target.renameColumnCall(rename),
    );
    if (planned.ok) this.columnRenames.push(rename);
    return planned;
  }
}

/**
 * Plans the statements in order against a target's working schema: each model rename becomes a
 * table rename and each field rename a column rename, computed against the schema earlier
 * statements left, then applied to it. The first statement that cannot be planned fails the whole
 * plan with a `statementRefused` conflict that carries the statement.
 */
export function planStatements<TCall extends CallWithCompanions>(input: {
  readonly statements: readonly ResolvedMigrationStatement[];
  readonly fromContract: Contract<SqlStorage> | null;
  readonly contract: Contract<SqlStorage>;
  readonly policy: MigrationOperationPolicy;
  readonly target: StatementPlanningTarget<TCall>;
}): Result<PlannedStatements<TCall>, SqlPlannerConflict> {
  const { fromContract } = input;
  const [first] = input.statements;
  if (first === undefined) {
    return ok({ calls: [], tableRenames: [], columnRenames: [], appliedStatements: [] });
  }
  if (fromContract === null) {
    return notOk(
      statementRefused(
        first,
        'Statements need an origin contract, and this plan has none',
        'A statement names models and fields of the origin contract, and this plan has none. Plan from a contract that has the old names, or leave out the statement.',
        undefined,
      ),
    );
  }
  const planner = new StatementPlanner({ ...input, fromContract });
  const appliedStatements: AppliedMigrationStatement[] = [];
  for (const statement of input.statements) {
    const operationIndexes = planner.plan(statement);
    if (!operationIndexes.ok) return operationIndexes;
    appliedStatements.push({ statement, operationIndexes: operationIndexes.value });
  }
  return ok({
    calls: planner.calls,
    tableRenames: planner.tableRenames,
    columnRenames: planner.columnRenames,
    appliedStatements,
  });
}
