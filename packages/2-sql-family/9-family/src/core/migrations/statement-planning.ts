import type { Contract, ContractWithDomain } from '@internal/contract/types';
import {
  type AppliedMigrationStatement,
  describeMigrationStatement,
  type FieldCoordinate,
  fieldStatementText,
  type MigrationOperationClass,
  type MigrationOperationPolicy,
  type ModelCoordinate,
  modelDisplayName,
  type ResolvedFieldRenameStatement,
  type ResolvedMigrationStatement,
  type ResolvedModelRenameStatement,
  type ResolvedNamespaceRenameStatement,
  type ResolvedRenameStatement,
  type SchemaOwnership,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { notOk, ok, type Result } from '@internal/utils/result';
import { handWrittenMigrationSteps } from './hand-written-migration';
import {
  fieldColumn,
  type ModelTable,
  modelTable,
  sameTable,
  sqlModelStorage,
  tableControlPolicy,
} from './model-storage';
import { capitalized, fieldsText, modelsText } from './plan-text';
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
import {
  type ColumnChange,
  type ConflictLocation,
  columnChangeText,
  plannedStorageRenames,
  renameRefused,
  StorageRenames,
  storageRenameConflict,
  type TableChange,
  tableChangeText,
} from './storage-renames';
import type { SqlPlannerConflict } from './types';

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
 * rename, whether a statement plans it or a hand-written migration calls it. A table move has none.
 */
export interface CallWithCompanions extends SingleOperationCall {
  readonly companions: readonly SingleOperationCall[];
}

/** A namespace renamed: `from` names it in the origin contract and `to` in the destination. */
export interface NamespaceRename {
  readonly from: string;
  readonly to: string;
}

/** Why a target cannot carry out a statement, in its words. */
export interface TargetRefusal {
  readonly reason: string;
  readonly fix: string;
}

/** A table moving, under its own name, from one storage namespace to another. */
export interface TableMove {
  readonly table: string;
  readonly from: string;
  readonly to: string;
}

/** How a user renames a table by hand, written for the target. */
export interface TableRenameByHand {
  /** The `renameTable` call a user writes in `migration.ts` to make `rename` by hand. */
  renderTableRename(rename: TableRename): string;
  /** The SQL statements a user runs against the database to make `rename` by hand. */
  tableRenameByHand(rename: TableRename): readonly string[];
}

/** What a target with several namespaces supplies for namespace renames and model moves. */
export interface NamespaceStatementTarget<TCall extends CallWithCompanions> {
  /**
   * The calls a table moving into `namespaceId` needs first, such as creating the namespace: none
   * when the working schema has it.
   */
  createNamespaceCalls(namespaceId: string): readonly TCall[];
  /** The call that moves a table to another namespace, computed against the working schema. */
  moveTableCall(move: TableMove): TCall;
  /** Why the target cannot rename the namespace, or `undefined` when it can. */
  namespaceRenameRefusal(rename: NamespaceRename): TargetRefusal | undefined;
  /** The call that renames a namespace, computed against the working schema. */
  renameNamespaceCall(rename: NamespaceRename): TCall;
}

/** What a target supplies for planning statements against its working schema. */
export interface StatementPlanningTarget<TCall extends CallWithCompanions> {
  /** The tables of the working schema as earlier statements have left it. */
  tables(): SchemaTables;
  /** The call that renames a table, with its companions, computed against the working schema. */
  renameTableCall(rename: TableRename): TCall;
  /** Namespace renames and model moves; a target that keeps every table in one namespace has none. */
  readonly namespaces?: NamespaceStatementTarget<TCall> | undefined;
  /** The call that renames a column, with its companions, computed against the working schema. */
  renameColumnCall(rename: ColumnRename): TCall;
  /** Applies a call to the working schema. */
  apply(call: TCall): void;
}

function operationsOf(call: CallWithCompanions): readonly SingleOperationCall[] {
  return [call, ...call.companions];
}

/**
 * Where a table or column of the working schema came from in the origin contract, after the
 * statements' renames and moves: the statement planner records it, and the questions name a
 * subject through it.
 */
export interface WorkingSchemaOrigins {
  /** The origin place of a table of the working schema. */
  originTable(current: ModelTable): ModelTable;
  /** The origin name of a column, now named `column`, of the origin table `origin`. */
  originColumn(origin: ModelTable, column: string): string;
}

/** The origins of a plan whose statements renamed and moved nothing. */
export const NO_RENAMED_ORIGINS: WorkingSchemaOrigins = {
  originTable: (current) => current,
  originColumn: (_origin, column) => column,
};

/**
 * The operations a statement accounts for: `planned` among the statement planner's calls, or
 * `plannedWithDiff`, which the target plans with the diff and whose positions it fills in.
 */
export type StatementOperations =
  | { readonly kind: 'planned'; readonly operationIndexes: readonly number[] }
  | { readonly kind: 'plannedWithDiff' };

export interface PlannedStatement {
  readonly statement: ResolvedMigrationStatement;
  readonly operations: StatementOperations;
}

const PLANNED_WITH_DIFF: StatementOperations = { kind: 'plannedWithDiff' };

function plannedAt(operationIndexes: readonly number[]): StatementOperations {
  return { kind: 'planned', operationIndexes };
}

export interface PlannedStatements<TCall extends CallWithCompanions> {
  /**
   * The calls, which a target puts first in its plan: each planned statement's `operationIndexes`
   * count from the first operation of the first call.
   */
  readonly calls: readonly TCall[];
  readonly tableRenames: readonly TableRename[];
  readonly columnRenames: readonly ColumnRename[];
  /**
   * The tables whose model keeps its name and whose new table the working schema already has, so
   * the rename is already done and none is planned: the diff renames their constraints, which a
   * target puts before creates.
   */
  readonly alreadyRenamedTables: readonly ModelTable[];
  readonly plannedStatements: readonly PlannedStatement[];
  readonly origins: WorkingSchemaOrigins;
  /** The renames of the plan, which the questions read too; `undefined` with no origin contract. */
  readonly storageRenames: StorageRenames | undefined;
}

const DRIFTED =
  'so the database has drifted from that contract. Inspect it with prisma db schema, or leave out this statement.';

const UNMATCHED =
  'A statement plans the rename a hand-written rename call makes, and that call does not match the contracts. Leave out this statement.';

function leaveOutShared(moving: string): string {
  return `Leave out this statement to plan the change without moving them: the plan then asks about the data it drops. A question about ${moving} offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data.`;
}

const HAND_WRITTEN_WITH_MIGRATION_PLAN =
  'To keep the data with migration plan, write this change as a hand-written migration instead: ';

function tableKey(table: ModelTable): string {
  return JSON.stringify([table.namespaceId, table.table]);
}

/** The contract space planned, and the oracle that says which spaces declare a namespace. */
export interface StatementOwnership {
  readonly oracle: SchemaOwnership | undefined;
  readonly spaceId: string;
}

/** A contract space other than the one planned that declares the namespace, if any. */
export function otherSpaceDeclaring(
  ownership: StatementOwnership,
  namespaceId: string,
): string | undefined {
  return (ownership.oracle?.namespaceDeclaringSpaces(namespaceId) ?? []).find(
    (spaceId) => spaceId !== ownership.spaceId,
  );
}

function withoutNamespacesRefused(
  statement: ResolvedMigrationStatement,
  label: string,
): SqlPlannerConflict {
  return renameRefused(
    statement,
    `${label}: the database target keeps every table in one namespace`,
    'This database target has no namespaces, so a statement cannot rename a namespace or move a model to another one. Leave out this statement.',
    undefined,
  );
}

function namespaceText(namespaceId: string): string {
  return namespaceId === UNBOUND_NAMESPACE_ID
    ? 'the unbound namespace'
    : `namespace "${namespaceId}"`;
}

function qualifiedTable(table: ModelTable): string {
  return table.namespaceId === UNBOUND_NAMESPACE_ID
    ? table.table
    : `${table.namespaceId}.${table.table}`;
}

function tableRenameRefused(
  statement: ResolvedMigrationStatement,
  label: string,
  rename: TableRename,
  mismatch: TableRenameMismatch,
): SqlPlannerConflict {
  switch (mismatch.kind) {
    case 'tableMissing':
      return renameRefused(
        statement,
        `${label}: the schema being planned from has no table "${rename.from}"`,
        `The database has no table "${rename.from}", although the contract it was last updated to names it, ${DRIFTED}`,
        { namespaceId: rename.namespaceId, table: rename.from },
      );
    case 'nameTaken':
      return renameRefused(
        statement,
        `${label}: the schema being planned from already has a table "${rename.to}"${mismatch.taken === rename.to ? '' : `, as "${mismatch.taken}"`}`,
        `A rename cannot replace a table that already exists. Rename or drop table "${mismatch.taken}" first, or leave out this statement.`,
        { namespaceId: rename.namespaceId, table: rename.to },
      );
    case 'tableInManyNamespaces':
    case 'notInEndContract':
      return renameRefused(
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
      return renameRefused(
        statement,
        `${label}: the schema being planned from has no table "${rename.table}"`,
        `The database has no table "${rename.table}", although the contract it was last updated to names it, ${DRIFTED}`,
        table,
      );
    case 'columnMissing':
      return renameRefused(
        statement,
        `${label}: the schema being planned from has no column "${rename.from}" on table "${rename.table}"`,
        `The database has no column "${rename.from}" on table "${rename.table}", although the contract it was last updated to names it, ${DRIFTED}`,
        { ...table, column: rename.from },
      );
    case 'nameTaken':
      return renameRefused(
        statement,
        `${label}: the schema being planned from already has a column "${mismatch.taken}" on table "${rename.table}"`,
        `A rename cannot replace a column that already exists. Rename or drop column "${mismatch.taken}" of table "${rename.table}" first, or leave out this statement.`,
        { ...table, column: rename.to },
      );
    case 'tableInManyNamespaces':
    case 'notInEndContract':
      return renameRefused(
        statement,
        `${label}: ${columnRenameMismatchReason(rename, mismatch)}`,
        UNMATCHED,
        { ...table, column: rename.from },
      );
  }
}

/** What asks for a rename: a statement, or the contract change it follows when no statement does. */
type RenameSource =
  | { readonly statement: ResolvedMigrationStatement }
  | { readonly statement: undefined; readonly change: string };

function planned(
  operationIndexes: Result<readonly number[], SqlPlannerConflict>,
): Result<StatementOperations, SqlPlannerConflict> {
  return operationIndexes.ok ? ok(plannedAt(operationIndexes.value)) : operationIndexes;
}

class StatementPlanner<TCall extends CallWithCompanions> {
  readonly #fromContract: Contract<SqlStorage>;
  readonly #contract: Contract<SqlStorage>;
  readonly #policy: MigrationOperationPolicy;
  readonly #target: StatementPlanningTarget<TCall>;
  /** Where each table renamed or moved so far is in the working schema, keyed by its origin place. */
  readonly #renamedTables = new Map<string, ModelTable>();
  /** The origin place of each table renamed or moved so far, keyed as `#renamedTables`. */
  readonly #originTables = new Map<string, ModelTable>();
  /** Each column renamed so far, keyed by its origin table and origin name: its name now. */
  readonly #renamedColumns = new Map<
    string,
    { readonly origin: ModelTable; readonly from: string; readonly to: string }
  >();
  /** The name each namespace renamed so far has in the working schema, keyed by its origin name. */
  readonly #renamedNamespaces = new Map<string, string>();
  readonly #ownership: StatementOwnership | undefined;
  readonly #storageRenames: StorageRenames;
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
    readonly ownership: StatementOwnership | undefined;
    readonly storageRenames: StorageRenames;
  }) {
    this.#fromContract = input.fromContract;
    this.#contract = input.contract;
    this.#policy = input.policy;
    this.#target = input.target;
    this.#ownership = input.ownership;
    this.#storageRenames = input.storageRenames;
  }

  /** Renames a table no statement asks for, where it is in the working schema now. */
  planTableChange(change: TableChange): Result<readonly number[], SqlPlannerConflict> {
    const current = this.#current(change.origin);
    return this.#renameTable(
      { statement: undefined, change: tableChangeText(change) },
      `Cannot rename table "${current.table}" to "${change.destination.table}"`,
      change.origin,
      { namespaceId: current.namespaceId, from: current.table, to: change.destination.table },
    );
  }

  /** Renames a column no statement asks for, as the working schema has it and its table now. */
  planColumnChange(change: ColumnChange): Result<readonly number[], SqlPlannerConflict> {
    const current = this.#current(change.origin);
    const from = this.#currentColumn(change.origin, change.from);
    return this.#renameColumn(
      { statement: undefined, change: columnChangeText(change) },
      `Cannot rename column "${current.table}"."${from}" to "${change.to}"`,
      change.origin,
      change.from,
      { namespaceId: current.namespaceId, table: current.table, from, to: change.to },
    );
  }

  /**
   * Records that the working schema has the table of a change no statement asks for as `table`:
   * later renames and questions find it there, as after a planned rename.
   */
  recordTableFound(change: TableChange, table: string): Result<readonly number[], never> {
    const current = this.#current(change.origin);
    this.#renamedTables.set(tableKey(change.origin), { namespaceId: current.namespaceId, table });
    this.#originTables.set(tableKey(change.origin), change.origin);
    return ok([]);
  }

  /** Records that the working schema has the column of a change no statement asks for as `column`. */
  recordColumnFound(change: ColumnChange, column: string): Result<readonly number[], never> {
    this.#recordColumn(change.origin, change.from, column);
    return ok([]);
  }

  /** Plans one statement; the result is the operations it accounts for. */
  plan(statement: ResolvedRenameStatement): Result<StatementOperations, SqlPlannerConflict> {
    switch (statement.entity) {
      case 'namespace':
        return planned(this.#planNamespace(statement));
      case 'model':
        return planned(this.#planModel(statement));
      case 'field':
        return planned(this.#planField(statement));
      case 'enumValue':
      case 'valueObjectField':
        return ok(PLANNED_WITH_DIFF);
    }
  }

  #recordColumn(origin: ModelTable, from: string, to: string): void {
    this.#renamedColumns.set(JSON.stringify([tableKey(origin), from]), { origin, from, to });
  }

  /** The name a column of an origin table has in the working schema, after the renames planned so far. */
  #currentColumn(origin: ModelTable, column: string): string {
    return this.#renamedColumns.get(JSON.stringify([tableKey(origin), column]))?.to ?? column;
  }

  /** Where a table of the origin is in the working schema, after the renames planned so far. */
  #current(origin: ModelTable): ModelTable {
    const table = this.#renamedTables.get(tableKey(origin)) ?? origin;
    return {
      namespaceId: this.#renamedNamespaces.get(table.namespaceId) ?? table.namespaceId,
      table: table.table,
    };
  }

  #planNamespace(
    statement: ResolvedNamespaceRenameStatement,
  ): Result<readonly number[], SqlPlannerConflict> {
    const rename = { from: statement.from, to: statement.to };
    const label = `Cannot rename namespace "${rename.from}" to "${rename.to}"`;
    const namespaces = this.#target.namespaces;
    if (namespaces === undefined) return notOk(withoutNamespacesRefused(statement, label));
    const movePerModel = `--rename ${rename.from}.<Model>:${rename.to}.<Model>`;
    const refusal = namespaces.namespaceRenameRefusal(rename);
    if (refusal !== undefined) {
      return notOk(renameRefused(statement, `${label}: ${refusal.reason}`, refusal.fix, undefined));
    }
    const otherSpace =
      this.#ownership === undefined ? undefined : otherSpaceDeclaring(this.#ownership, rename.from);
    if (otherSpace !== undefined) {
      return notOk(
        renameRefused(
          statement,
          `${label}: contract space "${otherSpace}" also declares it`,
          `Renaming the namespace would rename it under contract space "${otherSpace}" too, whose contract still names it "${rename.from}". Leave out this statement, or move each model with ${movePerModel} instead.`,
          undefined,
        ),
      );
    }
    const tables = Object.keys(this.#contract.storage.namespaces[rename.to]?.entries.table ?? {});
    for (const table of tables) {
      const controlPolicy = tableControlPolicy(this.#contract, { namespaceId: rename.to, table });
      if (controlPolicy === 'managed') continue;
      return notOk(
        renameRefused(
          statement,
          `${label}: table "${table}" has control policy "${controlPolicy}"`,
          `Statements rename only namespaces whose tables all have control policy "managed"; table "${table}" is "${controlPolicy}". Make the change in the database yourself and leave out this statement.`,
          { namespaceId: rename.to, table },
        ),
      );
    }
    const schemaTables = this.#target.tables();
    if (!schemaTables.hasNamespace(rename.from)) {
      return notOk(
        renameRefused(
          statement,
          `${label}: the schema being planned from has no namespace "${rename.from}"`,
          `The database has no namespace "${rename.from}", although the contract it was last updated to names it, ${DRIFTED}`,
          undefined,
        ),
      );
    }
    if (schemaTables.hasNamespace(rename.to)) {
      return notOk(
        renameRefused(
          statement,
          `${label}: the database already has a namespace "${rename.to}"`,
          `The database already has a namespace "${rename.to}", which the contract it was last updated to does not declare. If it holds nothing, drop or rename it in the database yourself; otherwise move each model with ${movePerModel} instead of this statement.`,
          undefined,
        ),
      );
    }
    const planned = this.#emit(
      { statement },
      label,
      undefined,
      namespaces.renameNamespaceCall(rename),
    );
    if (planned.ok) this.#renamedNamespaces.set(rename.from, rename.to);
    return planned;
  }

  #controlPolicyRefusal(
    statement: ResolvedMigrationStatement,
    label: string,
    destinationTable: ModelTable,
  ): SqlPlannerConflict | undefined {
    const controlPolicy = tableControlPolicy(this.#contract, destinationTable);
    if (controlPolicy === 'managed') return undefined;
    return renameRefused(
      statement,
      `${label}: the table's control policy is "${controlPolicy}"`,
      `Statements rename only tables, and columns of tables, whose control policy is "managed"; table "${destinationTable.table}" is "${controlPolicy}". Make the change in the database yourself and leave out this statement.`,
      destinationTable,
    );
  }

  #emit(
    source: RenameSource,
    label: string,
    location: ConflictLocation | undefined,
    call: TCall,
  ): Result<readonly number[], SqlPlannerConflict> {
    const refused = operationsOf(call)
      .map((operation) => operation.operationClass)
      .find((operationClass) => !this.#policy.allowedOperationClasses.includes(operationClass));
    if (refused !== undefined) {
      const allowed = this.#policy.allowedOperationClasses.map((c) => `"${c}"`).join(', ');
      return notOk(
        renameRefused(
          source.statement,
          `${label}: the plan does not allow "${refused}" operations`,
          source.statement === undefined
            ? `${capitalized(source.change)}, and the rename produces a "${refused}" operation, which this command does not plan: it plans only ${allowed} operations. Make the change with a command that allows "${refused}" operations, such as db update or migration plan.`
            : `The rename produces a "${refused}" operation, and this command plans only ${allowed} operations. Leave out this statement, or make the change with a command that allows "${refused}" operations, such as migration plan.`,
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
        renameRefused(
          statement,
          `Model "${modelDisplayName(worked.failure.model)}" has no table in its contract`,
          `A model rename renames the model's table, and model "${modelDisplayName(worked.failure.model)}" has none in its contract. Leave out this statement.`,
          undefined,
        ),
      );
    }
    const effect = worked.value;
    if (effect.kind === 'unchanged') return ok([]);
    const shared = this.#sharedTableRefusal(statement);
    if (shared !== undefined) return notOk(shared);
    const [origin, destination] =
      effect.kind === 'moveNamespace'
        ? [effect.from, effect.to]
        : [
            { namespaceId: effect.rename.namespaceId, table: effect.rename.from },
            { namespaceId: effect.rename.namespaceId, table: effect.rename.to },
          ];
    const current = this.#current(origin);
    if (current.namespaceId === destination.namespaceId) {
      if (current.table === destination.table) return ok([]);
      return this.#planTableRename(statement, origin, {
        namespaceId: destination.namespaceId,
        from: current.table,
        to: destination.table,
      });
    }
    return this.#planMove(statement, origin, current, destination);
  }

  #planTableRename(
    statement: ResolvedModelRenameStatement,
    origin: ModelTable,
    rename: TableRename,
  ): Result<readonly number[], SqlPlannerConflict> {
    const destinationTable = { namespaceId: rename.namespaceId, table: rename.to };
    const label = `Cannot rename table "${rename.from}" to "${rename.to}"`;
    const policyRefusal = this.#controlPolicyRefusal(statement, label, destinationTable);
    if (policyRefusal !== undefined) return notOk(policyRefusal);
    const checked = checkTableRename(this.#target.tables(), this.#contract, rename);
    if (!checked.ok) {
      return notOk(tableRenameRefused(statement, label, rename, checked.failure));
    }
    return this.#renameTable({ statement }, label, origin, rename);
  }

  #renameTable(
    source: RenameSource,
    label: string,
    origin: ModelTable,
    rename: TableRename,
  ): Result<readonly number[], SqlPlannerConflict> {
    const destinationTable = { namespaceId: rename.namespaceId, table: rename.to };
    const planned = this.#emit(
      source,
      label,
      destinationTable,
      this.#target.renameTableCall(rename),
    );
    if (planned.ok) {
      this.tableRenames.push(rename);
      this.#renamedTables.set(tableKey(origin), destinationTable);
      this.#originTables.set(tableKey(origin), origin);
    }
    return planned;
  }

  #sharedTableRefusal(statement: ResolvedModelRenameStatement): SqlPlannerConflict | undefined {
    const rename = this.#storageRenames.models.find((model) => model.statement === statement);
    const change = rename === undefined ? undefined : this.#storageRenames.tableChangeOf(rename);
    const shared = change === undefined ? undefined : this.#storageRenames.sharedTable(change);
    if (change === undefined || shared === undefined) return undefined;
    const from = change.origin.table;
    const to = change.destination.table;
    const label = `Cannot rename table "${from}" to "${to}"`;
    const moving = change.renames.map((renamed) => renamed.from);
    const others = modelsText(shared.objects);
    return renameRefused(
      statement,
      shared.kind === 'split'
        ? `${label}: table "${from}" also stores ${others}`
        : `${label}: table "${to}" also stores ${others}, whose rows are not in table "${from}"`,
      shared.kind === 'split'
        ? `A table rename moves every row of the table, and the rows of ${others} do not move to table "${to}". Moving the rows of one model out of a table it shares with others is a data migration, which a plan does not write. ${leaveOutShared(modelsText(moving))} ${HAND_WRITTEN_WITH_MIGRATION_PLAN}${handWrittenMigrationSteps(`the rows of ${modelsText(moving)} into table "${to}"`)}`
        : `A table rename moves the rows of one table, and table "${to}" would also store the rows of ${others}. Moving the rows of two tables into one is a data migration, which a plan does not write. ${leaveOutShared(modelsText(moving))} ${HAND_WRITTEN_WITH_MIGRATION_PLAN}${handWrittenMigrationSteps(`the rows of ${modelsText(moving)}, and those of ${others} that table "${to}" does not already hold, into table "${to}"`)}`,
      change.origin,
    );
  }

  #sharedColumnRefusal(statement: ResolvedFieldRenameStatement): SqlPlannerConflict | undefined {
    const rename = this.#storageRenames.fields.find((field) => field.statement === statement);
    const change = rename === undefined ? undefined : this.#storageRenames.columnChangeOf(rename);
    const shared = change === undefined ? undefined : this.#storageRenames.sharedColumn(change);
    if (change === undefined || shared === undefined) return undefined;
    const { from, to } = change;
    const label = `Cannot rename column "${change.origin.table}"."${from}" to "${to}"`;
    const moving = change.renames.map((renamed) => renamed.from);
    const others = fieldsText(shared.objects);
    return renameRefused(
      statement,
      shared.kind === 'split'
        ? `${label}: column "${from}" also stores ${others}`
        : `${label}: column "${to}" also stores ${others}, whose values are not in column "${from}"`,
      shared.kind === 'split'
        ? `A column rename moves the values of every row, and the values of ${others} do not move to column "${to}". Moving the values of one field out of a column it shares with others is a data migration, which a plan does not write. ${leaveOutShared(fieldsText(moving))} ${HAND_WRITTEN_WITH_MIGRATION_PLAN}${handWrittenMigrationSteps(`the values of ${fieldsText(moving)} into column "${to}"`)}`
        : `A column rename moves the values of one column, and column "${to}" would also store the values of ${others}. Moving the values of two columns into one is a data migration, which a plan does not write. ${leaveOutShared(fieldsText(moving))} ${HAND_WRITTEN_WITH_MIGRATION_PLAN}${handWrittenMigrationSteps(`the values of ${fieldsText(moving)}, and those of ${others} that column "${to}" does not already hold, into column "${to}"`)}`,
      { ...change.origin, column: from },
    );
  }

  /**
   * Moves the table to the destination namespace under its own name, creating the namespace first
   * when the working schema lacks it, then renames it there when the destination names it
   * differently. The statement accounts for the move and the rename, not the namespace's creation.
   */
  #planMove(
    statement: ResolvedModelRenameStatement,
    origin: ModelTable,
    from: ModelTable,
    to: ModelTable,
  ): Result<readonly number[], SqlPlannerConflict> {
    const label = `Cannot move table "${from.table}" from ${namespaceText(from.namespaceId)} to ${namespaceText(to.namespaceId)}`;
    const namespaces = this.#target.namespaces;
    if (namespaces === undefined) return notOk(withoutNamespacesRefused(statement, label));
    if (to.namespaceId === UNBOUND_NAMESPACE_ID) {
      return notOk(
        renameRefused(
          statement,
          `Cannot move table "${from.table}" from ${namespaceText(from.namespaceId)} to the unbound namespace: the unbound namespace has no fixed place in the database`,
          `A table of the unbound namespace lives wherever the connection that uses it looks, so a migration cannot move a table there. Move the table yourself and leave out this statement, or keep the model in ${namespaceText(from.namespaceId)}.`,
          from,
        ),
      );
    }
    const moved = { namespaceId: to.namespaceId, table: from.table };
    const policyRefusal = this.#controlPolicyRefusal(statement, label, to);
    if (policyRefusal !== undefined) return notOk(policyRefusal);
    const tables = this.#target.tables();
    if (!tables.hasTable(from.namespaceId, from.table)) {
      return notOk(
        renameRefused(
          statement,
          `${label}: the schema being planned from has no table "${qualifiedTable(from)}"`,
          `The database has no table "${qualifiedTable(from)}", although the contract it was last updated to names it, ${DRIFTED}`,
          from,
        ),
      );
    }
    const [taken] = [
      ...tables.tablesNamed(to.namespaceId, from.table),
      ...tables.tablesNamed(to.namespaceId, to.table),
    ];
    if (taken !== undefined) {
      const takenTable = qualifiedTable({ namespaceId: to.namespaceId, table: taken });
      return notOk(
        renameRefused(
          statement,
          `${label}: the schema being planned from already has a table "${takenTable}"`,
          `A move cannot replace a table that already exists. Rename, move or drop table "${takenTable}" first, or leave out this statement.`,
          { namespaceId: to.namespaceId, table: taken },
        ),
      );
    }
    for (const call of namespaces.createNamespaceCalls(to.namespaceId)) {
      const created = this.#emit({ statement }, label, moved, call);
      if (!created.ok) return created;
    }
    const planned = this.#emit(
      { statement },
      label,
      moved,
      namespaces.moveTableCall({ table: from.table, from: from.namespaceId, to: to.namespaceId }),
    );
    if (!planned.ok) return planned;
    this.#renamedTables.set(tableKey(origin), moved);
    this.#originTables.set(tableKey(origin), origin);
    if (to.table === from.table) return planned;
    const renamed = this.#planTableRename(statement, origin, {
      namespaceId: to.namespaceId,
      from: from.table,
      to: to.table,
    });
    if (!renamed.ok) return renamed;
    return ok([...planned.value, ...renamed.value]);
  }

  #planField(
    statement: ResolvedFieldRenameStatement,
  ): Result<readonly number[], SqlPlannerConflict> {
    const worked = fieldRenameStorageEffect(statement, this.#fromContract, this.#contract);
    if (!worked.ok && worked.failure.kind === 'noTable') {
      return notOk(
        renameRefused(
          statement,
          `Model "${modelDisplayName(worked.failure.model)}" has no table in its contract`,
          `A field rename renames the field's column, and model "${modelDisplayName(worked.failure.model)}" has no table in its contract. Leave out this statement.`,
          undefined,
        ),
      );
    }
    if (!worked.ok) {
      return notOk(
        renameRefused(
          statement,
          `Field "${modelDisplayName(statement.from)}.${statement.from.field}" has a column on one side only of ${describeMigrationStatement(statement, this.#fromContract, this.#contract)}`,
          'A field rename renames a column or changes nothing in storage, and this field gains or loses its column. Leave out this statement and plan the change without it.',
          undefined,
        ),
      );
    }
    const effect = worked.value;
    if (effect.kind === 'unchanged') return ok([]);
    const current = this.#current(effect.table);
    const table = current.table;
    const destinationTable = modelTable(this.#contract, statement.to);
    if (destinationTable !== undefined && !sameTable(destinationTable, current)) {
      return notOk(
        renameRefused(
          statement,
          `Cannot rename column "${table}"."${effect.from}": the model's table changes from "${table}" to "${destinationTable.table}", and the plan does not rename it`,
          `The plan renames a table only when every model stored in it moves to the same new table and its control policy is "managed" in both contracts, so the column would be renamed on a table the destination does not store the model in. Leave out this statement.`,
          { namespaceId: current.namespaceId, table, column: effect.from },
        ),
      );
    }
    const rename: ColumnRename = {
      namespaceId: current.namespaceId,
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
    const shared = this.#sharedColumnRefusal(statement);
    if (shared !== undefined) return notOk(shared);
    return this.#renameColumn({ statement }, label, effect.table, effect.from, rename);
  }

  #renameColumn(
    source: RenameSource,
    label: string,
    origin: ModelTable,
    originColumn: string,
    rename: ColumnRename,
  ): Result<readonly number[], SqlPlannerConflict> {
    const planned = this.#emit(
      source,
      label,
      { namespaceId: rename.namespaceId, table: rename.table, column: rename.from },
      this.#target.renameColumnCall(rename),
    );
    if (planned.ok) {
      this.columnRenames.push(rename);
      this.#recordColumn(origin, originColumn, rename.to);
    }
    return planned;
  }

  /** The origins of the working schema's tables and columns, as the statements left them. */
  origins(): WorkingSchemaOrigins {
    return {
      originTable: (current) => {
        for (const origin of this.#originTables.values()) {
          if (sameTable(this.#current(origin), current)) return origin;
        }
        for (const [origin, renamed] of this.#renamedNamespaces) {
          if (renamed === current.namespaceId) return { namespaceId: origin, table: current.table };
        }
        return current;
      },
      originColumn: (origin, column) =>
        [...this.#renamedColumns.values()].find(
          (renamed) => sameTable(renamed.origin, origin) && renamed.to === column,
        )?.from ?? column,
    };
  }
}

/**
 * Plans the renames of a plan against a target's working schema: those its statements ask for, and
 * those of the tables and columns whose models and fields both contracts name alike. Every rename
 * no statement asks for is checked against all the others first. Then, in order: namespace
 * renames, the table renames no statement asks for, the other statements in the order given, and
 * the column renames no statement asks for. Each model rename becomes a table rename and each field
 * rename a column rename, computed against the schema earlier renames left, then applied to it.
 * The first rename that cannot be planned fails the whole plan; its conflict carries the statement
 * that asks for it, if one does.
 */
export function planStatements<TCall extends CallWithCompanions>(input: {
  readonly statements: readonly ResolvedRenameStatement[];
  readonly fromContract: Contract<SqlStorage> | null;
  readonly contract: Contract<SqlStorage>;
  readonly policy: MigrationOperationPolicy;
  readonly target: StatementPlanningTarget<TCall>;
  readonly ownership?: StatementOwnership;
}): Result<PlannedStatements<TCall>, SqlPlannerConflict> {
  const { fromContract } = input;
  const [first] = input.statements;
  if (fromContract === null) {
    if (first === undefined) {
      return ok({
        calls: [],
        tableRenames: [],
        columnRenames: [],
        alreadyRenamedTables: [],
        plannedStatements: [],
        origins: NO_RENAMED_ORIGINS,
        storageRenames: undefined,
      });
    }
    return notOk(
      renameRefused(
        first,
        'Statements need an origin contract, and this plan has none',
        'A statement names models and fields of the origin contract, and this plan has none. Plan from a contract that has the old names, or leave out the statement.',
        undefined,
      ),
    );
  }
  const tables = input.target.tables();
  const storageRenames = new StorageRenames(
    input.statements,
    fromContract,
    input.contract,
    tables.sameName,
  );
  const planned = plannedStorageRenames(storageRenames, tables);
  const conflict = storageRenameConflict(planned, tables, storageRenames);
  if (conflict !== undefined) return notOk(conflict);
  const planner = new StatementPlanner<TCall>({
    ...input,
    fromContract,
    ownership: input.ownership,
    storageRenames,
  });
  const unstated = (change: TableChange | ColumnChange) =>
    change.renames.every((rename) => rename.statement === undefined);
  const plannedStatements: PlannedStatement[] = [];
  const planStatement = (statement: ResolvedRenameStatement) => {
    const operations = planner.plan(statement);
    if (operations.ok) plannedStatements.push({ statement, operations: operations.value });
    return operations;
  };
  const steps = [
    ...input.statements
      .filter((statement) => statement.entity === 'namespace')
      .map((statement) => () => planStatement(statement)),
    ...planned.foundTables.map(
      ({ change, name }) =>
        () =>
          planner.recordTableFound(change, name),
    ),
    ...planned.tables.filter(unstated).map((change) => () => planner.planTableChange(change)),
    ...input.statements
      .filter((statement) => statement.entity !== 'namespace')
      .map((statement) => () => planStatement(statement)),
    ...planned.foundColumns.map(
      ({ change, name }) =>
        () =>
          planner.recordColumnFound(change, name),
    ),
    ...planned.columns.filter(unstated).map((change) => () => planner.planColumnChange(change)),
  ];
  for (const step of steps) {
    const result = step();
    if (!result.ok) return result;
  }
  return ok({
    calls: planner.calls,
    tableRenames: planner.tableRenames,
    columnRenames: planner.columnRenames,
    alreadyRenamedTables: planned.foundTables
      .filter(({ change }) => !planned.tables.includes(change))
      .map(({ change, name }) => ({ namespaceId: change.destination.namespaceId, table: name })),
    plannedStatements,
    origins: planner.origins(),
    storageRenames,
  });
}

/**
 * A column a statement names, in a table of a storage namespace, as the destination contract stores
 * it, with the field the statement names.
 */
export interface StatementColumn {
  readonly namespaceId: string;
  readonly table: string;
  readonly column: string;
  readonly field: FieldCoordinate;
  /** The field as the statement names it, which also names the statement's slots. */
  readonly text: string;
}

/** The columns of the fields that convert and backfill statements name. */
export interface FieldStatementColumns {
  readonly convert: readonly StatementColumn[];
  readonly backfill: readonly StatementColumn[];
}

/**
 * The column of each field a convert or backfill statement names, as the destination contract
 * stores it. These statements rename nothing, so the strategies that plan a field's change read
 * them instead of the working schema. A field with no column has none to list.
 */
export function fieldStatementColumns(
  statements: readonly ResolvedMigrationStatement[],
  contract: ContractWithDomain,
): FieldStatementColumns {
  const columnsOf = (kind: 'convert' | 'backfill'): readonly StatementColumn[] =>
    statements.flatMap((statement) => {
      if (statement.kind !== kind || statement.entity !== 'field') return [];
      const table = modelTable(contract, statement.field);
      const column = fieldColumn(contract, statement.field);
      return table === undefined || column === undefined
        ? []
        : [
            {
              ...table,
              column,
              field: statement.field,
              text: fieldStatementText(contract, statement.field),
            },
          ];
    });
  return { convert: columnsOf('convert'), backfill: columnsOf('backfill') };
}

/**
 * A conflict for the first backfill statement that names a field the origin model does not have and
 * whose column has a default: the default fills the existing rows when the column is added, so the
 * statement has nothing to fill. A field already in the origin keeps its backfill, since a default
 * does not fill the rows that hold NULL when the column becomes required.
 */
export function backfillOfDefaultedField(
  statements: readonly ResolvedMigrationStatement[],
  fromContract: ContractWithDomain | null,
  contract: Contract<SqlStorage>,
): SqlPlannerConflict | undefined {
  for (const statement of statements) {
    if (statement.kind !== 'backfill' || statement.entity !== 'field' || fromContract === null) {
      continue;
    }
    const originModel = sqlModelStorage(fromContract, statement.field);
    if (originModel === undefined || Object.hasOwn(originModel.fields, statement.field.field)) {
      continue;
    }
    const table = modelTable(contract, statement.field);
    const column = fieldColumn(contract, statement.field);
    if (table === undefined || column === undefined) continue;
    const storageColumn =
      contract.storage.namespaces[table.namespaceId]?.entries.table?.[table.table]?.columns[column];
    if (storageColumn?.default === undefined) continue;
    const label = describeMigrationStatement(statement, fromContract, contract);
    return renameRefused(
      statement,
      `${label}: the field is new and has a default`,
      'The default fills the existing rows when the column is added, so there is nothing to backfill. Leave out the --backfill statement.',
      { namespaceId: table.namespaceId, table: table.table, column },
    );
  }
  return undefined;
}

/**
 * The operations of a statement the statement planner does not take: a value object field backfill
 * and a variant convert are planned with the diff; a field convert or backfill accounts for none.
 */
function operationsOutsideStatementPlanner(
  statement: ResolvedMigrationStatement,
): StatementOperations {
  if (statement.kind === 'rename') return plannedAt([]);
  switch (statement.entity) {
    case 'field':
      return plannedAt([]);
    case 'valueObjectField':
    case 'model':
      return PLANNED_WITH_DIFF;
  }
}

/**
 * Every statement of a plan in the order given, with the operations it accounts for: a planned
 * statement's from `planned`, and a statement planned with the diff's from
 * `operationIndexesPlannedWithDiff`, which finds them among the target's whole plan. A model rename
 * takes both, since renaming a variant whose discriminator value changed also rewrites the value.
 */
export function appliedStatementsInOrder(
  statements: readonly ResolvedMigrationStatement[],
  planned: readonly PlannedStatement[],
  operationIndexesPlannedWithDiff: (statement: ResolvedMigrationStatement) => readonly number[],
): readonly AppliedMigrationStatement[] {
  return statements.map((statement) => {
    const operations =
      planned.find((entry) => entry.statement === statement)?.operations ??
      operationsOutsideStatementPlanner(statement);
    if (operations.kind === 'plannedWithDiff') {
      return { statement, operationIndexes: operationIndexesPlannedWithDiff(statement) };
    }
    const renamesVariant = statement.kind === 'rename' && statement.entity === 'model';
    return {
      statement,
      operationIndexes: renamesVariant
        ? [...operations.operationIndexes, ...operationIndexesPlannedWithDiff(statement)].sort(
            (left, right) => left - right,
          )
        : operations.operationIndexes,
    };
  });
}
