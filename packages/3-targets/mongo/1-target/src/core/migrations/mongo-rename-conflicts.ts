import type { ContractWithDomain } from '@internal/contract/types';
import {
  type FieldCoordinate,
  type MigrationPlannerConflict,
  type ModelCoordinate,
  modelDisplayName,
} from '@internal/framework-components/control';
import {
  collectionOfModel,
  embeddingModelOf,
  modelAndBasesOf,
  mongoModelsOf,
  otherModelsReached,
  ownStoredNamesOf,
  selectedVariantOf,
} from '@internal/mongo-contract';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { modelCoordinates } from './mongo-model-coordinates';
import {
  type CollectionChange,
  capitalized,
  collectionChangeText,
  type FieldRename,
  fieldDisplayName,
  joinedList,
  modelsText,
  renameRefused,
  storedNameChangeText,
} from './mongo-storage-renames';

/** A field rename the plan makes, with the collection it is made in and the stored names it moves between. */
export interface FieldChange {
  readonly rename: FieldRename;
  readonly collection: string;
  readonly from: string;
  readonly to: string;
}

const ORDER =
  'A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out';

function hasStatement(change: CollectionChange): boolean {
  return change.renames.some((rename) => rename.statement !== undefined);
}

function fieldsText(fields: readonly FieldCoordinate[]): string {
  const names = fields.map((field) => `"${fieldDisplayName(field)}"`);
  return `field${names.length === 1 ? '' : 's'} ${joinedList(names)}`;
}

/** What a collection change does, in words: the statement that asks for it, or the contract change. */
function changeText(change: CollectionChange): string {
  const stated = change.renames.find((rename) => rename.statement !== undefined);
  return stated === undefined
    ? collectionChangeText(change)
    : `model "${modelDisplayName(stated.from)}" is renamed to "${modelDisplayName(stated.to)}", which renames collection "${change.from}" to "${change.to}"`;
}

function fieldChangeText(change: FieldChange): string {
  return change.rename.statement === undefined
    ? storedNameChangeText(change.rename.from, change.from, change.to)
    : `field "${fieldDisplayName(change.rename.from)}" is renamed to "${fieldDisplayName(change.rename.to)}", which renames field "${change.from}" to "${change.to}" in collection "${change.collection}"`;
}

/** A name for `name` to move through that is not in `used`. */
function unused(used: readonly string[], name: string): string {
  let candidate = `prisma_swap_${name}`;
  while (used.includes(candidate)) candidate = `${candidate}_`;
  return candidate;
}

function collectionsOf(contract: ContractWithDomain): readonly string[] {
  return Object.values(contract.storage.namespaces).flatMap((namespace) =>
    Object.keys(namespace.entries['collection'] ?? {}),
  );
}

/** One object's move in the route through names nothing uses: what moves, through which name, to which. */
interface RouteMove {
  readonly objects: string;
  readonly through: string;
  readonly to: string;
}

/**
 * The route that works on both commands for a chain or swap of names: a plan that moves each
 * object to a name nothing uses, then a plan that moves it to its final name.
 */
function temporaryNamesRoute(
  noun: 'collection' | 'stored name',
  moves: readonly RouteMove[],
  withStatements: boolean,
): string {
  const give = (name: (move: RouteMove) => string) =>
    joinedList(moves.map((move) => `${move.objects} the ${noun} "${name(move)}"`));
  return `Make the change in two plans: first give ${give(({ through }) => through)}, ${noun}s nothing uses, and plan and apply that${withStatements ? ' with the same statements' : ''}; then give ${give(({ to }) => to)}, and plan again${withStatements ? ' without them' : ''}.`;
}

/**
 * The changes of `pair` and every change of `changes` linked to them by a name one frees and
 * another takes, in either direction, in the order `pair`, the changes after it in the chain, then
 * those before it.
 */
