import type { Contract } from '@internal/contract/types';
import { contractToMongoSchemaIR } from '@internal/family-mongo/control';
import type { MongoContract } from '@internal/mongo-contract';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import type { Document } from '@internal/mongo-value';
import { InternalError } from '@internal/utils/internal-error';
import { collectionPlanOf } from './mongo-collection-plan';

/** A move of one or more models' documents to another collection, which a plan cannot write because no filter of its own selects them. */
export interface DocumentMove {
  /** The models whose documents move, in words. */
  readonly moving: string;
  readonly from: string;
  readonly to: string;
  readonly order: DocumentMoveOrder;
}

/** The operation of the plan a document move comes right after. */
export type DocumentMoveAfter =
  | { readonly kind: 'createCollection' }
  | { readonly kind: 'renameCollection'; readonly from: string };

/** Where a document move goes in the plan it is added to, and how it writes the documents. */
export interface DocumentMoveOrder {
  /** `undefined` when nothing in the plan has to come first, so the move goes at the start. */
  readonly after: DocumentMoveAfter | undefined;
  /** Whether the copy skips validation: the target has a validator when it runs, and the plan replaces or removes it later. */
  readonly bypassDocumentValidation: boolean;
  readonly validatorChange: 'replaced' | 'removed' | undefined;
  /** Whether the plan rewrites documents in the target, which would reach the moved documents, so the move needs a plan of its own. */
  readonly twoPlans: boolean;
  /** The `$set` and `$unset` stages that give the moved documents their stored names in the destination. */
  readonly fieldStages: readonly Document[];
}

export interface DocumentMoveOrderInput {
  /** The schema the plan the move is added to compares, with its collection renames made. */
  readonly schema: MongoSchemaIR;
  readonly fromContract: Contract | null;
  /** The destination of the plan the move is added to. */
  readonly contract: MongoContract;
  readonly from: string;
  readonly to: string;
  readonly collectionRenames: readonly { readonly from: string; readonly to: string }[];
  /** The collections the plan rewrites documents in, by their names once the renames are made. */
  readonly rewrittenCollections: ReadonlySet<string>;
  /** The stored names of the moving models' documents that change, from the origin's to the destination's. */
  readonly storedNameMoves: readonly { readonly from: string; readonly to: string }[];
}

function fieldStagesOf(moves: DocumentMoveOrderInput['storedNameMoves']): readonly Document[] {
  if (moves.length === 0) return [];
  const written = new Set(moves.map(({ to }) => to));
  const unset = moves.map(({ from }) => from).filter((from) => !written.has(from));
  return [
    { $set: Object.fromEntries(moves.map(({ from, to }) => [to, `$${from}`])) },
    ...(unset.length === 0 ? [] : [{ $unset: unset }]),
  ];
}

/**
 * Where a document move goes in a plan, from what the plan does to the target. The planner orders
 * operations by kind, so the move must come after the operation that brings the target into being
 * and before every operation on the source. When the target has a validator at that point and the
 * plan replaces or removes it later, the copy skips validation, as the plan's own rewrites do, and
 * the validator update checks the moved documents.
 */
export function documentMoveOrder(input: DocumentMoveOrderInput): DocumentMoveOrder {
  const { from, to } = input;
  if (input.collectionRenames.some((rename) => rename.from === from)) {
    throw new InternalError(`A document move reads collection "${from}", which the plan renames`);
  }
  const origin = input.schema;
  const destination = contractToMongoSchemaIR(input.contract);
  const plan = collectionPlanOf(
    to,
    { origin, destination, writtenDestination: destination },
    { contract: input.contract, fromContract: input.fromContract },
  );
  const diff = plan.kind === 'planned' ? plan.diff : undefined;
  const renamed = input.collectionRenames.find((rename) => rename.to === to);
  const after: DocumentMoveAfter | undefined =
    diff !== undefined && diff.collCreates.length > 0
      ? { kind: 'createCollection' }
      : renamed === undefined
        ? undefined
        : { kind: 'renameCollection', from: renamed.from };
  const validatorChange =
    diff === undefined ||
    diff.validatorOps.length === 0 ||
    origin.collection(to)?.validator === undefined
      ? undefined
      : destination.collection(to)?.validator === undefined
        ? 'removed'
        : 'replaced';
  return {
    after,
    bypassDocumentValidation: validatorChange !== undefined,
    validatorChange,
    twoPlans: input.rewrittenCollections.has(to),
    fieldStages: fieldStagesOf(input.storedNameMoves),
  };
}
