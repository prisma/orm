import type { ContractModel, ContractRelation, ContractWithDomain } from '@internal/contract/types';
import {
  describeMigrationStatement,
  type FieldCoordinate,
  type MigrationPlannerConflict,
  type MigrationSubject,
  type ModelCoordinate,
  modelDisplayName,
  type ResolvedFieldRenameStatement,
  type ResolvedMigrationStatement,
  type ResolvedModelRenameStatement,
  type ResolvedRenameStatement,
} from '@internal/framework-components/control';
import {
  collectionOfModel,
  embeddingModelOf,
  hasOwnFieldStoredAs,
  type MongoContract,
  type MongoModelStorage,
  modelAndBasesOf,
  mongoModelsOf,
  otherModelsReached,
  ownEmbedStoredNamesOf,
  ownStoredNameOf,
  ownStoredNamesOf,
  type SelectedVariant,
  selectedVariantOf,
  validatorFieldNamesOf,
  validatorRootShapesOf,
  variantFilter,
} from '@internal/mongo-contract';
import { MongoSchemaCollection, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import { unrewritableFieldNameReason } from './migration-factories';
import { planCreatesCollection } from './mongo-collection-creates';
import { collectionControlPolicy, managedOnBothSides } from './mongo-control-policy';
import {
  documentCollectionOf,
  isRootModel,
  modelCoordinates,
  sameModel,
} from './mongo-model-coordinates';
import {
  capitalized,
  type DocumentMove,
  documentMoveSteps,
  handWrittenRoute,
  modelNamesText,
  modelsText,
} from './mongo-plan-text';
import {
  type FieldChange,
  fieldChangeText,
  fieldRenamesConflict,
  freedNameReusedConflict,
  plannedCollectionChanges,
} from './mongo-rename-conflicts';
import {
  type DiscriminatorFilter,
  type RewriteCall,
  variantDiscriminatorFilter,
} from './mongo-rewrite-overlaps';
import {
  SEPARATE_THE_MODELS,
  sharedCollectionWhy,
  TIME_SERIES_UPDATES,
} from './mongo-rewrite-refusals';
import {
  type CollectionChange,
  CollectionRenames,
  collectionChangeText,
  type FieldRename,
  type ModelRename,
  modelRenamesOf,
  renameRefused,
} from './mongo-storage-renames';
import {
  type OpFactoryCall,
  RenameCollectionCall,
  RenameFieldCall,
  UnsetFieldCall,
} from './op-factory-call';

type Document = Record<string, unknown>;

/** Why the plan does not rewrite the fields of the model at `coordinate`: its documents are embedded in another model's, if they are. */
export function embeddedModelReason(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): string | undefined {
  const owner = embeddingModelOf(contract.domain, coordinate);
  return owner === undefined
    ? undefined
    : `model "${modelDisplayName(coordinate)}" is embedded in the documents of model "${owner}"`;
}

/** Why a statement on `model` cannot be planned when no collection holds its documents. */
export function noCollectionReason(model: ModelCoordinate): string {
  return `model "${modelDisplayName(model)}" names no collection, and neither does a base or an owner`;
}

export function modelAt(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): ContractModel<MongoModelStorage> | undefined {
  const models = mongoModelsOf(contract.domain, coordinate.namespaceId);
  return Object.hasOwn(models, coordinate.model) ? models[coordinate.model] : undefined;
}

/** The stored name of `field` of the model at `coordinate`, or undefined when the model does not declare it. */
function storedFieldNameAt(
  contract: ContractWithDomain,
  coordinate: FieldCoordinate,
): string | undefined {
  const model = modelAt(contract, coordinate);
  return model === undefined || !Object.hasOwn(model.fields, coordinate.field)
    ? undefined
    : ownStoredNameOf(model, coordinate.field);
}

/** The stored name of a field the statement's resolution found on the model at `coordinate`. */
function resolvedStoredNameAt(contract: ContractWithDomain, coordinate: FieldCoordinate): string {
  const storedName = storedFieldNameAt(contract, coordinate);
  if (storedName === undefined) {
    throw new InternalError(
      `Field "${coordinate.model}.${coordinate.field}" a statement names has no stored name`,
    );
  }
  return storedName;
}

/** Why MongoDB would refuse a collection name, if it would. */
function invalidCollectionNameReason(name: string): string | undefined {
  if (name === '') return 'it is empty';
  if (name.includes('$')) return 'it contains "$"';
  if (name.includes('\0')) return 'it contains a null character';
  if (name.startsWith('system.')) return 'it starts with "system.", which MongoDB reserves';
  return undefined;
}

function isEmbedRelation(relation: ContractRelation): boolean {
  return !('on' in relation) && !('through' in relation);
}

type StoredField =
  | { readonly kind: 'field' }
  | { readonly kind: 'reference' }
  | { readonly kind: 'embed' }
  | { readonly kind: 'absent' };

function storedField(
  model: ContractModel<MongoModelStorage> | undefined,
  field: string,
): StoredField {
  if (model === undefined) return { kind: 'absent' };
  if (Object.hasOwn(model.fields, field)) return { kind: 'field' };
  const relation = Object.hasOwn(model.relations, field) ? model.relations[field] : undefined;
  if (relation === undefined) return { kind: 'absent' };
  return isEmbedRelation(relation) ? { kind: 'embed' } : { kind: 'reference' };
}

/**
 * The calls statements and removed fields add to a plan, with the schema the diff starts from:
 * the origin with each renamed collection under its new name, so the diff does not drop and
 * create it again.
 */
export interface StatementCalls {
  readonly schema: MongoSchemaIR;
  /** Run first. */
  readonly collectionRenames: readonly RenameCollectionCall[];
  /** Run after index drops and before index creates. */
  readonly rewrites: readonly RewriteCall[];
}

/** A field rename call, with the discriminator values its filter selects documents by. */
export interface FieldRenameCall {
  readonly call: RenameFieldCall;
  readonly discriminatorFilter: DiscriminatorFilter | undefined;
}

export interface StatementPlan {
  /** The origin schema with each renamed collection under its new name, for the diff to compare. */
  readonly schema: MongoSchemaIR;
  readonly collectionRenames: readonly RenameCollectionCall[];
  /** The calls of the statements' field renames, in statement order, then of the field renames no statement asks for. */
  readonly fieldRenameCalls: readonly FieldRenameCall[];
  /** Every field rename statement, and every field rename no statement asks for that the plan makes. */
  readonly fieldRenames: readonly FieldRename[];
  /** For each statement, in order, the call that carries it out, or `undefined` when storage does not change. */
  readonly callOfStatement: readonly (OpFactoryCall | undefined)[];
  /** The model renames of the plan: its model statements, and the models both contracts name alike. */
  readonly models: readonly ModelRename[];
  /** The collections the model renames move. */
  readonly collections: CollectionRenames;
  /** The collection each origin collection is in once the plan's renames are made, including those the database already has. */
  readonly renamedCollections: ReadonlyMap<string, string>;
}

const LEAVE_OUT = 'Leave out this statement.';

interface PlanningInput {
  readonly statements: readonly ResolvedRenameStatement[];
  /** The origin contract; the destination stands in for it when the plan has none. */
  readonly fromContract: ContractWithDomain;
  readonly contract: MongoContract;
}

/**
 * Plans the renames of a plan against the schema it starts from: those its statements ask for,
 * and, with an origin contract, those of the collections and fields whose models and fields both
 * contracts name alike. In order: the collection renames no statement asks for, the statements in
 * the order given, and the field renames no statement asks for. A collection rename renames the
 * collection in the schema the diff then starts from, and a field rename renames the field in the
 * documents that hold it. A collection is renamed only when every model stored in it moves to the
 * new collection and no other model joins it there.
 */
export function planStatements(input: {
  readonly statements: readonly ResolvedRenameStatement[];
  readonly fromContract: ContractWithDomain | null;
  readonly contract: MongoContract;
  readonly schema: MongoSchemaIR;
}): Result<StatementPlan, readonly MigrationPlannerConflict[]> {
  const planning: PlanningInput = {
    statements: input.statements,
    fromContract: input.fromContract ?? input.contract,
    contract: input.contract,
  };
  const models = modelRenamesOf(input.statements, input.fromContract, input.contract);
  const collections = new CollectionRenames(models, planning.fromContract, input.contract);
  let schema = input.schema;
  const collectionRenames: RenameCollectionCall[] = [];
  const fieldRenameCalls: FieldRenameCall[] = [];
  const fieldRenames: FieldRename[] = input.statements.flatMap((statement) =>
    statement.entity === 'field' ? [{ from: statement.from, to: statement.to, statement }] : [],
  );
  const callOfStatement: (OpFactoryCall | undefined)[] = [];
  const fieldChanges: FieldChange[] = [];
  const conflicts: MigrationPlannerConflict[] = [];
  const renamedCollections = new Map<string, string>();
  const renameCollection = (call: RenameCollectionCall) => {
    schema = renameInSchema(schema, call.from, call.to);
    renamedCollections.set(call.from, call.to);
    collectionRenames.push(call);
  };
  const addFieldRename = (rename: FieldRenameCall): RenameFieldCall => {
    const same = fieldRenameCalls.find(({ call }) => sameFieldRename(call, rename.call));
    if (same !== undefined) return same.call;
    fieldRenameCalls.push(rename);
    return rename.call;
  };

  const pairing: ModelMatchInput = {
    statements: input.statements,
    models,
    fieldRenames: [],
    fromContract: planning.fromContract,
    contract: input.contract,
    collectionAfterRenames: (name) => renamedCollections.get(name) ?? name,
  };
  const sharesCollection = (model: ModelCoordinate, collection: string) =>
    sharesCollectionInDestination(model, collection, pairing);
  const stated = (change: CollectionChange) =>
    change.renames.some((rename) => rename.statement !== undefined);
  const plannedChanges = plannedCollectionChanges(
    collections.changes.filter(
      (change) =>
        !stated(change) &&
        collections.managedOnBothSides(change) &&
        collections.sharedCollection(change) === undefined,
    ),
    collections.changes.filter(stated),
    input.schema,
    planning,
  );
  if (plannedChanges.kind === 'refused') return notOk([plannedChanges.conflict]);
  for (const change of plannedChanges.found) renamedCollections.set(change.from, change.to);
  for (const change of plannedChanges.changes) {
    const outcome = planCollectionChange(change, schema);
    if (outcome.kind === 'refused') conflicts.push(outcome.conflict);
    if (outcome.kind === 'renameCollection') renameCollection(outcome.call);
  }

  for (const statement of input.statements) {
    const label = `Cannot ${describeMigrationStatement(statement, planning.fromContract, input.contract)}`;
    const outcome: StatementOutcome =
      statement.entity === 'namespace'
        ? {
            kind: 'refused',
            conflict: renameRefused(
              statement,
              `${label}: MongoDB does not rename namespaces in this release`,
              LEAVE_OUT,
            ),
          }
        : statement.entity === 'enumValue' || statement.entity === 'valueObjectField'
          ? { kind: 'unchanged' }
          : statement.entity === 'model'
            ? planModelStatement(
                statement,
                label,
                renamedCollections,
                schema,
                collections,
                models,
                planning,
              )
            : planFieldRename(
                { from: statement.from, to: statement.to, statement },
                label,
                renamedCollections,
                schema,
                fieldRenames,
                planning,
                sharesCollection,
              );
    if (outcome.kind === 'refused') {
      conflicts.push(outcome.conflict);
      callOfStatement.push(undefined);
      continue;
    }
    if (outcome.kind === 'renameCollection') renameCollection(outcome.call);
    if (outcome.kind === 'renameField' && statement.entity === 'field') {
      fieldChanges.push(
        fieldChangeOf({ from: statement.from, to: statement.to, statement }, outcome.rename),
      );
    }
    callOfStatement.push(
      outcome.kind === 'unchanged'
        ? undefined
        : outcome.kind === 'renameField'
          ? addFieldRename(outcome.rename)
          : outcome.call,
    );
  }

  if (input.fromContract !== null) {
    conflicts.push(...embedRelationRefusals(pairing));
    const unstated = unstatedFieldRenamesOf(pairing);
    for (const rename of unstated) {
      const outcome = planFieldRename(
        rename,
        undefined,
        renamedCollections,
        schema,
        [...fieldRenames, ...unstated],
        planning,
        sharesCollection,
      );
      if (outcome.kind === 'refused') conflicts.push(outcome.conflict);
      if (outcome.kind === 'renameField') {
        addFieldRename(outcome.rename);
        fieldRenames.push(rename);
        fieldChanges.push(fieldChangeOf(rename, outcome.rename));
      }
    }
  }
  const fieldConflict =
    conflicts.length > 0
      ? undefined
      : fieldRenamesConflict(
          fieldChanges,
          planning,
          (root) => !destinationKeepsModel(root, pairing),
        );
  if (fieldConflict !== undefined) return notOk([fieldConflict]);

  return conflicts.length > 0
    ? notOk(conflicts)
    : ok({
        schema,
        collectionRenames,
        fieldRenameCalls,
        fieldRenames,
        callOfStatement,
        models,
        collections,
        renamedCollections,
      });
}

function fieldChangeOf(rename: FieldRename, { call }: FieldRenameCall): FieldChange {
  return {
    rename,
    collection: call.collection,
    from: call.from,
    to: call.to,
    nameKind: { kind: 'document' },
  };
}

/**
 * The refusal of each embed relation whose stored name changes while its name and its model's pair
 * stay, in a collection managed in both contracts: renaming an embedded relation is not planned, as
 * a statement on one is refused.
 */
function embedRelationRefusals(match: ModelMatchInput): readonly MigrationPlannerConflict[] {
  return modelCoordinates(match.fromContract).flatMap((origin) => {
    const destination = destinationModelOf(origin, match);
    const originModel = modelAt(match.fromContract, origin);
    const destinationModel =
      destination === undefined ? undefined : modelAt(match.contract, destination);
    const originCollection = collectionOfModel(match.fromContract.domain, origin);
    if (
      destination === undefined ||
      originModel === undefined ||
      destinationModel === undefined ||
      originCollection === undefined ||
      embeddedModelReason(match.fromContract, origin) !== undefined ||
      embeddedModelReason(match.contract, destination) !== undefined
    ) {
      return [];
    }
    const collection = match.collectionAfterRenames(originCollection);
    if (
      !managedOnBothSides(match.fromContract, match.contract, {
        from: originCollection,
        to: collection,
      })
    ) {
      return [];
    }
    const after = ownEmbedStoredNamesOf(destinationModel);
    return Object.entries(ownEmbedStoredNamesOf(originModel)).flatMap(([relation, from]) => {
      const to = Object.hasOwn(after, relation) ? after[relation] : undefined;
      return to === undefined || to === from
        ? []
        : [
            renameRefused(
              undefined,
              `Cannot rename field "${from}" to "${to}" in collection "${collection}": the field is an embedded relation`,
              `The stored name of embedded relation "${modelDisplayName(origin)}.${relation}" changes from "${from}" to "${to}", and renaming an embedded relation is not supported in this release. Keep the stored name "${from}" in the contract, then run this command again.`,
            ),
          ];
    });
  });
}

/**
 * The field renames no statement asks for: each field of an origin model that the destination
 * model it is paired with has under its name, and that no field rename statement names. The pair is
 * a statement's, the same coordinate's, or, for a variant, the same storage's (ADR 324). A root model
 * paired only by storage gets none: its fields are planned as removals and additions, with their
 * questions, so no rename is made on that guess.
 */
function unstatedFieldRenamesOf(match: ModelMatchInput): readonly FieldRename[] {
  const named = (field: FieldCoordinate) =>
    match.statements.some(
      (statement) =>
        statement.entity === 'field' &&
        (sameField(statement.from, field) || sameField(statement.to, field)),
    );
  return modelCoordinates(match.fromContract).flatMap((origin) => {
    const pair = modelPairOf(origin, match);
    if (pair === undefined || !givesRenamesWithNoStatement(origin, pair, match.fromContract)) {
      return [];
    }
    const { destination } = pair;
    const originModel = modelAt(match.fromContract, origin);
    const destinationModel =
      destination === undefined ? undefined : modelAt(match.contract, destination);
    if (destination === undefined || originModel === undefined || destinationModel === undefined) {
      return [];
    }
    return Object.keys(originModel.fields).flatMap((field) => {
      const from = { ...origin, field };
      const to = { ...destination, field };
      return Object.hasOwn(destinationModel.fields, field) && !named(from) && !named(to)
        ? [{ from, to, statement: undefined }]
        : [];
    });
  });
}

/** Whether two field renames rewrite the same documents the same way, as when every root model of a shared collection renames a field together. */
function sameFieldRename(a: RenameFieldCall, b: RenameFieldCall): boolean {
  return (
    a.collection === b.collection &&
    a.from === b.from &&
    a.to === b.to &&
    JSON.stringify(a.filter) === JSON.stringify(b.filter)
  );
}

type StatementOutcome =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'renameCollection'; readonly call: RenameCollectionCall }
  | { readonly kind: 'renameField'; readonly rename: FieldRenameCall }
  | { readonly kind: 'refused'; readonly conflict: MigrationPlannerConflict };

