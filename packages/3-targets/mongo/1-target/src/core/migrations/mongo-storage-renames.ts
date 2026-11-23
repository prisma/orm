import type { ContractWithDomain, ControlPolicy } from '@internal/contract/types';
import {
  type FieldCoordinate,
  type MigrationPlannerConflict,
  type ModelCoordinate,
  modelDisplayName,
  type ResolvedFieldRenameStatement,
  type ResolvedMigrationStatement,
  type ResolvedModelRenameStatement,
  type ResolvedRenameStatement,
} from '@internal/framework-components/control';
import {
  collectionControlPoliciesOf,
  collectionControlPolicyOf,
  collectionOfModel,
  embeddingModelOf,
  mongoModelsOf,
} from '@internal/mongo-contract';
import { modelCoordinates, sameModel } from './mongo-model-coordinates';
import { handWrittenMigrationSteps, modelsText } from './mongo-plan-text';

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

/** A collection that moves from the origin contract to the destination contract, with the model renames that move it. */
export interface CollectionChange {
  readonly from: string;
  readonly to: string;
  readonly renames: readonly ModelRename[];
}

/**
 * Why a collection cannot be renamed whole: the origin models stored in it that move elsewhere
 * (`split`), the root models stored in it that the destination removes, whose documents no
 * discriminator selects (`removed`), or the origin models of destination models stored in the new
 * name that come from elsewhere (`merged`).
 */
export interface SharedCollection {
  readonly kind: 'split' | 'removed' | 'merged';
  readonly models: readonly ModelCoordinate[];
}

function hasModel(contract: ContractWithDomain, model: ModelCoordinate): boolean {
  return Object.hasOwn(contract.domain.namespaces[model.namespaceId]?.models ?? {}, model.model);
}

/** The collection whose top-level documents are the model's: `undefined` for an embedded model or one with no collection. */
function documentCollectionOf(
  contract: ContractWithDomain,
  model: ModelCoordinate,
): string | undefined {
  return embeddingModelOf(contract.domain, model) === undefined
    ? collectionOfModel(contract.domain, model)
    : undefined;
}

/** The models of `contract` whose documents are the top-level documents of `collection`. */
function modelsStoredIn(
  contract: ContractWithDomain,
  collection: string,
): readonly ModelCoordinate[] {
  return modelCoordinates(contract).filter(
    (model) => documentCollectionOf(contract, model) === collection,
  );
}

/**
 * The model renames of a plan: each model rename statement, and, with an origin contract, each
 * origin model the destination has under its namespace and name and that no statement names.
 */
export function modelRenamesOf(
  statements: readonly ResolvedRenameStatement[],
  fromContract: ContractWithDomain | null,
  contract: ContractWithDomain,
): readonly ModelRename[] {
  const stated = statements.flatMap((statement) =>
    statement.entity === 'model' ? [{ from: statement.from, to: statement.to, statement }] : [],
  );
  if (fromContract === null) return stated;
  const named = (model: ModelCoordinate) =>
    stated.some((rename) => sameModel(rename.from, model) || sameModel(rename.to, model));
  const kept = modelCoordinates(fromContract).flatMap((model) =>
    hasModel(contract, model) && !named(model)
      ? [{ from: model, to: model, statement: undefined }]
      : [],
  );
  return [...stated, ...kept];
}

/** The control policy of `collection` as `contract` declares it. */
export function collectionControlPolicy(
  contract: ContractWithDomain,
  collection: string,
): ControlPolicy {
  return collectionControlPolicyOf(collection, collectionControlPoliciesOf(contract));
}

/** Whether the control policy is `managed` for collection `from` in the origin contract and collection `to` in the destination contract, as a rename between them needs. */
export function managedOnBothSides(
  fromContract: ContractWithDomain,
  contract: ContractWithDomain,
  change: { readonly from: string; readonly to: string },
): boolean {
  return (
    collectionControlPolicy(fromContract, change.from) === 'managed' &&
    collectionControlPolicy(contract, change.to) === 'managed'
  );
}

/**
 * An origin root model whose documents stay in a collection it shares, with no discriminator, with
 * a root model that stays there: the model moves to collection `to`, or the destination removes it
 * (`to` is `undefined`).
 */
export interface LeftBehind {
  readonly model: ModelCoordinate;
  readonly collection: string;
  readonly to: string | undefined;
}

function isRootModel(contract: ContractWithDomain, model: ModelCoordinate): boolean {
  return mongoModelsOf(contract.domain, model.namespaceId)[model.model]?.base === undefined;
}

