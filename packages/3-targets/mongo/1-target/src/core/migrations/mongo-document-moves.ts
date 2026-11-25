import type { Contract } from '@internal/contract/types';
import type { MongoContract, SelectedVariant } from '@internal/mongo-contract';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import type { Document } from '@internal/mongo-value';
import { collectionPlanOf, collectionPlanSchemasOf } from './mongo-collection-plan';

/** A move of one or more models' documents to another collection, which a plan cannot write because no filter of its own selects them. */
export interface DocumentMove {
  readonly to: string;
  readonly order: DocumentMoveOrder;
  readonly copies: readonly DocumentCopy[];
}

/** One copy of a document move: the models whose documents it writes alike, and how. */
export interface DocumentCopy {
  readonly models: readonly string[];
  /** The `$set` and `$unset` stages that give the copied documents their stored names and discriminator value in the destination. */
  readonly fieldStages: readonly Document[];
}

/** A model whose documents move, and what changes in them on the way. */
export interface MovingModel {
  readonly name: string;
  /** The stored names of its documents that change, from the origin's to the destination's. */
  readonly storedNameMoves: readonly { readonly from: string; readonly to: string }[];
  /** The variant it is in the target, whose discriminator value its documents must hold there. */
  readonly variant: SelectedVariant | undefined;
}

/** The operation of the plan a document move comes right after: the target's creation, or the renames of the source and of the collection renamed to the target. */
export type DocumentMoveAfter =
  | { readonly kind: 'createCollection' }
  | {
      readonly kind: 'renameCollection';
      readonly renames: readonly { readonly from: string; readonly to: string }[];
    };

/** Where a document move goes in the plan it is added to, and whether its copy skips validation. */
export interface DocumentMoveOrder {
  /** The name of the source collection when the move runs, once the plan has renamed it. */
  readonly source: string;
  /** `undefined` when nothing in the plan has to come first, so the move goes at the start. */
  readonly after: DocumentMoveAfter | undefined;
  /** Whether the copy skips validation: the target has a validator when it runs, and the plan replaces or removes it later. */
  readonly bypassDocumentValidation: boolean;
  readonly validatorChange: 'replaced' | 'removed' | undefined;
}

export interface DocumentMoveOrderInput {
  /** The schema the plan the move is added to compares, with its collection renames made. */
  readonly schema: MongoSchemaIR;
  readonly fromContract: Contract | null;
  /** The destination of the plan the move is added to. */
  readonly contract: MongoContract;
  /** The source collection, by its name in the origin. */
  readonly from: string;
  readonly to: string;
  readonly collectionRenames: readonly { readonly from: string; readonly to: string }[];
}

function fieldStagesOf({ storedNameMoves, variant }: MovingModel): readonly Document[] {
  const written = new Set(storedNameMoves.map(({ to }) => to));
  const unset = storedNameMoves.map(({ from }) => from).filter((from) => !written.has(from));
  const set = [
    ...storedNameMoves.map(({ from, to }) => [to, `$${from}`] as const),
    ...(variant === undefined ? [] : [[variant.field, { $literal: variant.value }] as const]),
  ];
  return [
    ...(set.length === 0 ? [] : [{ $set: Object.fromEntries(set) }]),
    ...(unset.length === 0 ? [] : [{ $unset: unset }]),
  ];
}

/** The copies that write the documents of `models`: one for each set of models whose documents are written alike. */
export function documentCopiesOf(models: readonly MovingModel[]): readonly DocumentCopy[] {
  const copies = new Map<string, { models: string[]; fieldStages: readonly Document[] }>();
  for (const model of models) {
    const fieldStages = fieldStagesOf(model);
    const key = JSON.stringify(fieldStages);
    const copy = copies.get(key);
    if (copy === undefined) copies.set(key, { models: [model.name], fieldStages });
    else copy.models.push(model.name);
  }
  return [...copies.values()];
}

/**
 * Where a document move goes in a plan, from what the plan does to the target. The planner orders
 * operations by kind, so the move must come after the operation that brings the target into being,
 * and after the rename of the source when the plan renames it, and before every other operation on
 * the source. When the target has a validator at that point and the
 * plan replaces or removes it later, the copy skips validation, as the plan's own rewrites do, and
 * the validator update checks the moved documents.
 */
export function documentMoveOrder(input: DocumentMoveOrderInput): DocumentMoveOrder {
  const { from, to } = input;
  const schemas = collectionPlanSchemasOf(input.schema, input.contract, input.schema.fromDatabase);
  const plan = collectionPlanOf(to, schemas, {
    contract: input.contract,
    fromContract: input.fromContract,
  });
  const diff = plan.kind === 'planned' ? plan.diff : undefined;
  const renames = input.collectionRenames.filter(
    (rename) => rename.to === to || rename.from === from,
  );
  const after: DocumentMoveAfter | undefined =
    diff !== undefined && diff.collCreates.length > 0
      ? { kind: 'createCollection' }
      : renames.length === 0
        ? undefined
        : { kind: 'renameCollection', renames };
  const validatorChange =
    diff === undefined ||
    diff.validatorOps.length === 0 ||
    input.schema.collection(to)?.validator === undefined
      ? undefined
      : schemas.writtenDestination.collection(to)?.validator === undefined
        ? 'removed'
        : 'replaced';
  return {
    source: input.collectionRenames.find((rename) => rename.from === from)?.to ?? from,
    after,
    bypassDocumentValidation: validatorChange !== undefined,
    validatorChange,
  };
}