const UNCHANGED: StatementOutcome = { kind: 'unchanged' };

function refusedOutcome(
  statement: ResolvedMigrationStatement | undefined,
  summary: string,
  why: string,
): StatementOutcome {
  return { kind: 'refused', conflict: renameRefused(statement, summary, why) };
}

function renameInSchema(schema: MongoSchemaIR, from: string, to: string): MongoSchemaIR {
  return new MongoSchemaIR(
    schema.collections.map((collection) =>
      collection.name === from
        ? new MongoSchemaCollection({
            name: to,
            indexes: collection.indexes,
            ...(collection.validator === undefined ? {} : { validator: collection.validator }),
            ...(collection.options === undefined ? {} : { options: collection.options }),
          })
        : collection,
    ),
    { fromDatabase: schema.fromDatabase },
  );
}

function controlPolicyRefusal(
  statement: ResolvedMigrationStatement,
  label: string,
  contract: MongoContract,
  collection: string,
): StatementOutcome | undefined {
  const policy = collectionControlPolicy(contract, collection);
  if (policy === 'managed') return undefined;
  return refusedOutcome(
    statement,
    `${label}: collection "${collection}" has control policy "${policy}"`,
    `Statements rename only collections, and fields of collections, whose control policy is "managed". Make the change in the database yourself and leave out this statement.`,
  );
}

