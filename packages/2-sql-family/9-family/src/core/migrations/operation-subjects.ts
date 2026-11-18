import type { ContractWithDomain } from '@internal/contract/types';
import type {
  EnumValueCoordinate,
  MigrationAccessChange,
  MigrationDataLoss,
  MigrationDataLossKind,
  MigrationPlanSubjects,
  MigrationSubject,
  MigrationTemporaryValue,
  ModelCoordinate,
  ValueObjectFieldCoordinate,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { ifDefined } from '@internal/utils/defined';
import { fieldOfColumn } from './field-of-column';
import { handWrittenMigrationSteps } from './hand-written-migration';
import { exactName, isSqlModelStorage, type ModelTable, modelsStoring } from './model-storage';
import { modelsText } from './plan-text';
import type { TableRenameByHand, WorkingSchemaOrigins } from './statement-planning';
import type { StorageRenames } from './storage-renames';

/**
 * What an operation is about, as the plan names it after its rename statements: a table, or a
 * column of one, in a storage namespace, or neither, such as a type. `storageName` names the
 * subject when no model of the origin contract stores it.
 */
export interface SubjectStorage {
  readonly storageName: string;
  readonly table:
    | {
        readonly namespaceId: string;
        readonly table: string;
        readonly column: string | undefined;
      }
    | undefined;
  /** The enum value the operation is about, when it rewrites one stored value of an enum. */
  readonly enumValue?: EnumValueCoordinate;
  /** The value object field the operation is about, when it rewrites one key of a value object. */
  readonly valueObjectField?: ValueObjectFieldCoordinate;
  /** The variant the operation is about, when it deletes the rows of one variant. */
  readonly model?: ModelCoordinate;
}

/** What a codec hook's call is about: the column of the field event it was returned for. */
export function fieldEventStorage(field: {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly columnName: string;
}): SubjectStorage {
  const qualifier = field.namespaceId === UNBOUND_NAMESPACE_ID ? [] : [field.namespaceId];
  return {
    storageName: [...qualifier, field.tableName, field.columnName].join('.'),
    table: { namespaceId: field.namespaceId, table: field.tableName, column: field.columnName },
  };
}

/**
 * Names for destructive calls a target cannot map to storage: each call's factory name, with a
 * `#n` ordinal when several calls of the plan share it, so each name picks out one call.
 */
export function unknownCallNames<TCall extends { readonly factoryName: string }>(
  calls: readonly TCall[],
): ReadonlyMap<TCall, string> {
  const counts = new Map<string, number>();
  for (const call of calls) counts.set(call.factoryName, (counts.get(call.factoryName) ?? 0) + 1);
  const seen = new Map<string, number>();
  return new Map(
    calls.map((call) => {
      const ordinal = (seen.get(call.factoryName) ?? 0) + 1;
      seen.set(call.factoryName, ordinal);
      const shared = (counts.get(call.factoryName) ?? 0) > 1;
      return [call, shared ? `${call.factoryName}#${ordinal}` : call.factoryName];
    }),
  );
}

/** A call of a plan: how many operations it lowers to, and what the first of them is about. */
export interface CallSubjects {
  readonly operationCount: number;
  /** The call's label, which names its operation before the plan's slots are filled. */
  readonly label: string;
  /** What the call's operation loses, one entry per model, field or storage name, how, and how to keep it. */
  readonly dataLoss: readonly (SubjectStorage & {
    readonly loss: MigrationDataLossKind;
    /** What the user should know to keep the data, which the question repeats. */
    readonly keepDataAdvice?: string;
  })[];
  /** What the call's operation changes access to, and whether it widens it. */
  readonly accessChanges: readonly (SubjectStorage & { readonly widens: boolean })[];
  /** The new required columns the call's operation gives a temporary value in existing rows, and the value. */
  readonly temporaryValues: readonly TemporaryColumnValue[];
}

/**
 * A new required column of `table` in the destination, and the temporary value its existing rows
 * get; or, with `valueObjectField`, the column whose objects get a temporary value for that field.
 */
export interface TemporaryColumnValue {
  readonly table: string;
  readonly column: string;
  readonly value: string;
  readonly valueObjectField?: ValueObjectFieldCoordinate;
}

interface SubjectContext {
  readonly fromContract: ContractWithDomain | null;
  readonly contract: ContractWithDomain;
  /** Where the plan's statements put the origin's tables and columns. */
  readonly origins: WorkingSchemaOrigins;
  /** The renames of the plan, `undefined` with no origin contract. */
  readonly storageRenames: StorageRenames | undefined;
  readonly byHand: TableRenameByHand;
  /** The variants of the origin the destination no longer has and no rename names: their columns are asked about as the variant. */
  readonly removedVariants: readonly ModelCoordinate[];
}

function isRemovedVariant(model: ModelCoordinate, context: SubjectContext): boolean {
  return context.removedVariants.some(
    (variant) => variant.namespaceId === model.namespaceId && variant.model === model.model,
  );
}

function subjectOf(target: SubjectStorage, context: SubjectContext): MigrationSubject {
  if (target.enumValue !== undefined) return { kind: 'enumValue', ...target.enumValue };
  if (target.valueObjectField !== undefined) {
    return { kind: 'valueObjectField', ...target.valueObjectField };
  }
  if (target.model !== undefined) return { kind: 'model', ...target.model };
  const storage: MigrationSubject = { kind: 'storage', name: target.storageName };
  const { fromContract } = context;
  if (target.table === undefined || fromContract === null) return storage;
  const origin = context.origins.originTable({
    namespaceId: target.table.namespaceId,
    table: target.table.table,
  });
  const models = modelsStoring(fromContract, origin, exactName);
  if (target.table.column === undefined) {
    const model = models.find(({ isRoot }) => isRoot) ?? models[0];
    return model === undefined ? storage : { kind: 'model', ...model.coordinate };
  }
  const column = context.origins.originColumn(origin, target.table.column);
  for (const model of [...models].sort((a, b) => Number(b.isRoot) - Number(a.isRoot))) {
    const field = Object.entries(model.fields).find(([, stored]) => stored.column === column)?.[0];
    if (field === undefined) continue;
    return isRemovedVariant(model.coordinate, context)
      ? { kind: 'model', ...model.coordinate }
      : { kind: 'field', ...model.coordinate, field };
  }
  return storage;
}

/**
 * How to keep the rows of a dropped table whose model the destination keeps under the same name in
 * another table of the same namespace, when the plan does not rename it: the user renames it by
 * hand. None when the origin contract already stores a model in that table.
 */
function keepTableAdvice(
  target: SubjectStorage,
  subject: MigrationSubject,
  context: SubjectContext,
): string | undefined {
  const { storageRenames } = context;
  if (subject.kind !== 'model' || target.table === undefined || storageRenames === undefined) {
    return undefined;
  }
  const storage =
    context.contract.domain.namespaces[subject.namespaceId]?.models[subject.model]?.storage;
  if (storage === undefined || !isSqlModelStorage(storage)) return undefined;
  const { namespaceId, table: from } = target.table;
  if (storage.namespaceId !== namespaceId || storage.table === from) return undefined;
  if (storageRenames.originModelsIn({ namespaceId, table: storage.table }).length > 0)
    return undefined;
  const sharing = sharedStorageAdvice(storageRenames, {
    origin: { namespaceId, table: from },
    destination: { namespaceId, table: storage.table },
  });
  if (sharing !== undefined) return sharing;
  const rename = { namespaceId, from, to: storage.table };
  return `To keep its rows, rename table "${from}" to "${storage.table}" instead. The plan does not rename it: a plan renames the table of a model that keeps its name only on a target that plans table renames, when the control policy of the table is "managed" in both contracts, every model stored in it moves to the new table, and no model moves there from another table. With db update, rename the table in the database yourself with ${context.byHand.tableRenameByHand(rename).join('; ')}, then run prisma db update. With migration plan, write the rename as a migration of its own instead: run prisma migration new --name <name> --from <hash of the migration the database is at>, add ${context.byHand.renderTableRename(rename)} to the operations of its migration.ts, run node on that migration.ts so it writes ops.json, then run prisma db migrate.`;
}

function byName(left: ModelCoordinate, right: ModelCoordinate): number {
  return `${left.namespaceId}.${left.model}`.localeCompare(`${right.namespaceId}.${right.model}`);
}

/**
 * Why the rows of table `origin` cannot be kept by renaming it to `destination`, as the planner
 * decides it: their storage is being split or merged. Keeping their rows is then a data migration.
 */
function sharedStorageAdvice(
  storageRenames: StorageRenames,
  tables: { readonly origin: ModelTable; readonly destination: ModelTable },
): string | undefined {
  const shared = storageRenames.sharedTable(tables);
  if (shared === undefined) return undefined;
  const split = shared.kind === 'split';
  const models = [
    ...(split
      ? storageRenames.originModelsIn(tables.origin)
      : storageRenames.destinationModelsIn(tables.destination)),
  ].sort(byName);
  const into = new Map<string, ModelCoordinate[]>();
  for (const model of models) {
    const moved = split ? storageRenames.destinationTableOf(model) : tables.destination;
    if (moved !== undefined) into.set(moved.table, [...(into.get(moved.table) ?? []), model]);
  }
  const moves = [...into]
    .map(([table, moved]) => `the rows of ${modelsText(moved)} into table "${table}"`)
    .join(' and ');
  const stated = split
    ? `The origin stores ${modelsText(models)} in table "${tables.origin.table}", and the destination stores them in different tables, so their storage is being split.`
    : `The destination stores ${modelsText(models)} in table "${tables.destination.table}", and the origin stores them in different tables, so their storage is being merged.`;
  return `${stated} Keeping their rows is a data migration, which a plan does not write. With migration plan, write this change as a hand-written migration instead: ${handWrittenMigrationSteps(moves)}`;
}

/**
 * The subject of each operation that loses data and each that changes access, at its position in
 * the plan. A subject is a model or a field of the origin contract when one stores it, found under
 * its origin name when a rename statement renamed its table or column earlier in the plan.
 */
export function subjectsOfCalls(
  calls: readonly CallSubjects[],
  context: SubjectContext,
): MigrationPlanSubjects {
  const dataLoss: MigrationDataLoss[] = [];
  const accessChanges: MigrationAccessChange[] = [];
  const temporaryValues: MigrationTemporaryValue[] = [];
  let operationIndex = 0;
  for (const call of calls) {
    for (const { table, column, value, valueObjectField } of call.temporaryValues) {
      temporaryValues.push({
        operationIndex,
        subject:
          valueObjectField !== undefined
            ? { kind: 'valueObjectField', ...valueObjectField }
            : (fieldOfColumn(context.contract, table, column) ?? {
                kind: 'storage',
                name: `${table}.${column}`,
              }),
        value,
      });
    }
    for (const target of call.dataLoss) {
      const subject = subjectOf(target, context);
      dataLoss.push({
        operationIndex,
        subject,
        loss: target.loss,
        label: call.label,
        ...ifDefined(
          'keepDataAdvice',
          target.keepDataAdvice ?? keepTableAdvice(target, subject, context),
        ),
      });
    }
    for (const target of call.accessChanges) {
      accessChanges.push({
        operationIndex,
        subject: subjectOf(target, context),
        widens: target.widens,
      });
    }
    operationIndex += call.operationCount;
  }
  return { dataLoss, accessChanges, temporaryValues };
}
