import { asNamespaceId, type ContractWithDomain } from '@internal/contract/types';
import {
  describeMigrationStatement,
  fieldStatementText,
  type MigrationPlannerConflict,
  type ModelCoordinate,
  modelDisplayName,
  type ResolvedMigrationStatement,
  type ResolvedModelRenameStatement,
  type ResolvedRenameStatement,
  type ResolvedVariantConvertStatement,
} from '@internal/framework-components/control';
import {
  canonicalize,
  collectionOfModel,
  embeddingModelOf,
  type MongoContract,
  otherModelsReached,
  ownStoredNameOf,
  selectedVariantOf,
  variantFilter,
} from '@internal/mongo-contract';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { notOk, ok, type Result } from '@internal/utils/result';
import { discriminatorRenameOf } from './mongo-discriminator-renames';
import { modelCoordinates, sameModel } from './mongo-model-coordinates';
import { inTwoSteps } from './mongo-rewrite-overlaps';
import {
  SEPARATE_THE_MODELS,
  sharedCollectionWhy,
  TIME_SERIES_UPDATES,
} from './mongo-rewrite-refusals';
import { collectionControlPolicy, destinationModelOf, modelAt } from './mongo-statement-planning';
import { type FieldRename, renameRefused } from './mongo-storage-renames';
import { DeleteDocumentsCall, ReplaceStoredValueCall } from './op-factory-call';

type VariantStatement = ResolvedModelRenameStatement | ResolvedVariantConvertStatement;

/**
 * A rewrite of the documents of one variant of the origin, in its base's collection: its
 * discriminator value `from` becomes `to`, or, with no `to`, its documents are deleted.
 */
export interface VariantDocumentRewrite<
  Call extends ReplaceStoredValueCall | DeleteDocumentsCall =
    | ReplaceStoredValueCall
    | DeleteDocumentsCall,