/**
 * Why MongoDB cannot rename collection `change.from` to `change.to`: a time-series collection, or a
 * name it rejects. With no statement, the text names the contract change.
 */
function collectionRenameRefusal(
  statement: ResolvedModelRenameStatement | undefined,
  label: string,
  change: CollectionChange,
  schema: MongoSchemaIR,
): StatementOutcome | undefined {
  const { from, to } = change;
  const changed =
    statement === undefined ? `${capitalized(collectionChangeText(change))}, and ` : '';
  if (schema.collection(from)?.options?.timeseries !== undefined) {
    return refusedOutcome(
      statement,
      `${label}: collection "${from}" is a time-series collection`,
      statement === undefined
        ? `${changed}MongoDB cannot rename a time-series collection. Keep the collection's name: store the models in "${from}" (with @@map(${JSON.stringify(from)}) in PSL), then run this command again. To start the collection under its new name without its documents, remove the model in one change and add it back in a second.`
        : `MongoDB cannot rename a time-series collection. Leave out this statement. To keep the documents, first create collection "${to}" yourself with exactly the options the contract gives it, its validator included, and copy them into it; the plan then drops "${from}" once --delete names the model. A migration that migration plan writes creates collection "${to}" itself, and stops at that creation when the collection you made has other options.`,
    );
  }
  const invalid = invalidCollectionNameReason(to);
  if (invalid !== undefined) {
    return refusedOutcome(
      statement,
      `${label}: MongoDB does not accept the collection name "${to}": ${invalid}`,
      `${changed === '' ? '' : `${capitalized(collectionChangeText(change))}. `}Give the model a collection name MongoDB accepts with @@map, then run this command again.`,
    );
  }
  return undefined;
}

