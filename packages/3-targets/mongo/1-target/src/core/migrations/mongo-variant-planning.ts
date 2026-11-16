import type { ContractWithDomain } from '@internal/contract/types';
import {
  describeMigrationStatement,
  type MigrationPlannerConflict,
  type ModelCoordinate,
  modelDisplayName,
  type ResolvedMigrationStatement,
  type ResolvedModelRenameStatement,
  type ResolvedVariantConvertStatement,
} from '@internal/framework-components/control';
import {
  collectionOfModel,
  embeddingModelOf,
  type MongoContract,
  selectedVariantOf,
  variantFilter,
} from '@internal/mongo-contract';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { notOk, ok, type Result } from '@internal/utils/result';
import { ONE_AT_A_TIME } from './mongo-enum-value-planning';
import { TIME_SERIES_UPDATES } from './mongo-rewrite-refusals';
import { collectionControlPolicy, modelAt, modelCoordinates } from './mongo-statement-planning';
import { DeleteDocumentsCall, ReplaceStoredValueCall } from './op-factory-call';

type VariantStatement = ResolvedModelRenameStatement | ResolvedVariantConvertStatement;

/**
 * A rewrite of the documents of one variant of the origin, in its base's collection: its
 * discriminator value `from` becomes `to`, or, with no `to`, its documents are deleted.
 */
export interface VariantDocumentRewrite {
  readonly call: ReplaceStoredValueCall | DeleteDocumentsCall;
  /** The variant, as the origin contract names it. */
  readonly model: ModelCoordinate;
  readonly collection: string;
  /** The stored name of the discriminator. */
  readonly field: string;
  readonly from: string;
  readonly to: string | undefined;
  /** The rename or convert statement the rewrite carries out, if any. */
  readonly statement: VariantStatement | undefined;
}

/** The variant rewrites of a plan: deletes, run before replacements, so a value a delete frees could be taken. */
export interface VariantDocumentRewrites {
  readonly deletes: readonly VariantDocumentRewrite[];
  readonly replacements: readonly VariantDocumentRewrite[];
}

export interface VariantInput {
  readonly statements: readonly ResolvedMigrationStatement[];
  readonly fromContract: ContractWithDomain | null;
  readonly contract: MongoContract;
  /** The schema the plan starts from, with each renamed collection under its new name. */
  readonly schema: MongoSchemaIR;
  /** The collections the destination keeps. */
  readonly keptCollections: ReadonlySet<string>;
  readonly collectionAfterRenames: (collection: string) => string;
}

type VariantChange = Omit<VariantDocumentRewrite, 'call'>;

function sameModel(a: ModelCoordinate, b: ModelCoordinate): boolean {
  return a.namespaceId === b.namespaceId && a.model === b.model;
}

function statementOf(
  origin: ModelCoordinate,
  destination: ModelCoordinate,
  statements: readonly ResolvedMigrationStatement[],
): VariantStatement | undefined {
  return statements.find(
    (statement): statement is VariantStatement =>
      statement.entity === 'model' &&
      ((statement.kind === 'rename' && sameModel(statement.from, origin)) ||
        (statement.kind === 'convert' && sameModel(statement.model, destination))),
  );
}

/** The model of the destination a model of the origin is: the one a statement renames it to, else the one of the same name, as SQL finds it. */
function destinationOf(origin: ModelCoordinate, input: VariantInput): ModelCoordinate | undefined {
  const rename = input.statements.find(
    (statement): statement is ResolvedModelRenameStatement =>
      statement.kind === 'rename' &&
      statement.entity === 'model' &&
      sameModel(statement.from, origin),
  );
  if (rename !== undefined) return rename.to;
  return modelAt(input.contract, origin) === undefined ? undefined : origin;
}