function linkedChanges<TChange>(
  pair: readonly [TChange, TChange],
  changes: readonly TChange[],
  takesFrom: (taker: TChange, freer: TChange) => boolean,
): readonly TChange[] {
  const linked: TChange[] = [...pair];
  for (const current of linked) {
    for (const other of changes) {
      if (linked.includes(other)) continue;
      if (takesFrom(current, other) || takesFrom(other, current)) linked.push(other);
    }
  }
  const ordered: TChange[] = [...pair];
  const follow = (from: TChange, step: (change: TChange) => TChange | undefined) => {
    for (let next = step(from); next !== undefined && !ordered.includes(next); next = step(next)) {
      ordered.push(next);
    }
  };
  follow(pair[1], (change) => linked.find((other) => takesFrom(change, other)));
  follow(pair[0], (change) => linked.find((other) => takesFrom(other, change)));
  return [...ordered, ...linked.filter((change) => !ordered.includes(change))];
}

/** How the first of two plans frees a name: it removes what the origin stores there, or gives it a name nothing uses. */
function freeName(
  noun: 'collection' | 'stored name',
  held: string,
  holders: { readonly text: string; readonly count: number },
  unusedName: string,
): string {
  if (holders.count === 0) {
    return `remove ${noun} "${held}" or give it a name nothing uses, such as "${unusedName}"`;
  }
  const [them, their] = holders.count === 1 ? ['it', 'its'] : ['them', 'their'];
  return `remove ${holders.text}, or keep ${them} and change ${their} ${noun} to a name nothing uses, such as "${unusedName}"`;
}

interface Contracts {
  readonly fromContract: ContractWithDomain;
  readonly contract: ContractWithDomain;
}

function collectionRoute(
  pair: readonly [CollectionChange, CollectionChange],
  changes: readonly CollectionChange[],
  contracts: Contracts,
): string {
  const linked = linkedChanges(pair, changes, (taker, freer) => taker.to === freer.from);
  const used = [...collectionsOf(contracts.fromContract), ...collectionsOf(contracts.contract)];
  const reserved: string[] = [];
  const moves = linked.map((moving) => {
    const through = unused([...used, ...reserved], moving.to);
    reserved.push(through);
    return {
      objects: modelsText(moving.renames.map((rename) => rename.to)),
      through,
      to: moving.to,
    };
  });
  return temporaryNamesRoute('collection', moves, linked.some(hasStatement));
}

function originModelsIn(fromContract: ContractWithDomain, collection: string) {
  return modelCoordinates(fromContract).filter(
    (model) =>
      embeddingModelOf(fromContract.domain, model) === undefined &&
      collectionOfModel(fromContract.domain, model) === collection,
  );
}

/** Whether the origin contract has collection `name`. */
function originHasCollection(fromContract: ContractWithDomain, name: string): boolean {
  return (
    collectionsOf(fromContract).includes(name) || originModelsIn(fromContract, name).length > 0
  );
}

/** The collection the destination stores a model of that name in, if it keeps one. */
function destinationCollectionOf(
  contract: ContractWithDomain,
  model: ModelCoordinate,
): string | undefined {
  return Object.hasOwn(contract.domain.namespaces[model.namespaceId]?.models ?? {}, model.model) &&
    embeddingModelOf(contract.domain, model) === undefined
    ? collectionOfModel(contract.domain, model)
    : undefined;
}

/**
 * Why the plan does not move the models of collection `held` out of its way, when they move to a
 * collection that models of other collections move to as well: their storage is being merged.
 */
function mergedText(
  holders: readonly ModelCoordinate[],
  held: string,
  contracts: Contracts,
): string {
  const moves = holders.flatMap((holder) => {
    const to = destinationCollectionOf(contracts.contract, holder);
    if (to === undefined || to === held) return [];
    const joining = modelCoordinates(contracts.fromContract).filter(
      (model) =>
        !holders.some(
          (each) => each.namespaceId === model.namespaceId && each.model === model.model,
        ) &&
        collectionOfModel(contracts.fromContract.domain, model) !== held &&
        embeddingModelOf(contracts.fromContract.domain, model) === undefined &&
        destinationCollectionOf(contracts.contract, model) === to,
    );
    return joining.length === 0
      ? []
      : [
          `${capitalized(modelsText([holder]))} moves to collection "${to}" with ${modelsText(joining)}, whose documents are in another collection, so their storage is being merged, which the plan does not do, and collection "${held}" keeps its name. `,
        ];
  });
  return moves.join('');
}