/** The rename of a collection no statement asks for, which every model stored in it moves: refused only when MongoDB cannot rename it. */
function planCollectionChange(change: CollectionChange, schema: MongoSchemaIR): StatementOutcome {
  return (
    collectionRenameRefusal(
      undefined,
      `Cannot rename collection "${change.from}" to "${change.to}"`,
      change,
      schema,
    ) ?? { kind: 'renameCollection', call: new RenameCollectionCall(change.from, change.to) }
  );
}

function leaveOutShared(moving: string): string {
  return `Leave out this statement to plan the change without moving them: the plan then asks about the data it drops. A question about ${moving} offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data.`;
}

/**
 * The route that keeps the documents of root models a leave-out plan leaves behind, for `migration
 * plan` only: add their move to the migration.ts that plan writes, as `documentMoveSteps` says.
 */
function moveInLeftOutPlan(move: DocumentMove): string {
  return `With migration plan, keep the documents by moving them in the migration that plan writes: plan the change without this statement, and ${documentMoveSteps(move)}`;
}

/** The leave-out route for root models whose documents no discriminator tells apart from those of the models that stay: without the statement they are removed, and nothing is asked. */
function leaveOutRemoved(
  moving: string,
  others: readonly ModelCoordinate[],
  renamedTo: string,
  readers: readonly ModelCoordinate[],
  from: string,
): string {
  const start =
    readers.length === 0
      ? `${renamedTo} starts with no documents`
      : `${renamedTo} reads the documents of ${modelsText(readers)} already stored in its collection, since no discriminator tells them apart`;
  return `Leave out this statement to plan the change without moving them: ${moving} is then removed and nothing is asked, since nothing is deleted: its documents stay in collection "${from}", where ${modelsText(others)} still read${others.length === 1 ? 's' : ''} them, and ${start}. If the new validator of collection "${from}" does not accept them, its change stops the apply in every database that holds them, until they are deleted or moved there.`;
}

/** The refusal of a model rename statement whose collection holds other models that do not move with it, or whose new collection holds models from elsewhere. */
function sharedCollectionRefusal(
  statement: ResolvedModelRenameStatement,
  label: string,
  collections: CollectionRenames,
  models: readonly ModelRename[],
  { fromContract, contract }: PlanningInput,
): StatementOutcome | undefined {
  const rename = models.find((model) => model.statement === statement);
  const change = rename === undefined ? undefined : collections.changeOf(rename);
  const shared = change === undefined ? undefined : collections.sharedCollection(change);
  if (change === undefined || shared === undefined) return undefined;
  const { from, to } = change;
  const moving = modelsText(change.renames.map((renamed) => renamed.from));
  const others = modelsText(shared.objects);
  const leavesBehind = change.renames.every((renamed) => isRootModel(fromContract, renamed.from));
  const readersIn = (collection: string) =>
    modelCoordinates(contract).filter(
      (model) =>
        documentCollectionOf(contract, model) === collection &&
        isRootModel(contract, model) &&
        !change.renames.some((renamed) => sameModel(renamed.to, model)),
    );
  const moveSteps = handWrittenRoute(`the documents of ${moving} into collection "${to}"`);
  switch (shared.kind) {
    case 'split':
      return refusedOutcome(
        statement,
        `${label}: collection "${from}" also stores ${others}`,
        `A collection rename moves every document of the collection, and the documents of ${others} do not move to collection "${to}". Moving the documents of one model out of a collection it shares with others is a data migration, which a plan does not write. ${leavesBehind ? `${leaveOutRemoved(moving, shared.objects, modelsText(change.renames.map((renamed) => renamed.to)), readersIn(to), from)} ${moveInLeftOutPlan({ moving, from, to, created: planCreatesCollection(fromContract, contract, to) })}` : `${leaveOutShared(moving)} ${moveSteps}`}`,
      );
    case 'merged':
      return refusedOutcome(
        statement,
        `${label}: collection "${to}" also stores ${others}, whose documents are not in collection "${from}"`,
        `A collection rename moves the documents of one collection, and collection "${to}" would also store the documents of ${others}. Moving the documents of two collections into one is a data migration, which a plan does not write. ${leaveOutShared(moving)} ${handWrittenRoute(`the documents of ${moving}, and those of ${others} that collection "${to}" does not already hold, into collection "${to}"`)}`,
      );
  }
}

function planModelStatement(
  statement: ResolvedModelRenameStatement,
  label: string,
  renamedCollections: ReadonlyMap<string, string>,
  schema: MongoSchemaIR,
  collections: CollectionRenames,
  models: readonly ModelRename[],
  input: PlanningInput,
): StatementOutcome {
  const refuse = (reason: string, why: string) =>
    refusedOutcome(statement, `${label}: ${reason}`, why);
  const embedded =
    embeddedModelReason(input.fromContract, statement.from) ??
    embeddedModelReason(input.contract, statement.to);
  if (embedded !== undefined) {
    return refuse(embedded, `Embedded models are not renamed in this release. ${LEAVE_OUT}`);
  }
  const from = collectionOfModel(input.fromContract.domain, statement.from);
  const to = collectionOfModel(input.contract.domain, statement.to);
  if (from === undefined || to === undefined) {
    return refuse(
      noCollectionReason(from === undefined ? statement.from : statement.to),
      `A statement renames the documents of a model in its collection. Give the model a collection, then run this command again, or ${LEAVE_OUT.toLowerCase()}`,
    );
  }
  if (from === to) return UNCHANGED;
  const shared = sharedCollectionRefusal(statement, label, collections, models, input);
  if (shared !== undefined) return shared;
  if (renamedCollections.get(from) === to) return UNCHANGED;
  const policyRefusal = controlPolicyRefusal(statement, label, input.contract, to);
  if (policyRefusal !== undefined) return policyRefusal;
  if (schema.collection(from) === undefined) {
    return refuse(
      `the schema being planned from has no collection "${from}"`,
      `The database has no collection "${from}", or "${from}" is a view, which MongoDB cannot rename. Inspect it with prisma db schema, or ${LEAVE_OUT.toLowerCase()}`,
    );
  }
  const change = { from, to, renames: [{ from: statement.from, to: statement.to, statement }] };
  const refusal = collectionRenameRefusal(statement, label, change, schema);
  if (refusal !== undefined) return refusal;
  const reused = freedNameReusedConflict(
    change,
    statement,
    label,
    capitalized(collectionChangeText(change)),
    input.contract,
  );
  if (reused !== undefined) return { kind: 'refused', conflict: reused };
  if (schema.collection(to) !== undefined) {
    return refuse(
      `the schema being planned from already has a collection "${to}"`,
      `A rename cannot replace a collection that already exists. Rename or drop collection "${to}" first, or ${LEAVE_OUT.toLowerCase()}`,
    );
  }
  return { kind: 'renameCollection', call: new RenameCollectionCall(from, to) };
}