/** What changes for the documents of one variant of the origin, if anything does. */
function changeOf(
  origin: ModelCoordinate,
  fromContract: ContractWithDomain,
  input: VariantInput,
): VariantChange | undefined {
  if (embeddingModelOf(fromContract.domain, origin) !== undefined) return undefined;
  const before = selectedVariantOf(fromContract.domain, origin);
  const originCollection = collectionOfModel(fromContract.domain, origin);
  if (before === undefined || originCollection === undefined) return undefined;
  const collection = input.collectionAfterRenames(originCollection);
  if (!input.keptCollections.has(collection)) return undefined;
  const destination = destinationOf(origin, input);
  const after =
    destination === undefined ? undefined : selectedVariantOf(input.contract.domain, destination);
  if (destination !== undefined && after === undefined) return undefined;
  const from = String(before.value);
  const to = after === undefined ? undefined : String(after.value);
  if (to === from) return undefined;
  const statement =
    destination === undefined ? undefined : statementOf(origin, destination, input.statements);
  return {
    model: origin,
    collection,
    field: after?.field ?? before.field,
    from,
    to: statement === undefined ? undefined : to,
    statement,
  };
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

function variantText(model: ModelCoordinate): string {
  return `variant ${quoted(modelDisplayName(model))}`;
}

function moveText(change: VariantChange): string {
  return change.to === undefined
    ? `${variantText(change.model)} deletes its documents with ${quoted(change.from)}`
    : `${variantText(change.model)} moves ${quoted(change.from)} to ${quoted(change.to)}`;
}

function listText(items: readonly string[]): string {
  return items.length <= 1
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function changeLabel(change: VariantChange, input: VariantInput, fromContract: ContractWithDomain) {
  return change.statement === undefined
    ? `Cannot delete the documents of ${variantText(change.model)}`
    : `Cannot ${describeMigrationStatement(change.statement, fromContract, input.contract)}`;
}

function refusedChange(
  change: VariantChange,
  label: string,
  reason: string,
  why: string,
): MigrationPlannerConflict {
  return change.statement === undefined
    ? { kind: 'unsupportedOperation', summary: `${label}: ${reason}`, why }
    : {
        kind: 'statementRefused',
        summary: `${label}: ${reason}`,
        why,
        refusedStatement: change.statement,
      };
}

/**
 * The changes in one collection's discriminator field that read a value another change writes, or
 * write one another change frees: a delete whose value a replacement takes, swaps, and chains.
 */
function overlapping(changes: readonly VariantChange[]): readonly VariantChange[] {
  const sameField = (a: VariantChange, b: VariantChange) =>
    a.collection === b.collection && a.field === b.field;
  return changes.filter((change) =>
    changes.some(
      (other) =>
        other !== change &&
        sameField(change, other) &&
        ((other.to !== undefined && other.to === change.from) ||
          (change.to !== undefined && change.to === other.from)),
    ),
  );
}

const TWO_MIGRATIONS = `${ONE_AT_A_TIME} If a later operation stops and the migration runs again, an operation whose discriminator value another operation wrote would delete or rewrite those documents a second time. Make the change in two migrations: first delete the variants, or move their values to discriminator values no variant uses, and apply that; then change the values to their final ones.`;

function overlapRefusal(
  changes: readonly VariantChange[],
  input: VariantInput,
  fromContract: ContractWithDomain,
): MigrationPlannerConflict | undefined {
  const found = overlapping(changes);
  const writer = found.find((change) => change.statement !== undefined);
  if (writer?.statement === undefined) return undefined;
  return {
    ...refusedChange(
      writer,
      changeLabel(writer, input, fromContract),
      `other operations of the migration free the discriminator value it writes, or write the value it frees (${listText(found.map(moveText))})`,
      TWO_MIGRATIONS,
    ),
    leaveOut: found.flatMap((change) => (change.statement === undefined ? [] : [change.statement])),
  };
}

/** Why a change cannot be planned in its collection: a time-series collection, or, for a statement, one whose control policy is not `managed`. */
function collectionRefusal(
  change: VariantChange,
  input: VariantInput,
  fromContract: ContractWithDomain,
): MigrationPlannerConflict | undefined {
  const label = changeLabel(change, input, fromContract);
  const policy = collectionControlPolicy(input.contract, change.collection);
  if (policy !== 'managed') {
    return refusedChange(
      change,
      label,
      `collection "${change.collection}" has control policy "${policy}"`,
      'Statements rename only collections, and fields of collections, whose control policy is "managed". Make the change in the database yourself and leave out this statement.',
    );
  }
  if (input.schema.collection(change.collection)?.options?.timeseries === undefined) {
    return undefined;
  }
  return refusedChange(
    change,
    label,
    `collection "${change.collection}" is a time-series collection`,
    `${TIME_SERIES_UPDATES}, so the plan does not rewrite or delete the documents of a variant there. Keep the variant and its discriminator value in the contract, then run this command again.`,
  );
}

function callOf(change: VariantChange): ReplaceStoredValueCall | DeleteDocumentsCall {
  return change.to === undefined
    ? new DeleteDocumentsCall({
        collection: change.collection,
        filter: variantFilter({ field: change.field, value: change.from }),
      })
    : new ReplaceStoredValueCall({
        collection: change.collection,
        field: change.field,
        from: change.from,
        to: { $literal: change.to },
      });
}

/**
 * The document rewrites a plan makes for the variants of the origin whose discriminator value the
 * destination changes or drops, as SQL plans their rows. A rename or convert statement replaces a
 * changed value in the base's collection; a changed value with no statement, and a variant the
 * destination no longer has, delete the documents that hold the old value, which the plan asks about.
 * Deletes run first. MongoDB applies operations one at a time and a re-run repeats every operation
 * whose postcheck does not hold, so a plan where one operation writes a value another frees is
 * refused. In a collection whose control policy is not `managed`, a statement is refused and a delete
 * left out. With no origin contract, nothing is known to have changed.
 */
export function planVariantDocumentRewrites(
  input: VariantInput,
): Result<VariantDocumentRewrites, readonly MigrationPlannerConflict[]> {
  const { fromContract } = input;
  if (fromContract === null) return ok({ deletes: [], replacements: [] });
  const changes = modelCoordinates(fromContract).flatMap((origin) => {
    const change = changeOf(origin, fromContract, input);
    if (change === undefined) return [];
    const unmanagedDelete =
      change.statement === undefined &&
      collectionControlPolicy(input.contract, change.collection) !== 'managed';
    return unmanagedDelete ? [] : [change];
  });
  const refusals = changes.flatMap((change) => {
    const refusal = collectionRefusal(change, input, fromContract);
    return refusal === undefined ? [] : [refusal];
  });
  if (refusals.length > 0) return notOk(refusals);
  const overlap = overlapRefusal(changes, input, fromContract);
  if (overlap !== undefined) return notOk([overlap]);
  const rewrites = changes.map((change) => ({ ...change, call: callOf(change) }));
  return ok({
    deletes: rewrites.filter(({ to }) => to === undefined),
    replacements: rewrites.filter(({ to }) => to !== undefined),
  });
}