> {
  readonly call: Call;
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

/** The variant rewrites of a plan: deletes, run before replacements so that later rewrites read fewer documents, and replacements. */
export interface VariantDocumentRewrites {
  readonly deletes: readonly VariantDocumentRewrite<DeleteDocumentsCall>[];
  readonly replacements: readonly VariantDocumentRewrite<ReplaceStoredValueCall>[];
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
  /** The plan's replacements of enum values, one of which may already move a variant's discriminator value. */
  readonly enumReplacements: readonly ReplaceStoredValueCall[];
  /** The plan's field renames, those of its statements and those no statement asks for. */
  readonly fieldRenames: readonly FieldRename[];
  /** The calls of the plan's field renames, as stored. */
  readonly fieldRenameCalls: readonly {
    readonly collection: string;
    readonly from: string;
    readonly to: string;
  }[];
}

interface VariantChange extends Omit<VariantDocumentRewrite, 'call'> {
  /** The model of the destination the variant is, if any. */
  readonly destination: ModelCoordinate | undefined;
  /** The stored name of the discriminator in the origin. */
  readonly originField: string;
  /** The enum value replacement that already moves the value, when the discriminator is an enum. */
  readonly byEnum: ReplaceStoredValueCall | undefined;
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

/** The model of the destination a model of the origin is, as the statements and field changes find it: a variant renamed without a statement that keeps its collection and value is the same documents. */
function destinationOf(
  origin: ModelCoordinate,
  fromContract: ContractWithDomain,
  input: VariantInput,
): ModelCoordinate | undefined {
  return destinationModelOf(origin, {
    statements: input.statements.filter(
      (statement): statement is ResolvedRenameStatement => statement.kind === 'rename',
    ),
    fromContract,
    contract: input.contract,
    fieldRenames: input.fieldRenames,
    collectionAfterRenames: input.collectionAfterRenames,
  });
}

function baseOf(contract: ContractWithDomain, model: ModelCoordinate): ModelCoordinate | undefined {
  const base = modelAt(contract, model)?.base;
  return base === undefined
    ? undefined
    : { namespaceId: asNamespaceId(base.namespace), model: base.model };
}

/** The destination's base of a variant of the origin: the base of the model it is, else the model its origin base is. */
function destinationBaseOf(
  origin: ModelCoordinate,
  destination: ModelCoordinate | undefined,
  fromContract: ContractWithDomain,
  input: VariantInput,
): ModelCoordinate | undefined {
  const originBase = baseOf(fromContract, origin);
  return (
    (destination === undefined ? undefined : baseOf(input.contract, destination)) ??
    (originBase === undefined ? undefined : destinationOf(originBase, fromContract, input))
  );
}

/** The stored name of the discriminator of the destination's base, when it still has one, as SQL finds the column. */
function destinationDiscriminator(
  origin: ModelCoordinate,
  destination: ModelCoordinate | undefined,
  fromContract: ContractWithDomain,
  input: VariantInput,
): string | undefined {
  const base = destinationBaseOf(origin, destination, fromContract, input);
  const model = base === undefined ? undefined : modelAt(input.contract, base);
  const field = model?.discriminator?.field;
  return model === undefined || field === undefined ? undefined : ownStoredNameOf(model, field);
}

/** The enum value replacement that rewrites `from` to `to` in the discriminator field itself. */
function enumReplacementOf(
  input: VariantInput,
  at: { readonly collection: string; readonly field: string },
  from: string,
  to: string,
): ReplaceStoredValueCall | undefined {
  return input.enumReplacements.find(
    ({ options }) =>
      options.collection === at.collection &&
      options.field === at.field &&
      options.path === undefined &&
      options.filter === undefined &&
      options.from === from &&
      canonicalize(options.to) === canonicalize({ $literal: to }),
  );
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
  const destination = destinationOf(origin, fromContract, input);
  const after =
    destination === undefined ? undefined : selectedVariantOf(input.contract.domain, destination);
  if (destination !== undefined && after === undefined) return undefined;
  const field = destinationDiscriminator(origin, destination, fromContract, input);
  if (field === undefined) return undefined;
  const from = String(before.value);
  const to = after === undefined ? undefined : String(after.value);
  if (to === from) return undefined;
  const statement =
    destination === undefined ? undefined : statementOf(origin, destination, input.statements);
  const byEnum =
    to === undefined ? undefined : enumReplacementOf(input, { collection, field }, from, to);
  return {
    model: origin,
    destination,
    collection,
    field,
    originField: before.field,
    from,
    to: statement === undefined && byEnum === undefined ? undefined : to,
    statement,
    byEnum,
  };
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

function variantText(model: ModelCoordinate): string {
  return `variant ${quoted(modelDisplayName(model))}`;
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
  return renameRefused(change.statement, `${label}: ${reason}`, why);
}

/** How to change discriminator values that one migration cannot change safely. */
export const VARIANT_TWO_STEPS = inTwoSteps(
  'delete the variants, or move their values to discriminator values no variant uses',
  'change the values to their final ones',
);

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
    return sharedCollectionRefusal(change, label, fromContract);
  }
  return refusedChange(
    change,
    label,
    `collection "${change.collection}" is a time-series collection`,
    `${TIME_SERIES_UPDATES}, so the plan does not rewrite or delete the documents of a variant there. Keep the variant and its discriminator value in the contract, then run this command again.`,
  );
}

/**
 * The refusal of a change whose documents another root model stored in the same collection can
 * share: a model with the same discriminator field and value, whose documents the delete or
 * replacement would reach too.
 */
function sharedCollectionRefusal(
  change: VariantChange,
  label: string,
  fromContract: ContractWithDomain,
): MigrationPlannerConflict | undefined {
  const originCollection = collectionOfModel(fromContract.domain, change.model);
  if (originCollection === undefined) return undefined;
  const others = otherModelsReached(
    fromContract.domain,
    change.model,
    originCollection,
    { field: change.originField, value: change.from },
    undefined,
  );
  if (others.length === 0) return undefined;
  const named = others.map(quoted).join(', ');
  const effect =
    change.to === undefined
      ? 'deleting the documents with that value would delete the documents'
      : 'replacing the value would replace it in the documents';
  return refusedChange(
    change,
    label,
    `model ${named} ${others.length === 1 ? 'is' : 'are'} stored in collection ${quoted(change.collection)} and its documents can hold ${change.originField} ${quoted(change.from)}`,
    `${sharedCollectionWhy(change.collection, others, effect)} To change only the documents of ${variantText(change.model)}, ${change.statement === undefined ? `move the models to separate collections, or keep ${change.to === undefined ? variantText(change.model) : `the discriminator value ${quoted(change.from)}`} in the contract` : SEPARATE_THE_MODELS}.`,
  );
}

/**
 * The refusal of a change whose documents hold their discriminator value in a field the plan does
 * not rename to the destination's discriminator: the rewrite would select its documents by a field
 * that holds no variant's value.
 */
function unrenamedDiscriminatorRefusal(
  change: VariantChange,
  input: VariantInput,
  fromContract: ContractWithDomain,
): MigrationPlannerConflict | undefined {
  const renamed = input.fieldRenameCalls.some(
    (rename) =>
      rename.collection === change.collection &&
      rename.from === change.originField &&
      rename.to === change.field,
  );
  if (change.field === change.originField || renamed) return undefined;
  const destinationBase = destinationBaseOf(change.model, change.destination, fromContract, input);
  const rename =
    destinationBase === undefined
      ? undefined
      : discriminatorRenameOf(baseOf(fromContract, change.model), destinationBase, {
          fromContract,
          contract: input.contract,
          statements: input.statements,
          fieldRenames: input.fieldRenames,
        });
  const field = quoted(change.field);
  const discriminator =
    destinationBase === undefined
      ? undefined
      : modelAt(input.contract, destinationBase)?.discriminator?.field;
  const backfill =
    destinationBase === undefined || discriminator === undefined
      ? '--backfill'
      : `--backfill ${fieldStatementText(input.contract, { ...destinationBase, field: discriminator })}`;
  const advice =
    rename === undefined
      ? inTwoSteps(
          `make ${field} the discriminator with the variants' current values, giving every document its value there (under migration plan, with ${backfill})`,
          'change the variants',
        )
      : `Add ${rename.flags} and run the command again.`;
  const unrenamed = `hold their discriminator value in field ${quoted(change.originField)}, which the plan does not rename to ${field}`;
  return refusedChange(
    change,
    change.statement === undefined
      ? 'Cannot plan the migration'
      : changeLabel(change, input, fromContract),
    change.statement === undefined
      ? `the documents of ${variantText(change.model)} ${unrenamed}`
      : `its documents ${unrenamed}`,
    `The plan rewrites the documents of a variant by their value in field ${field}, which only a rename of field ${quoted(change.originField)} gives them. ${advice}`,
  );
}

function callOf(change: VariantChange): ReplaceStoredValueCall | DeleteDocumentsCall {
  if (change.byEnum !== undefined) return change.byEnum;
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
 * Deletes run first, so later rewrites read fewer documents; a delete and a replacement of the same
 * value are refused for the whole plan (see `overlapRefusal`), so the order does not decide what the
 * documents end as. A rewrite that would reach the documents of another root model in the same
 * collection is refused. In a collection whose control policy is not `managed`, a statement is refused and a
 * delete left out. The discriminator is read from the destination's base, so a base that renames it
 * is followed, and a base that no longer has one keeps every document. A replacement of an enum value
 * that already moves a variant's value is that variant's replacement. With no origin contract,
 * nothing is known to have changed.
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
      change.to === undefined &&
      collectionControlPolicy(input.contract, change.collection) !== 'managed';
    return unmanagedDelete ? [] : [change];
  });
  const refusals = changes.flatMap((change) => {
    const refusal =
      collectionRefusal(change, input, fromContract) ??
      unrenamedDiscriminatorRefusal(change, input, fromContract);
    return refusal === undefined ? [] : [refusal];
  });
  if (refusals.length > 0) return notOk(refusals);
  const rewrites = changes.map((change) => ({ ...change, call: callOf(change) }));
  return ok({
    deletes: rewrites.flatMap(({ call, ...rewrite }) =>
      call instanceof DeleteDocumentsCall ? [{ ...rewrite, call }] : [],
    ),
    replacements: rewrites.flatMap(({ call, ...rewrite }) =>
      call instanceof ReplaceStoredValueCall ? [{ ...rewrite, call }] : [],
    ),
  });
}