/** Why a field rename statement cannot be planned before its stored names are compared, if it cannot; `unchanged` when it renames nothing stored. */
function fieldStatementRefusal(
  statement: ResolvedFieldRenameStatement,
  label: string,
  input: PlanningInput,
): StatementOutcome | undefined {
  const refuse = (reason: string, why: string) =>
    refusedOutcome(statement, `${label}: ${reason}`, why);
  const embeddedFrom = embeddedModelReason(input.fromContract, statement.from);
  const embeddedTo = embeddedModelReason(input.contract, statement.to);
  if (embeddedFrom !== undefined && embeddedTo !== undefined) return UNCHANGED;
  const embedded = embeddedFrom ?? embeddedTo;
  if (embedded !== undefined) {
    return refuse(
      embedded,
      `A statement renames a field of an embedded model only while the model stays embedded. ${LEAVE_OUT}`,
    );
  }
  const fromField = storedField(modelAt(input.fromContract, statement.from), statement.from.field);
  const toField = storedField(modelAt(input.contract, statement.to), statement.to.field);
  if (fromField.kind === 'embed' || toField.kind === 'embed') {
    return refuse(
      'the field is an embedded relation',
      `Renaming an embedded relation is not supported in this release. ${LEAVE_OUT}`,
    );
  }
  if (fromField.kind !== 'field' && toField.kind !== 'field') return UNCHANGED;
  if (fromField.kind !== 'field' || toField.kind !== 'field') {
    return refuse(
      'the field is stored in documents on one side of the statement only',
      `A relation is not stored in documents, so a statement cannot rename a field to or from one. ${LEAVE_OUT}`,
    );
  }
  const originCollection = collectionOfModel(input.fromContract.domain, statement.from);
  const destinationCollection = collectionOfModel(input.contract.domain, statement.to);
  if (originCollection === undefined || destinationCollection === undefined) {
    return refuse(
      noCollectionReason(originCollection === undefined ? statement.from : statement.to),
      `A statement renames a field in the documents of its model's collection. ${LEAVE_OUT}`,
    );
  }
  return undefined;
}

/** Why the plan does not rename a collection a field rename statement's model moves between. */
function unrenamedCollectionWhy(statement: ResolvedFieldRenameStatement): string {
  if (!sameModel(statement.from, statement.to)) {
    return `Add --rename ${modelDisplayName(statement.from)}:${modelDisplayName(statement.to)} before this statement, so the collection is renamed with its documents.`;
  }
  return `The plan renames a collection only when every model stored in it moves to the same new collection, its control policy is "managed" in both contracts, and the schema being planned from has the old collection and not the new one, so the field would be renamed in a collection the destination does not store the model in. ${LEAVE_OUT}`;
}

/**
 * Plans a field rename, of a statement or of a field both contracts name alike, in the documents
 * of its model's collection once the collection renames are made. A rename no statement asks for
 * renames nothing in a collection the plan does not rename to the model's new collection, does not
 * keep, or does not manage in both contracts; the plan then is what it is without the rename.
 */