/** The collections the model renames move, each with the renames that move it, in the order of the renames. */
export class CollectionRenames {
  readonly changes: readonly CollectionChange[];
  readonly #models: readonly ModelRename[];
  readonly #fromContract: ContractWithDomain;
  readonly #contract: ContractWithDomain;

  constructor(
    models: readonly ModelRename[],
    fromContract: ContractWithDomain,
    contract: ContractWithDomain,
  ) {
    this.#models = models;
    this.#fromContract = fromContract;
    this.#contract = contract;
    const changes = new Map<string, { from: string; to: string; renames: ModelRename[] }>();
    for (const rename of models) {
      const from = documentCollectionOf(fromContract, rename.from);
      const to = documentCollectionOf(contract, rename.to);
      if (from === undefined || to === undefined || from === to) continue;
      const key = JSON.stringify([from, to]);
      const change = changes.get(key);
      if (change === undefined) changes.set(key, { from, to, renames: [rename] });
      else change.renames.push(rename);
    }
    this.changes = [...changes.values()];
  }

  /** The change that moves the collection of `rename`'s origin model, if its collection changes. */
  changeOf(rename: ModelRename): CollectionChange | undefined {
    return this.changes.find((change) => change.renames.includes(rename));
  }

  /** Whether the control policy is `managed` for the old collection in the origin contract and the new one in the destination contract. */
  managedOnBothSides(change: Pick<CollectionChange, 'from' | 'to'>): boolean {
    return managedOnBothSides(this.#fromContract, this.#contract, change);
  }

  /**
   * Why the documents of collection `from` cannot move whole to collection `to`: an origin model
   * stored in it that the destination keeps in another collection, or a destination model stored in
   * the new collection whose origin model is stored elsewhere. Models pair through the renames.
   * `undefined` when the whole collection moves and nothing else moves there. A root model the
   * destination removes blocks the rename, since no discriminator selects its documents to ask
   * about them; a removed variant, whose documents are selected and asked about, and a new model
   * block nothing.
   */
  sharedCollection(change: Pick<CollectionChange, 'from' | 'to'>): SharedCollection | undefined {
    const split = modelsStoredIn(this.#fromContract, change.from).filter((model) => {
      const rename = this.#models.find((each) => sameModel(each.from, model));
      const destination =
        rename === undefined ? undefined : documentCollectionOf(this.#contract, rename.to);
      return destination !== undefined && destination !== change.to;
    });
    if (split.length > 0) return { kind: 'split', models: split };
    const removed = modelsStoredIn(this.#fromContract, change.from).filter(
      (model) =>
        !this.#models.some((each) => sameModel(each.from, model)) &&
        mongoModelsOf(this.#fromContract.domain, model.namespaceId)[model.model]?.base ===
          undefined,
    );
    if (removed.length > 0) return { kind: 'removed', models: removed };
    const merged = modelsStoredIn(this.#contract, change.to).flatMap((model) => {
      const rename = this.#models.find((each) => sameModel(each.to, model));
      const origin =
        rename === undefined ? undefined : documentCollectionOf(this.#fromContract, rename.from);
      return rename !== undefined && origin !== undefined && origin !== change.from
        ? [rename.from]
        : [];
    });
    return merged.length > 0 ? { kind: 'merged', models: merged } : undefined;
  }

  #destinationCollectionOf(model: ModelCoordinate): string | undefined {
    const rename = this.#models.find((each) => sameModel(each.from, model));
    return rename === undefined ? undefined : documentCollectionOf(this.#contract, rename.to);
  }

  /**
   * The origin root models that leave a collection another root model stays in. Nothing in their
   * documents says which root model they belong to, so the plan can neither move nor remove them:
   * they stay, and are read as documents of the models that stay.
   */
  leftBehind(): readonly LeftBehind[] {
    const collections = new Set(
      modelCoordinates(this.#fromContract).flatMap((model) => {
        const collection = documentCollectionOf(this.#fromContract, model);
        return collection === undefined ? [] : [collection];
      }),
    );
    return [...collections].flatMap((collection) => {
      const roots = modelsStoredIn(this.#fromContract, collection).filter((model) =>
        isRootModel(this.#fromContract, model),
      );
      const stays = (model: ModelCoordinate) => this.#destinationCollectionOf(model) === collection;
      if (!roots.some(stays)) return [];
      return roots
        .filter((model) => !stays(model))
        .map((model) => ({ model, collection, to: this.#destinationCollectionOf(model) }));
    });
  }

  /** Why the documents of a model left behind stay where they are, and how to move or remove them. */
  leftBehindAdvice(left: LeftBehind): string {
    const byName = (a: ModelCoordinate, b: ModelCoordinate) =>
      modelDisplayName(a).localeCompare(modelDisplayName(b));
    const roots = modelsStoredIn(this.#fromContract, left.collection)
      .filter((model) => isRootModel(this.#fromContract, model))
      .sort(byName);
    const stays = roots.filter((model) => this.#destinationCollectionOf(model) === left.collection);
    const moving = modelsText([left.model]);
    const start = `The origin stores ${modelsText(roots)} in collection "${left.collection}", and no discriminator tells their documents apart, so the plan cannot ${left.to === undefined ? 'remove' : `move to collection "${left.to}"`} the documents of ${moving}: they stay in collection "${left.collection}", where they are read as documents of ${modelsText(stays)}.`;
    const route =
      left.to === undefined
        ? `Removing them is a data migration, which a plan does not write. With migration plan, write this change as a hand-written migration instead: ${handWrittenMigrationSteps(`the documents of ${moving}`)}`
        : dataMigration(`the documents of ${moving} into collection "${left.to}"`);
    return `${start} ${route} ${leftWhereTheyAre(left.collection)}`;
  }

  /**
   * Why the documents of collection `from` cannot be kept by renaming it to `to`: the storage of
   * the models stored there is being split or merged. Keeping their documents is then a data
   * migration.
   */
  sharedStorageAdvice(
    change: Pick<CollectionChange, 'from' | 'to'>,
    shared: SharedCollection,
  ): string {
    const byName = (a: ModelCoordinate, b: ModelCoordinate) =>
      modelDisplayName(a).localeCompare(modelDisplayName(b));
    const destinationOf = (model: ModelCoordinate) => {
      const rename = this.#models.find((each) => sameModel(each.from, model));
      return rename === undefined ? undefined : documentCollectionOf(this.#contract, rename.to);
    };
    const origin = [...modelsStoredIn(this.#fromContract, change.from)].sort(byName);
    if (shared.kind === 'merged') {
      const models = modelsStoredIn(this.#contract, change.to)
        .flatMap((model) => {
          const rename = this.#models.find((each) => sameModel(each.to, model));
          return rename === undefined ||
            documentCollectionOf(this.#fromContract, rename.from) === undefined
            ? []
            : [rename.from];
        })
        .sort(byName);
      return `The destination stores ${modelsText(models)} in collection "${change.to}", and the origin stores them in different collections, so their storage is being merged. ${dataMigration(`the documents of ${modelsText(models)} into collection "${change.to}"`)}`;
    }
    const kept = origin.filter((model) => destinationOf(model) !== undefined);
    const into = new Map<string, ModelCoordinate[]>();
    for (const model of kept) {
      const moved = destinationOf(model);
      if (moved !== undefined) into.set(moved, [...(into.get(moved) ?? []), model]);
    }
    const moves = [...into]
      .map(
        ([collection, moved]) =>
          `the documents of ${modelsText(moved)} into collection "${collection}"`,
      )
      .join(' and ');
    if (shared.kind === 'removed') {
      return `The origin stores ${modelsText(origin)} in collection "${change.from}", no discriminator tells their documents apart, and the destination removes ${modelsText(shared.models)}, so their storage is being split. ${dataMigration(moves)}`;
    }
    return `The origin stores ${modelsText(origin)} in collection "${change.from}", and the destination stores them in different collections, so their storage is being split. ${dataMigration(moves)}`;
  }
}

/** What answering `--delete` for documents left behind in `collection` does. */
function leftWhereTheyAre(collection: string): string {
  return `Answered with --delete, the plan leaves them where they are; if the new validator of collection "${collection}" does not accept them, its change stops the apply until you delete or move them in the database.`;
}

function dataMigration(moves: string): string {
  return `Keeping their documents is a data migration, which a plan does not write. With migration plan, write this change as a hand-written migration instead: ${handWrittenMigrationSteps(moves)}`;
}

/** What a collection change does, in words: the statement that asks for it, or the contract change. */
export function collectionChangeText(change: CollectionChange): string {
  const stated = change.renames.find((rename) => rename.statement !== undefined);
  return stated === undefined
    ? `the collection of ${modelsText(change.renames.map((rename) => rename.from))} changes from "${change.from}" to "${change.to}"`
    : `model "${modelDisplayName(stated.from)}" is renamed to "${modelDisplayName(stated.to)}", which renames collection "${change.from}" to "${change.to}"`;
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
): MigrationPlannerConflict {
  return statement === undefined
    ? { kind: 'unsupportedOperation', summary, why }
    : { kind: 'statementRefused', summary, why, refusedStatement: statement };
}
