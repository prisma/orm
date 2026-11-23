import type { ContractWithDomain } from '@internal/contract/types';
import type {
  MigrationPlannerConflict,
  ModelCoordinate,
  ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import {
  otherModelsReached,
  type SelectedVariant,
  validatorRootShapesOf,
} from '@internal/mongo-contract';
import type { MongoFieldRewriteMeta } from '@internal/mongo-query-ast/control';
import { renameRefused } from './mongo-storage-renames';

export const SEPARATE_THE_MODELS =
  'move the models to separate collections, or carry out the change yourself, with a filter that selects only their documents, in a dataTransform operation of the migration.ts that migration plan writes or in mongosh';

export function sharedCollectionWhy(
  collection: string,
  others: readonly string[],
  change: string,
): string {
  const names = others.map((name) => JSON.stringify(name)).join(', ');
  return `Collection ${JSON.stringify(collection)} stores several models and no discriminator tells their documents apart, so ${change} of ${names} too.`;
}

export const TIME_SERIES_UPDATES =
  'MongoDB updates the documents of a time-series collection only through its metaField';

/** What a planned rewrite does to a field's documents: a kind an operation's `meta.rewrite` names, or one carried out by an operation that names none. */
export type RewriteKind = MongoFieldRewriteMeta['kind'] | 'removal' | 'conversion' | 'backfill';

/** A rewrite the plan writes into one collection's documents, as its refusals read it. */
export interface PlannedRewrite {
  readonly kind: RewriteKind;
  readonly collection: string;
  /** The stored name of the field the rewrite changes. */
  readonly field: string;
  /** The variant whose documents it selects; `undefined` for a root model's documents. */
  readonly variant: SelectedVariant | undefined;
  /** The model whose documents it changes; `undefined` when no origin contract names it. */
  readonly model: ModelCoordinate | undefined;
  /** For a rewrite of a key inside the field: the field the key stores, in words, and the other models whose documents the same rewrite is planned for. */
  readonly storedKey: { readonly key: string; readonly together: readonly string[] } | undefined;
  /** For a rewrite no statement asks for, how to leave the change out of the contract instead; `undefined` for a statement's rewrite. */
  readonly keepAdvice: string | undefined;
  /** The statement that asks for the rewrite, which a refusal of a rename or a value replacement carries; `undefined` for a contract change. */
  readonly statement: ResolvedMigrationStatement | undefined;
}

interface RewriteWords {
  /** The kind of a refusal; `undefined` for a rename or a value replacement, refused as a statement or a contract change the plan cannot make. */
  readonly conflictKind: string | undefined;
  readonly verb: string;
  /** The verb for a key a rewrite names, as in "rename value object field "Address.street" inside". */
  readonly keyVerb: string | undefined;
  readonly preposition: string;
  /** Whether the rewrite reaches only the documents that hold the field, or every document its filter selects. */
  readonly reaches: 'holding' | 'selected';
  readonly timeSeries: string;
  readonly sharedChange: string;
  readonly sharedGoal: (model: string, others: string) => string;
}

const WORDS: Readonly<Record<RewriteKind, RewriteWords>> = {
  removal: {
    keyVerb: undefined,
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
    keyVerb: undefined,
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
    keyVerb: undefined,
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
    keyVerb: undefined,
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
    keyVerb: undefined,
    conflictKind: 'fieldFillRefused',
    verb: 'backfill',
    preposition: 'in',
    reaches: 'selected',
    timeSeries:
      'so a data transform cannot fill the field. Make the field optional in the contract, then run this command again.',
    sharedChange: 'the data transform would fill it in the documents',
    sharedGoal: (model) => `To fill it in ${model} documents only`,
  },
  renameStoredKey: {
    keyVerb: 'rename',
    conflictKind: undefined,
    verb: 'rename a key inside',
    preposition: 'in',
    reaches: 'holding',
    timeSeries:
      "so the key cannot be renamed in the documents. Keep the key's name in the contract, then run this command again.",
    sharedChange: 'renaming the key would rename it in the documents',
    sharedGoal: (model) => `To rename it in ${model} documents only`,
  },
  removeStoredKey: {
    keyVerb: 'remove',
    conflictKind: 'fieldRemovalRefused',
    verb: 'remove a key inside',
    preposition: 'in',
    reaches: 'holding',
    timeSeries:
      'so the key cannot be removed from the documents that hold it. Keep the key in the contract, as an optional field if new documents leave it out, then run this command again.',
    sharedChange: 'removing the key would remove it from the documents',
    sharedGoal: (_model, others) => `To keep it in ${others} documents only`,
  },
  replaceStoredValue: {
    keyVerb: 'replace',
    conflictKind: undefined,
    verb: 'replace a value inside',
    preposition: 'in',
    reaches: 'holding',
    timeSeries:
      "so the stored value cannot be replaced in the documents. Keep the enum value's stored value in the contract, then run this command again.",
    sharedChange: 'replacing the value would replace it in the documents',
    sharedGoal: (model) => `To replace it in ${model} documents only`,
  },
  removeStoredValue: {
    keyVerb: 'remove',
    conflictKind: 'fieldRemovalRefused',
    verb: 'remove a value inside',
    preposition: 'from',
    reaches: 'holding',
    timeSeries:
      'so the stored value cannot be removed from the documents that hold it. Keep the enum value in the contract, then run this command again.',
    sharedChange: 'removing the value would remove it from the documents',
    sharedGoal: (_model, others) => `To keep it in ${others} documents only`,
  },
  fillStoredKey: {
    keyVerb: 'fill',
    conflictKind: 'fieldFillRefused',
    verb: 'fill a key inside',
    preposition: 'in',
    reaches: 'holding',
    timeSeries:
      'so the key cannot be filled in the documents. Make the key optional in the contract, then run this command again.',
    sharedChange: 'filling the key would fill it in the documents',
    sharedGoal: (model) => `To fill it in ${model} documents only`,
  },
};

function quoted(names: readonly string[]): string {
  return names.map((name) => JSON.stringify(name)).join(', ');
}

/** What a rewrite's refusals read about its collection: whether it is a time-series collection, and its validator before the change. */
export interface RewriteCollection {
  readonly timeSeries: boolean;
  /** The `$jsonSchema` of the collection's validator before the change; `undefined` when it has none. */
  readonly validator: unknown;
}

/** What a rewrite does, as a refusal names it: the key it rewrites inside the field, when it names one. */
function action(rewrite: PlannedRewrite): string {
  const words = WORDS[rewrite.kind];
  return rewrite.storedKey !== undefined && words.keyVerb !== undefined
    ? `${words.keyVerb} ${rewrite.storedKey.key} inside`
    : words.verb;
}

/** The refusal of `rewrite`, of its kind's conflict kind, or built as a rename refusal when its kind has none. */
function refusalOf(
  rewrite: PlannedRewrite,
  summary: string,
  why: string,
): MigrationPlannerConflict {
  const { conflictKind } = WORDS[rewrite.kind];
  return conflictKind === undefined
    ? renameRefused(rewrite.statement, summary, why)
    : { kind: conflictKind, summary, why };
}

function timeSeriesRefusal(rewrite: PlannedRewrite): MigrationPlannerConflict {
  const words = WORDS[rewrite.kind];
  return refusalOf(
    rewrite,
    `Cannot ${action(rewrite)} field ${JSON.stringify(rewrite.field)} ${words.preposition} collection ${JSON.stringify(rewrite.collection)}: it is a time-series collection`,
    `${TIME_SERIES_UPDATES}, ${words.timeSeries}`,
  );
}

/**
 * The refusal of a rewrite whose documents another model stored in the same collection shares:
 * another root model when no discriminator value selects the rewrite's documents, or another root
 * model's variant with the same discriminator field and value. A removal, cast or conversion reaches
 * the models that hold the field; a fill or backfill reaches every model its filter selects. Without
 * an origin contract, a cast in a collection whose validator describes several root models is
 * refused, since nothing tells their documents apart.
 */
function sharedCollectionRefusal(
  rewrite: PlannedRewrite,
  contract: ContractWithDomain,
  validator: unknown,
): MigrationPlannerConflict | undefined {
  const words = WORDS[rewrite.kind];
  const { collection, field, model } = rewrite;
  if (model === undefined) {
    if (
      rewrite.kind === 'removal' ||
      rewrite.kind === 'removeStoredKey' ||
      validatorRootShapesOf(validator).length <= 1
    ) {
      return undefined;
    }
    return refusalOf(
      rewrite,
      `Cannot ${action(rewrite)} field ${JSON.stringify(field)} ${words.preposition} collection ${JSON.stringify(collection)}: the collection stores several root models`,
      'No discriminator tells their documents apart, and without the origin contract the plan cannot tell which documents belong to the model that changed. Plan the change with migration plan --from <hash of the migration the database is at>.',
    );
  }
  const others = otherModelsReached(
    contract.domain,
    model,
    collection,
    rewrite.variant,
    words.reaches === 'holding' ? field : undefined,
  ).filter((name) => !(rewrite.storedKey?.together.includes(name) ?? false));
  if (others.length === 0) return undefined;
  const named = quoted(others);
  const modelName = JSON.stringify(model.model);
  return refusalOf(
    rewrite,
    `Cannot ${action(rewrite)} field ${JSON.stringify(field)} of model ${modelName} ${words.preposition} collection ${JSON.stringify(collection)}: model ${named} ${words.reaches === 'holding' ? 'stores it' : 'is stored'} in the same collection`,
    `${sharedCollectionWhy(collection, others, words.sharedChange)} ${words.sharedGoal(modelName, named)}, ${rewrite.keepAdvice === undefined ? SEPARATE_THE_MODELS : `move the models to separate collections, or ${rewrite.keepAdvice}`}.`,
  );
}

/**
 * Why the plan refuses a rewrite of its collection's documents: MongoDB does not let an update change
 * a time-series collection's documents except through the metaField, and a rewrite must not change
 * the documents of another model stored in the same collection. The planner refuses every rewrite it
 * plans with these; the runner asks them before it names a statement that would plan one.
 */
export function rewriteRefusals(
  rewrite: PlannedRewrite,
  contract: ContractWithDomain,
  collection: RewriteCollection,
): readonly MigrationPlannerConflict[] {
  const shared = sharedCollectionRefusal(rewrite, contract, collection.validator);
  return [
    ...(collection.timeSeries ? [timeSeriesRefusal(rewrite)] : []),
    ...(shared === undefined ? [] : [shared]),
  ];
}