function planFieldRename(
  rename: FieldRename,
  statementLabel: string | undefined,
  renamedCollections: ReadonlyMap<string, string>,
  schema: MongoSchemaIR,
  renames: readonly FieldRename[],
  input: PlanningInput,
  sharesCollection: (model: ModelCoordinate, collection: string) => boolean,
): StatementOutcome {
  const { statement } = rename;
  if (statement !== undefined && statementLabel !== undefined) {
    const refusal = fieldStatementRefusal(statement, statementLabel, input);
    if (refusal !== undefined) return refusal;
  } else if (
    embeddedModelReason(input.fromContract, rename.from) !== undefined ||
    embeddedModelReason(input.contract, rename.to) !== undefined
  ) {
    return UNCHANGED;
  }
  const fromStored = resolvedStoredNameAt(input.fromContract, rename.from);
  const toStored = resolvedStoredNameAt(input.contract, rename.to);
  const originCollection = collectionOfModel(input.fromContract.domain, rename.from);
  const destinationCollection = collectionOfModel(input.contract.domain, rename.to);
  if (originCollection === undefined || destinationCollection === undefined) return UNCHANGED;
  const collection = renamedCollections.get(originCollection) ?? originCollection;
  if (
    fromStored === toStored &&
    (statement === undefined || collection === destinationCollection)
  ) {
    return UNCHANGED;
  }
  if (
    statement === undefined &&
    (collection !== destinationCollection ||
      schema.collection(collection) === undefined ||
      !managedOnBothSides(input.fromContract, input.contract, {
        from: originCollection,
        to: destinationCollection,
      }))
  ) {
    return UNCHANGED;
  }
  const label =
    statementLabel ??
    `Cannot rename field "${fromStored}" to "${toStored}" in collection "${collection}"`;
  const changed =
    statement === undefined
      ? capitalized(
          fieldChangeText({
            rename,
            collection,
            nameKind: { kind: 'document' },
            from: fromStored,
            to: toStored,
          }),
        )
      : undefined;
  const refuse = (reason: string, why: string) =>
    refusedOutcome(statement, `${label}: ${reason}`, why);
  if (fromStored === '_id' || toStored === '_id') {
    return refuse(
      'it renames _id',
      changed === undefined
        ? `MongoDB does not let a document change its _id. ${LEAVE_OUT}`
        : `${changed}, and MongoDB does not let a document change its _id. Keep the stored name ${JSON.stringify(fromStored)} (with @map(${JSON.stringify(fromStored)}) in PSL), then run this command again.`,
    );
  }
  const unsafeFrom = unrewritableFieldNameReason(fromStored);
  if (unsafeFrom !== undefined) {
    return refuse(
      `the stored name "${fromStored}" cannot be rewritten`,
      changed === undefined
        ? `${unsafeFrom}, so a statement cannot move its values. Rename it in the database yourself, or ${LEAVE_OUT.toLowerCase()}`
        : `${changed}. ${unsafeFrom}, so the plan cannot move its values. Keep the stored name ${JSON.stringify(fromStored)} (with @map(${JSON.stringify(fromStored)}) in PSL), then run this command again.`,
    );
  }
  const unsafeTo = unrewritableFieldNameReason(toStored);
  if (unsafeTo !== undefined) {
    return refuse(
      `the stored name "${toStored}" cannot be written`,
      changed === undefined
        ? `${unsafeTo}. Give the field a stored name without "." that does not start with "$" (with @map), or ${LEAVE_OUT.toLowerCase()}`
        : `${changed}. ${unsafeTo}. Give the field a stored name without "." that does not start with "$" (with @map), then run this command again.`,
    );
  }
  if (statement !== undefined && collection !== destinationCollection) {
    return refuse(
      `the model's collection changes from "${originCollection}" to "${destinationCollection}", and the plan does not rename it`,
      unrenamedCollectionWhy(statement),
    );
  }
  if (schema.collection(collection)?.options?.timeseries !== undefined) {
    return refuse(
      `collection "${collection}" is a time-series collection`,
      changed === undefined
        ? `${TIME_SERIES_UPDATES}, so a statement cannot move the values of a field in them. Keep the stored name: store the field as ${JSON.stringify(fromStored)} (with @map(${JSON.stringify(fromStored)}) in PSL), then run this command again without this statement.`
        : `${changed}, and ${TIME_SERIES_UPDATES}, so the plan cannot move the values of a field in them. Keep the stored name: store the field as ${JSON.stringify(fromStored)} (with @map(${JSON.stringify(fromStored)}) in PSL), then run this command again.`,
    );
  }
  if (statement !== undefined && statementLabel !== undefined) {
    const policyRefusal = controlPolicyRefusal(
      statement,
      statementLabel,
      input.contract,
      collection,
    );
    if (policyRefusal !== undefined) return policyRefusal;
  }
  const variant = selectedVariantOf(input.fromContract.domain, rename.from);
  const renamedTogether = new Set(
    renames.flatMap((other) =>
      other.from.namespaceId === rename.from.namespaceId &&
      storedFieldNameAt(input.fromContract, other.from) === fromStored &&
      storedFieldNameAt(input.contract, other.to) === toStored
        ? [other.from.model]
        : [],
    ),
  );
  const others = otherModelsReached(
    input.fromContract.domain,
    rename.from,
    originCollection,
    variant,
    fromStored,
  ).filter(
    (name) =>
      !renamedTogether.has(name) &&
      sharesCollection(
        { namespaceId: rename.from.namespaceId, model: name },
        destinationCollection,
      ),
  );
  if (others.length > 0) {
    const sharedWhy = `${sharedCollectionWhy(collection, others, 'renaming the field would rename it in the documents')} To change it, ${changed === undefined ? SEPARATE_THE_MODELS : `move the models to separate collections, or keep the stored name ${JSON.stringify(fromStored)} in the contract`}.`;
    return refuse(
      `${modelNamesText(others)} ${others.length === 1 ? 'stores' : 'store'} field ${JSON.stringify(fromStored)} in the same collection, ${JSON.stringify(collection)}`,
      changed === undefined ? sharedWhy : `${changed}. ${sharedWhy}`,
    );
  }
  const selected =
    variant === undefined
      ? rootDocumentsLosing(input.contract, rename.to, fromStored)
      : {
          filter: variantFilter(variant),
          discriminatorFilter: variantDiscriminatorFilter(variant),
        };
  return {
    kind: 'renameField',
    rename: {
      call: new RenameFieldCall(collection, fromStored, toStored, selected?.filter),
      discriminatorFilter: selected?.discriminatorFilter,
    },
  };
}

function renameCollectionByHandSteps(model: ModelCoordinate, from: string, to: string): string {
  return `With db update, rename the collection in the database yourself, for example db.getCollection(${JSON.stringify(from)}).renameCollection(${JSON.stringify(to)}) in mongosh, then run db update. With migration plan, plan it, passing --delete ${modelDisplayName(model)} to answer its question; in its migration.ts make renameCollection(${JSON.stringify(from)}, ${JSON.stringify(to)}) the first operation, imported with the other operations, delete the drop of "${from}", and delete the create of "${to}" if there is one; run node on that migration.ts so it writes ops.json again; then apply it with prisma db migrate.`;
}

/**
 * How to keep the documents of a model that keeps its name while its collection changes from
 * `from` to `to` and the plan does not rename the collection: the user renames it by hand.
 */
export function keepCollectionByHandAdvice(
  model: ModelCoordinate,
  from: string,
  to: string,
): string {
  return `To keep its documents, rename collection "${from}" to "${to}" instead. The plan does not rename it: a plan renames the collection of a model that keeps its name only when the control policy of the collection is "managed" in both contracts. ${renameCollectionByHandSteps(model, from, to)}`;
}

export interface FieldRemoval {
  readonly call: UnsetFieldCall;
  readonly subject: MigrationSubject;
  /** The destination model whose documents lose the field; `undefined` without an origin contract. */
  readonly destination: ModelCoordinate | undefined;
  /** The variant whose documents lose the field; `undefined` for a root model's documents. */
  readonly variant: SelectedVariant | undefined;
  readonly discriminatorFilter: DiscriminatorFilter | undefined;
}

/**
 * The destination model an origin model became: its pair in the plan's model renames (a statement,
 * else the same name, as the collection renames pair them), else the only new model stored the
 * same way (same collection, same variant value) that no rename pairs and that no other unpaired
 * origin model is stored like, so no two origin models become one.
 */
export function destinationModelOf(
  origin: ModelCoordinate,
  input: ModelMatchInput,
): ModelCoordinate | undefined {
  return modelPairOf(origin, input)?.destination;
}

/**
 * Whether the destination keeps origin model `model`, wherever it stores it. A variant delete or a
 * discriminator replacement counts every model the destination keeps as sharing the collection's
 * documents: they select documents by a discriminator value, a model that moves out leaves its
 * documents behind where they can match it, and this is the check these operations had before,
 * narrowed only by the models the destination removes. A takeover asks it of a holder's root model.
 */
export function destinationKeepsModel(model: ModelCoordinate, match: ModelMatchInput): boolean {
  return destinationModelOf(model, match) !== undefined;
}

/**
 * Whether the destination stores origin model `model`'s pair in `collection`, the collection the
 * origin stores it in after the plan's renames: the test of which other models share a collection's
 * documents for a field rename. Every rewrite `rewriteRefusals` checks (key renames, value
 * replacements, removals, casts, fills) counts the same models, the destination's in that
 * collection, as it always has. A model the destination removes, or stores elsewhere,
 * does not share them, since the models that remain read the documents they read before.
 * `rewriteRefusals` asks the same question of the destination contract directly.
 */