/**
 * Refuses a collection rename no statement asks for when it swaps or chains with another rename,
 * moves onto a collection the schema being planned from already has, or moves out of a name a
 * statement rename takes. `held` is the schema before any rename is applied, so the outcome does
 * not depend on the order of the renames. `undefined` when the rename can be planned.
 */
function collectionRenameConflict(
  change: CollectionChange,
  changes: readonly CollectionChange[],
  schema: MongoSchemaIR,
  contracts: Contracts,
): MigrationPlannerConflict | undefined {
  const { from, to } = change;
  const label = `Cannot rename collection "${from}" to "${to}"`;
  const text = capitalized(changeText(change));
  const moving = modelsText(change.renames.map((rename) => rename.from));
  const misread = (collection: string) =>
    `documents of collection "${collection}" as documents of ${moving}`;
  const others = changes.filter((other) => other !== change);
  if (schema.collection(to) !== undefined) {
    const moved = others.find((other) => other.from === to);
    if (moved !== undefined) {
      return renameRefused(
        undefined,
        `${label}: collection "${to}" is renamed in the same plan`,
        `${text}, and ${changeText(moved)}. ${ORDER}, and without the renames the plan would read the ${misread(to)}. ${collectionRoute([change, moved], others, contracts)}`,
      );
    }
    const holders = originModelsIn(contracts.fromContract, to);
    const used = [...collectionsOf(contracts.fromContract), ...collectionsOf(contracts.contract)];
    return renameRefused(
      undefined,
      `${label}: the schema being planned from already has a collection "${to}"`,
      `${text}, and the schema being planned from already has collection "${to}"${holders.length === 0 ? '' : `, the collection of ${modelsText(holders)}`}. ${mergedText(holders, to, contracts)}Without the rename the plan would read the ${misread(to)}. Make the change in two plans: first ${freeName('collection', to, { text: modelsText(holders), count: holders.length }, unused(used, to))}, and plan and apply that; then make this change and plan again.`,
    );
  }
  const takes = others.find((other) => hasStatement(other) && other.to === from);
  if (takes !== undefined) {
    return renameRefused(
      undefined,
      `${label}: another rename in the same plan takes collection name "${from}"`,
      `${text}, and ${changeText(takes)}. ${ORDER}. ${collectionRoute([change, takes], others, contracts)}`,
    );
  }
  return undefined;
}

/**
 * The refusal of a collection rename whose old and new collections the database both has, while
 * the origin contract has only the old one: the rename was half done, the application wrote to the
 * new collection first, or the old collection was renamed by hand and its name used again.
 */
function bothCollectionsRefusal(change: CollectionChange): MigrationPlannerConflict {
  const { from, to } = change;
  const moving = modelsText(change.renames.map((rename) => rename.from));
  return renameRefused(
    undefined,
    `Cannot rename collection "${from}" to "${to}": the database has both collections`,
    `${capitalized(changeText(change))}, and the database has both collection "${from}" and collection "${to}". One of two things happened, and each has its own fix. If the rename was half done by hand, or the application wrote to collection "${to}" before db update ran, collection "${from}" holds the documents of ${moving}: move into collection "${from}" the documents of collection "${to}" that it does not already hold, and where both collections hold a document with the same _id, keep the version you want in collection "${from}"; then drop collection "${to}", and run again. If collection "${from}" was renamed to "${to}" by hand and the name "${from}" then used for another collection, collection "${to}" holds the documents of ${moving}: drop collection "${from}", and run again; to keep the documents of that other collection, first move them into a collection the contract has, since db update drops every collection the contract does not have.`,
  );
}

