import type { ContractWithDomain } from '@internal/contract/types';
import type {
  MigrationPlannerConflict,
  ModelCoordinate,
} from '@internal/framework-components/control';
import { validatorRootShapesOf } from '@internal/mongo-contract';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import {
  otherModelsReached,
  SEPARATE_THE_MODELS,
  sharedCollectionWhy,
  TIME_SERIES_UPDATES,
} from './mongo-statement-planning';

type Document = Record<string, unknown>;

/** What a planned rewrite does to a field's documents. */
export type RewriteKind = 'removal' | 'cast' | 'fill' | 'conversion' | 'backfill';

/** A rewrite the plan writes into one collection's documents, as its refusals read it. */
export interface PlannedRewrite {
  readonly kind: RewriteKind;
  readonly collection: string;
  /** The stored name of the field the rewrite changes. */
  readonly field: string;
  /** The documents it selects, such as a variant's discriminator value; `undefined` for all of them. */
  readonly filter: Document | undefined;
  /** The model whose documents it changes; `undefined` when no origin contract names it. */
  readonly model: ModelCoordinate | undefined;
}

interface RewriteWords {
  readonly conflictKind: string;
  readonly verb: string;
  readonly preposition: string;
  /** Whether the rewrite reaches only the documents that hold the field, or every document its filter selects. */
  readonly reaches: 'holding' | 'selected';
  readonly timeSeries: string;
  readonly sharedChange: string;
  readonly sharedGoal: (model: string, others: string) => string;
}

const WORDS: Readonly<Record<RewriteKind, RewriteWords>> = {
  removal: {
    conflictKind: 'fieldRemovalRefused',
    verb: 'remove',
    preposition: 'from',
    reaches: 'holding',
    timeSeries:
      'so the field cannot be removed from the documents that hold it. Keep the field in the contract, as an optional field if new documents leave it out, then run this command again.',
    sharedChange: 'removing the field would remove it from the documents',
    sharedGoal: (_model, others) => `To keep it in ${others} documents only`,
  },
  cast: {
    conflictKind: 'typeChangeRefused',
    verb: 'cast',
    preposition: 'in',
    reaches: 'holding',
    timeSeries:
      "so the values of the field cannot be cast. Keep the field's type in the contract, then run this command again.",
    sharedChange: 'casting the field would cast it in the documents',
    sharedGoal: (model) => `To change it in ${model} documents only`,
  },
  conversion: {
    conflictKind: 'typeChangeRefused',
    verb: 'convert',
    preposition: 'in',
    reaches: 'holding',
    timeSeries:
      "so a data transform cannot convert the values of the field. Keep the field's type in the contract, then run this command again.",
    sharedChange: 'the data transform would convert it in the documents',
    sharedGoal: (model) => `To change it in ${model} documents only`,
  },
  fill: {
    conflictKind: 'fieldFillRefused',
    verb: 'fill',
    preposition: 'in',
    reaches: 'selected',
    timeSeries:
      'so the field cannot be filled in the documents. Make the field optional in the contract, then run this command again.',
    sharedChange: 'filling the field would add it to the documents',
    sharedGoal: (model) => `To fill it in ${model} documents only`,
  },
  backfill: {
    conflictKind: 'fieldFillRefused',
    verb: 'backfill',
    preposition: 'in',
    reaches: 'selected',
    timeSeries:
      'so a data transform cannot fill the field. Make the field optional in the contract, then run this command again.',
    sharedChange: 'the data transform would fill it in the documents',
    sharedGoal: (model) => `To fill it in ${model} documents only`,
  },
};

function quoted(names: readonly string[]): string {
  return names.map((name) => JSON.stringify(name)).join(', ');
}

/** Each rewrite in a time-series collection, whose documents MongoDB does not let an update change except through the metaField. */
export function timeSeriesRefusals(
  rewrites: readonly PlannedRewrite[],
  schema: MongoSchemaIR,
): readonly MigrationPlannerConflict[] {
  return rewrites
    .filter((rewrite) => schema.collection(rewrite.collection)?.options?.timeseries !== undefined)
    .map((rewrite) => {
      const words = WORDS[rewrite.kind];
      return {
        kind: words.conflictKind,
        summary: `Cannot ${words.verb} field ${JSON.stringify(rewrite.field)} ${words.preposition} collection ${JSON.stringify(rewrite.collection)}: it is a time-series collection`,
        why: `${TIME_SERIES_UPDATES}, ${words.timeSeries}`,
      };
    });
}

/**
 * Each rewrite whose documents another model stored in the same collection shares: another root
 * model when no discriminator value selects the rewrite's documents, or another root model's
 * variant with the same discriminator field and value. A removal, cast or conversion reaches the
 * models that hold the field; a fill or backfill reaches every model its filter selects. Without
 * an origin contract, a cast in a collection whose validator describes several root models is
 * refused, since nothing tells their documents apart.
 */
export function sharedCollectionRefusals(
  rewrites: readonly PlannedRewrite[],
  contract: ContractWithDomain,
  schema: MongoSchemaIR,
): readonly MigrationPlannerConflict[] {
  return rewrites.flatMap((rewrite): MigrationPlannerConflict[] => {
    const words = WORDS[rewrite.kind];
    const { collection, field, model } = rewrite;
    if (model === undefined) {
      const roots = validatorRootShapesOf(schema.collection(collection)?.validator?.jsonSchema);
      if (rewrite.kind === 'removal' || roots.length <= 1) return [];
      return [
        {
          kind: words.conflictKind,
          summary: `Cannot ${words.verb} field ${JSON.stringify(field)} ${words.preposition} collection ${JSON.stringify(collection)}: the collection stores several root models`,
          why: 'No discriminator tells their documents apart, and without the origin contract the plan cannot tell which documents belong to the model that changed. Plan the change with migration plan --from <hash of the migration the database is at>.',
        },
      ];
    }
    const others = otherModelsReached(
      contract,
      model,
      collection,
      rewrite.filter,
      words.reaches === 'holding' ? field : undefined,
    );
    if (others.length === 0) return [];
    const named = quoted(others);
    const modelName = JSON.stringify(model.model);
    return [
      {
        kind: words.conflictKind,
        summary: `Cannot ${words.verb} field ${JSON.stringify(field)} of model ${modelName} ${words.preposition} collection ${JSON.stringify(collection)}: model ${named} ${words.reaches === 'holding' ? 'stores it' : 'is stored'} in the same collection`,
        why: `${sharedCollectionWhy(collection, others, words.sharedChange)} ${words.sharedGoal(modelName, named)}, ${SEPARATE_THE_MODELS}.`,
      },
    ];
  });
}