export function sharesCollectionInDestination(
  model: ModelCoordinate,
  collection: string,
  match: ModelMatchInput,
): boolean {
  const destination = destinationModelOf(model, match);
  return (
    destination !== undefined && documentCollectionOf(match.contract, destination) === collection
  );
}

/** The destination model an origin model became, and the rule that paired them. */
export interface ModelPair {
  readonly destination: ModelCoordinate;
  readonly by: 'statement' | 'coordinate' | 'storage';
}

/** How an origin model is paired, by the rules of `destinationModelOf`; `undefined` when it is not. */
export function modelPairOf(
  origin: ModelCoordinate,
  input: ModelMatchInput,
): ModelPair | undefined {
  const paired = input.models.find((rename) => sameModel(rename.from, origin));
  if (paired !== undefined) {
    return {
      destination: paired.to,
      by: paired.statement === undefined ? 'coordinate' : 'statement',
    };
  }
  const unpaired = modelCoordinates(input.fromContract).filter(
    (other) => !input.models.some((rename) => sameModel(rename.from, other)),
  );
  const stored = modelCoordinates(input.contract).filter(
    (candidate) =>
      modelAt(input.fromContract, candidate) === undefined &&
      !input.models.some((rename) => sameModel(rename.to, candidate)) &&
      storedAlike(origin, candidate, input) &&
      unpaired.filter((other) => storedAlike(other, candidate, input)).length === 1,
  );
  const [only] = stored;
  return stored.length === 1 && only !== undefined
    ? { destination: only, by: 'storage' }
    : undefined;
}

/**
 * Whether renames no statement asks for may come from the pair of `origin`: a pair by statement or
 * by the same coordinate, or a variant paired by storage, whose documents carry its discriminator
 * value. A root model paired only by storage gets none (ADR 324).
 */
export function givesRenamesWithNoStatement(
  origin: ModelCoordinate,
  pair: ModelPair,
  fromContract: ContractWithDomain,
): boolean {
  return pair.by !== 'storage' || !isRootModel(fromContract, origin);
}

/** Whether an origin model and a destination model are stored the same way: neither embedded, the same collection after renames, the same variant value. */
function storedAlike(
  origin: ModelCoordinate,
  candidate: ModelCoordinate,
  input: ModelMatchInput,
): boolean {
  if (embeddingModelOf(input.fromContract.domain, origin) !== undefined) return false;
  if (embeddingModelOf(input.contract.domain, candidate) !== undefined) return false;
  const originCollection = collectionOfModel(input.fromContract.domain, origin);
  return (
    originCollection !== undefined &&
    collectionOfModel(input.contract.domain, candidate) ===
      input.collectionAfterRenames(originCollection) &&
    sameVariant(
      selectedVariantOf(input.contract.domain, candidate),
      selectedVariantOf(input.fromContract.domain, origin),
    )
  );
}

function sameVariant(a: SelectedVariant | undefined, b: SelectedVariant | undefined): boolean {
  return a === undefined || b === undefined ? a === b : a.field === b.field && a.value === b.value;
}

/** What finding a model or field of one contract in the other reads: the renames, both contracts, and the collection each origin collection becomes. */
export interface ModelMatchInput {
  readonly statements: readonly ResolvedRenameStatement[];
  /** The model renames of the plan, which pair origin models with destination models before pairing by storage. */
  readonly models: readonly ModelRename[];
  /** The field renames the plan makes, those of its statements and those no statement asks for. */
  readonly fieldRenames: readonly FieldRename[];
  readonly fromContract: ContractWithDomain;
  readonly contract: MongoContract;
  readonly collectionAfterRenames: (collection: string) => string;
}

/** The origin model a destination model was, by the rules of `destinationModelOf`, read the other way. */
export function originModelOf(
  destination: ModelCoordinate,
  input: ModelMatchInput,
): ModelCoordinate | undefined {
  return modelCoordinates(input.fromContract).find((origin) => {
    const matched = destinationModelOf(origin, input);
    return matched !== undefined && sameModel(matched, destination);
  });
}

function sameField(a: FieldCoordinate, b: FieldCoordinate): boolean {
  return sameModel(a, b) && a.field === b.field;
}

/** The name a field of the origin has in the destination: its rename's new name, else its own. */
export function destinationFieldOf(
  origin: FieldCoordinate,
  fieldRenames: readonly FieldRename[],
): string {
  return fieldRenames.find((rename) => sameField(rename.from, origin))?.to.field ?? origin.field;
}

/** The name a field of the destination had in the origin: its rename's old name, else its own. */
export function originFieldOf(
  destination: FieldCoordinate,
  fieldRenames: readonly FieldRename[],
): string {
  return (
    fieldRenames.find((rename) => sameField(rename.to, destination))?.from.field ??
    destination.field
  );
}

export interface FieldRemovalInput extends ModelMatchInput {
  readonly keptCollections: ReadonlySet<string>;
}

function renamed(input: FieldRemovalInput, field: FieldCoordinate): boolean {
  return input.fieldRenames.some((rename) => sameField(rename.from, field));
}

/** Whether one of `model`'s own fields or embed relations is stored under `storedName`. */
function ownStores(model: ContractModel<MongoModelStorage>, storedName: string): boolean {
  return (
    hasOwnFieldStoredAs(model, storedName) ||
    Object.values(ownEmbedStoredNamesOf(model)).includes(storedName)
  );
}

/** The stored names of the documents of the model at `coordinate`: its fields and embed relations, its own and those it inherits. */
export function storedFieldsOf(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): Set<string> {
  const models = mongoModelsOf(contract.domain, coordinate.namespaceId);
  return new Set(
    modelAndBasesOf(models, coordinate.model).flatMap((model) => [
      ...Object.values(ownStoredNamesOf(model)),
      ...Object.values(ownEmbedStoredNamesOf(model)),
    ]),
  );
}

/** The filter that selects the documents an operation rewrites, and the discriminator values it reads. */
interface DocumentsSelected {
  readonly filter: Document | undefined;
  readonly discriminatorFilter: DiscriminatorFilter | undefined;
}

/**
 * The documents of a root model that lose `field`: all of them, or, when some of its destination
 * variants now store the field themselves, those whose discriminator value is none of theirs.
 * `undefined` when the root model itself still stores it.
 */