/**
 * The collection renames no statement asks for that the plan makes, checked against every rename
 * of the plan before any is applied, against the schema being planned from, or the first that
 * cannot be planned. A rename whose old collection the schema lacks and whose new one it has is
 * already done: it is found, so the plan records where the documents are and plans no operation
 * for it. One whose old and new collections the schema both has, while the origin contract does
 * not have the new one, is refused. One whose collections the schema lacks plans nothing.
 */
export function plannedCollectionChanges(
  candidates: readonly CollectionChange[],
  stated: readonly CollectionChange[],
  schema: MongoSchemaIR,
  contracts: Contracts,
):
  | {
      readonly kind: 'planned';
      readonly changes: readonly CollectionChange[];
      readonly found: readonly CollectionChange[];
    }
  | { readonly kind: 'refused'; readonly conflict: MigrationPlannerConflict } {
  const changes = [...stated, ...candidates];
  const planned: CollectionChange[] = [];
  const found: CollectionChange[] = [];
  for (const change of [...candidates].sort((a, b) => a.from.localeCompare(b.from))) {
    const hasOld = schema.collection(change.from) !== undefined;
    const hasNew = schema.collection(change.to) !== undefined;
    const originHasNew = originHasCollection(contracts.fromContract, change.to);
    if (!hasOld && !hasNew) continue;
    if (!hasOld && !originHasNew) {
      found.push(change);
      continue;
    }
    if (hasOld && hasNew && !originHasNew) {
      return { kind: 'refused', conflict: bothCollectionsRefusal(change) };
    }
    const conflict = collectionRenameConflict(change, changes, schema, contracts);
    if (conflict !== undefined) return { kind: 'refused', conflict };
    planned.push(change);
  }
  return {
    kind: 'planned',
    changes: candidates.filter((change) => planned.includes(change)),
    found: candidates.filter((change) => found.includes(change)),
  };
}

/**
 * The models of the origin contract whose documents a rename of `field` reaches: its model and its
 * bases, the variants of a root model, and the other models stored in its collection whose
 * documents the rename's filter can select. A rename of a key of an embedded model reaches the
 * objects of that model and its bases only.
 */
function modelsReached(
  fromContract: ContractWithDomain,
  field: FieldCoordinate,
): readonly string[] {
  const models = mongoModelsOf(fromContract.domain, field.namespaceId);
  const own = [field.model];
  for (let base = models[field.model]?.base; base !== undefined; base = models[base.model]?.base) {
    if (own.includes(base.model)) break;
    own.push(base.model);
  }
  if (embeddingModelOf(fromContract.domain, field) !== undefined) return own;
  const variant = selectedVariantOf(fromContract.domain, field);
  const variants =
    variant === undefined
      ? Object.values(models[field.model]?.variants ?? {}).map(({ model }) => model)
      : [];
  const collection = collectionOfModel(fromContract.domain, field);
  const others =
    collection === undefined
      ? []
      : otherModelsReached(fromContract.domain, field, collection, variant, undefined);
  return [...new Set([...own, ...variants, ...others])];
}

/** The fields of the origin contract stored as `storedName` in the documents a rename of `field` reaches. */
function originFieldsStoring(
  fromContract: ContractWithDomain,
  field: FieldCoordinate,
  storedName: string,
): readonly FieldCoordinate[] {
  const models = mongoModelsOf(fromContract.domain, field.namespaceId);
  return modelsReached(fromContract, field).flatMap((model) => {
    const definition = models[model];
    return definition === undefined
      ? []
      : Object.entries(ownStoredNamesOf(definition)).flatMap(([name, stored]) =>
          stored === storedName ? [{ namespaceId: field.namespaceId, model, field: name }] : [],
        );
  });
}

function storedNamesOf(contract: ContractWithDomain, model: ModelCoordinate): readonly string[] {
  return modelAndBasesOf(mongoModelsOf(contract.domain, model.namespaceId), model.model).flatMap(
    (each) => Object.values(ownStoredNamesOf(each)),
  );
}