function rootDocumentsLosing(
  contract: ContractWithDomain,
  root: ModelCoordinate,
  storedName: string,
): DocumentsSelected | undefined {
  const model = modelAt(contract, root);
  if (model === undefined || ownStores(model, storedName)) return undefined;
  const discriminator = model.discriminator?.field;
  const keeping = Object.entries(model.variants ?? {})
    .filter(([, variant]) => {
      const variantModel = modelAt(contract, {
        namespaceId: variant.namespace,
        model: variant.model,
      });
      return variantModel !== undefined && ownStores(variantModel, storedName);
    })
    .map(([value]) => value)
    .sort();
  if (discriminator === undefined || keeping.length === 0) {
    return { filter: undefined, discriminatorFilter: undefined };
  }
  const field = ownStoredNameOf(model, discriminator);
  return {
    filter: { [field]: { $nin: keeping } },
    discriminatorFilter: { kind: 'noneOf', field, values: keeping },
  };
}

/**
 * The renames that move a field the documents of the origin model at `origin` store, from the
 * origin's stored name to the destination's: of its own fields, and of its bases' fields unless its
 * destination model stores the field itself, so the rename leaves its documents alone.
 */
function storedNameMoves(
  input: ModelMatchInput,
  origin: ModelCoordinate,
): readonly { readonly from: string; readonly to: string }[] {
  const bases = modelAndBasesOf(
    mongoModelsOf(input.fromContract.domain, origin.namespaceId),
    origin.model,
  ).slice(1);
  const destination = destinationModelOf(origin, input);
  const destinationModel =
    destination === undefined ? undefined : modelAt(input.contract, destination);
  return input.fieldRenames.flatMap((rename) => {
    const from = storedFieldNameAt(input.fromContract, rename.from);
    const to = storedFieldNameAt(input.contract, rename.to);
    if (from === undefined || to === undefined || from === to) return [];
    if (sameModel(rename.from, origin)) return [{ from, to }];
    const fromModel = modelAt(input.fromContract, rename.from);
    const ofABase = fromModel !== undefined && bases.includes(fromModel);
    const keptByDestination = destinationModel !== undefined && ownStores(destinationModel, from);
    return ofABase && !keptByDestination ? [{ from, to }] : [];
  });
}

/** The stored names of the documents of the origin model at `origin`, without those a rename of one of its own fields moves to another stored name. */
export function storedFieldsKeptOf(input: ModelMatchInput, origin: ModelCoordinate): Set<string> {
  const movedAway = new Set(storedNameMoves(input, origin).map(({ from }) => from));
  return new Set(
    [...storedFieldsOf(input.fromContract, origin)].filter((name) => !movedAway.has(name)),
  );
}

/**
 * The stored names that field renames move a field of `origin`'s documents into from
 * another stored name. The origin's own field under such a name no longer has a place in the
 * destination's documents, so it is removed.
 */
function storedNamesRenamedInto(
  input: ModelMatchInput,
  origin: ModelCoordinate,
): ReadonlySet<string> {
  return new Set(storedNameMoves(input, origin).map(({ to }) => to));
}

/**
 * Each field an origin model stores that its destination model no longer stores, or whose stored
 * name a rename gives to another of its fields, in a collection
 * the plan keeps: removing it is data loss, carried out by unsetting it from the documents that
 * hold it, in a collection whose control policy is `managed`. A variant's field is unset only from that variant's documents, by the discriminator value they hold once the plan's replacements ran, unless its destination
 * base now stores it. A base field is unset from the documents of every variant that does not now
 * store it itself.
 */
export function planFieldRemovals(input: FieldRemovalInput): readonly FieldRemoval[] {
  return modelCoordinates(input.fromContract).flatMap((origin) => {
    if (embeddingModelOf(input.fromContract.domain, origin) !== undefined) return [];
    const originCollection = collectionOfModel(input.fromContract.domain, origin);
    if (originCollection === undefined) return [];
    const collection = input.collectionAfterRenames(originCollection);
    if (!input.keptCollections.has(collection)) return [];
    if (collectionControlPolicy(input.contract, collection) !== 'managed') return [];
    const destination = destinationModelOf(origin, input);
    if (destination === undefined) return [];
    const model = modelAt(input.fromContract, origin);
    if (model === undefined) return [];
    const variant =
      selectedVariantOf(input.contract.domain, destination) ??
      selectedVariantOf(input.fromContract.domain, origin);
    const ofVariant: DocumentsSelected | undefined =
      variant === undefined
        ? undefined
        : {
            filter: variantFilter(variant),
            discriminatorFilter: variantDiscriminatorFilter(variant),
          };
    const takenByRename = storedNamesRenamedInto(input, origin);
    const losing = (storedName: string): DocumentsSelected | undefined => {
      if (takenByRename.has(storedName)) {
        return ofVariant ?? { filter: undefined, discriminatorFilter: undefined };
      }
      if (ofVariant !== undefined) {
        return storedFieldsOf(input.contract, destination).has(storedName) ? undefined : ofVariant;
      }
      return rootDocumentsLosing(input.contract, destination, storedName);
    };
    return Object.entries(ownStoredNamesOf(model))
      .filter(
        ([field, storedName]) =>
          unrewritableFieldNameReason(storedName) === undefined &&
          !renamed(input, { ...origin, field }),
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .flatMap(([field, storedName]) => {
        const lost = losing(storedName);
        return lost === undefined
          ? []
          : [
              {
                call: new UnsetFieldCall(collection, storedName, lost.filter),
                subject: { kind: 'field' as const, ...origin, field },
                destination,
                variant,
                discriminatorFilter: lost.discriminatorFilter,
              },
            ];
      });
  });
}

/**
 * Without an origin contract, a field is known removed when the origin validator declares it for a
 * root model and the destination validator declares it nowhere. It is named by its storage name.
 */
export function planValidatorFieldRemovals(input: {
  readonly origin: MongoSchemaIR;
  readonly destination: MongoSchemaIR;
  readonly contract: MongoContract;
}): readonly FieldRemoval[] {
  return input.origin.collections.flatMap((originCollection) => {
    if (collectionControlPolicy(input.contract, originCollection.name) !== 'managed') return [];
    const destination = input.destination.collection(originCollection.name);
    if (destination?.validator === undefined || originCollection.validator === undefined) return [];
    const kept = validatorFieldNamesOf(destination.validator.jsonSchema);
    const declared = new Set(
      validatorRootShapesOf(originCollection.validator.jsonSchema).flatMap((root) =>
        Object.keys(root.properties),
      ),
    );
    return [...declared]
      .filter((field) => unrewritableFieldNameReason(field) === undefined && !kept.has(field))
      .sort()
      .map((field) => ({
        call: new UnsetFieldCall(originCollection.name, field),
        subject: { kind: 'storage' as const, name: `${originCollection.name}.${field}` },
        destination: undefined,
        variant: undefined,
        discriminatorFilter: undefined,
      }));
  });
}