function fieldRoute(
  pair: readonly [FieldChange, FieldChange],
  changes: readonly FieldChange[],
  contracts: Contracts,
): string {
  const linked = linkedChanges(pair, changes, (taker, freer) => taker.to === freer.from);
  const used = [
    ...storedNamesOf(contracts.fromContract, pair[0].rename.from),
    ...storedNamesOf(contracts.contract, pair[0].rename.to),
  ];
  const reserved: string[] = [];
  const moves = linked.map((moving) => {
    const through = unused([...used, ...reserved], moving.to);
    reserved.push(through);
    return { objects: fieldsText([moving.rename.to]), through, to: moving.to };
  });
  return temporaryNamesRoute(
    'stored name',
    moves,
    linked.some((change) => change.rename.statement !== undefined),
  );
}

/**
 * Refuses a field rename no statement asks for when it swaps or chains with another field rename
 * in the documents of the same model, takes the stored name of a field the destination removes, or
 * moves out of a stored name a statement rename takes. `undefined` when it can be planned.
 */
function fieldRenameConflict(
  change: FieldChange,
  changes: readonly FieldChange[],
  contracts: Contracts,
): MigrationPlannerConflict | undefined {
  const label = `Cannot rename field "${change.from}" to "${change.to}" in collection "${change.collection}"`;
  const text = capitalized(fieldChangeText(change));
  const moving = fieldsText([change.rename.from]);
  const misread = (stored: string) => `values of field "${stored}" as values of ${moving}`;
  const reached = modelsReached(contracts.fromContract, change.rename.from);
  const others = changes.filter(
    (other) =>
      other !== change &&
      other.collection === change.collection &&
      other.rename.from.namespaceId === change.rename.from.namespaceId &&
      reached.includes(other.rename.from.model),
  );
  const holders = originFieldsStoring(contracts.fromContract, change.rename.from, change.to);
  if (holders.length > 0) {
    const moved = others.find((other) => other.from === change.to);
    if (moved !== undefined) {
      return renameRefused(
        undefined,
        `${label}: field "${change.to}" is renamed in the same plan`,
        `${text}, and ${fieldChangeText(moved)}. ${ORDER}, and without the renames the plan would read the ${misread(change.to)}. ${fieldRoute([change, moved], others, contracts)}`,
      );
    }
    const used = [
      ...storedNamesOf(contracts.fromContract, change.rename.from),
      ...storedNamesOf(contracts.contract, change.rename.to),
      ...holders.flatMap((holder) => storedNamesOf(contracts.fromContract, holder)),
    ];
    return renameRefused(
      undefined,
      `${label}: the documents already hold field "${change.to}"`,
      `${text}, and the documents already hold field "${change.to}", the stored name of ${fieldsText(holders)}. Without the rename the plan would read the ${misread(change.to)}. Make the change in two plans: first ${freeName('stored name', change.to, { text: fieldsText(holders), count: holders.length }, unused(used, change.to))}, and plan and apply that; then make this change and plan again.`,
    );
  }
  const takes = others.find(
    (other) => other.rename.statement !== undefined && other.to === change.from,
  );
  if (takes !== undefined) {
    return renameRefused(
      undefined,
      `${label}: another rename in the same plan takes stored name "${change.from}"`,
      `${text}, and ${fieldChangeText(takes)}. ${ORDER}. ${fieldRoute([change, takes], others, contracts)}`,
    );
  }
  return undefined;
}

/** The first field rename no statement asks for that cannot be planned against every field rename of the plan. */
export function fieldRenamesConflict(
  changes: readonly FieldChange[],
  contracts: Contracts,
): MigrationPlannerConflict | undefined {
  for (const change of changes) {
    if (change.rename.statement !== undefined) continue;
    const conflict = fieldRenameConflict(change, changes, contracts);
    if (conflict !== undefined) return conflict;
  }
  return undefined;
}
