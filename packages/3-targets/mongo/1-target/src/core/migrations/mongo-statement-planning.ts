import type {
  Contract,
  ContractModel,
  ContractRelation,
  ContractWithDomain,
} from '@internal/contract/types';
import {
  describeMigrationStatement,
  type FieldCoordinate,
  fieldStatementText,
  type MigrationPlannerConflict,
  type MigrationSubject,
  type ModelCoordinate,
  modelDisplayName,
  modelStatementText,
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
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import { unrewritableFieldNameReason } from './migration-factories';
import { renameInSchema } from './mongo-collection-plan';
import { collectionControlPolicy, managedOnBothSides } from './mongo-control-policy';
import { documentMoveOf, type MovingModel } from './mongo-document-moves';
import {
  documentCollectionOf,
  isRootModel,
  modelCoordinates,
  sameModel,
} from './mongo-model-coordinates';
import {
  capitalized,
  documentMovesText,
  fieldDisplayName,
  handWrittenRoute,
  joinedList,
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
  type ArrivalOf,
  earlierMigrationText,
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
  type SharedCollection,
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
  readonly fromContract: Contract;
  readonly contract: MongoContract;
  /** The schema the plan starts from. */
  readonly schema: MongoSchemaIR;
  /** The route of the statements the shared-collection rule refuses, when it refuses any. */
  readonly sharedRoute: SharedRoute | undefined;
  /** The model rename statement on the origin model `model` that the shared-collection rule refuses, if there is one. */
  readonly sharedCollectionRefusalOf: (
    model: ModelCoordinate,
  ) => ResolvedModelRenameStatement | undefined;
  /** Why the shared-collection rule would refuse a model rename from `from` to `to` given with the plan's statements, if it would. */
  readonly sharedIfRenamed: (
    from: ModelCoordinate,
    to: ModelCoordinate,
  ) => SharedCollection | undefined;
}

/** The whole plan of the same contracts without `statements`: its renames when it is made, its refusals when it is refused. */
export type PlanWithout = (
  statements: readonly ResolvedRenameStatement[],
) => Result<StatementPlan, readonly MigrationPlannerConflict[]>;

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
  readonly fromContract: Contract | null;
  readonly contract: MongoContract;
  readonly schema: MongoSchemaIR;
  readonly planWithout: PlanWithout;
}): Result<StatementPlan, readonly MigrationPlannerConflict[]> {
  const fromContract = input.fromContract ?? input.contract;
  const models = modelRenamesOf(input.statements, input.fromContract, input.contract);
  const collections = new CollectionRenames(models, fromContract, input.contract);
  const sharedRoute = sharedRouteOf({
    statements: input.statements,
    fromContract,
    contract: input.contract,
    models,
    collections,
    planWithout: input.planWithout,
  });
  const planning: PlanningInput = {
    statements: input.statements,
    fromContract,
    contract: input.contract,
    schema: input.schema,
    sharedRoute,
    sharedCollectionRefusalOf: (model) => {
      const rename = models.find(
        (each) => each.statement !== undefined && sameModel(each.from, model),
      );
      const change = rename === undefined ? undefined : collections.changeOf(rename);
      return change === undefined || collections.sharedCollection(change) === undefined
        ? undefined
        : rename?.statement;
    },
    sharedIfRenamed: (from, to) => {
      const statement: ResolvedModelRenameStatement = { kind: 'rename', entity: 'model', from, to };
      const withIt = modelRenamesOf(
        [...input.statements, statement],
        input.fromContract,
        input.contract,
      );
      const renamed = withIt.find((each) => each.statement === statement);
      const renames = new CollectionRenames(withIt, fromContract, input.contract);
      const change = renamed === undefined ? undefined : renames.changeOf(renamed);
      return change === undefined ? undefined : renames.sharedCollection(change);
    },
  };
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
                [
                  ...fieldRenames,
                  ...(input.fromContract === null ? [] : unstatedFieldRenamesOf(pairing)),
                ],
                planning,
                pairing,
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
        pairing,
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

  if (conflicts.length > 0) {
    const leftOut = sharedRoute?.leftOutRefusals() ?? [];
    return notOk([
      ...conflicts,
      ...leftOut.filter((each) => !conflicts.some((other) => other.summary === each.summary)),
    ]);
  }
  return ok({
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
 * stay, in a collection managed in both contracts that the destination model still reads: renaming
 * an embedded relation is not planned, as a statement on one is refused.
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
      collectionOfModel(match.contract.domain, destination) !== collection ||
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
        : `MongoDB cannot rename a time-series collection. Leave out this statement. With db update, first create collection "${to}" yourself with the time-series options of collection "${from}", which db.getCollectionInfos({ name: ${JSON.stringify(from)} }) shows in mongosh, copy the documents into it, and run db update again with --delete naming the model, which drops "${from}". With migration plan, plan with --delete naming the model; the migration.ts it writes creates collection "${to}", and there add a dataTransform that copies the documents right after that creation and before the drop of collection "${from}".`,
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

/** The stated changes the shared-collection rule refuses that split one collection, or merge into one. */
interface RefusedGroup {
  readonly shared: SharedCollection;
  readonly changes: readonly CollectionChange[];
}

/**
 * The route of every statement the shared-collection rule refuses in a plan. Every one of them must
 * be left out before any plan is made, so the route reads the plan without all of them, with their
 * field statements, and is printed once, under the first of them; the refusals of the others name
 * it by that statement.
 */
interface SharedRoute {
  /** The first model rename statement the rule refuses, whose refusal prints the route. */
  readonly printer: ResolvedModelRenameStatement;
  /** Whether the printer's refusal is about a split or a merge, so a refusal of the other kind keeps its own reason. */
  readonly printerKind: SharedCollection['kind'];
  /** The statements to leave out, as the CLI takes them. */
  readonly statementsText: string;
  readonly text: () => string;
  /** The refusals of the plan without the statements, when it is refused. */
  readonly leftOutRefusals: () => readonly MigrationPlannerConflict[];
}

function renameFlag(
  statement: ResolvedModelRenameStatement | ResolvedFieldRenameStatement,
  fromContract: ContractWithDomain,
  contract: ContractWithDomain,
): string {
  return `--rename ${
    statement.entity === 'field'
      ? `${modelStatementText(contract, statement.to)}.${statement.from.field}:${fieldStatementText(contract, statement.to)}`
      : `${modelStatementText(fromContract, statement.from)}:${modelStatementText(contract, statement.to)}`
  }`;
}

function refusedGroupsOf(collections: CollectionRenames): readonly RefusedGroup[] {
  const groups: { shared: SharedCollection; changes: CollectionChange[] }[] = [];
  for (const change of collections.changes) {
    if (!change.renames.some((rename) => rename.statement !== undefined)) continue;
    const shared = collections.sharedCollection(change);
    if (shared === undefined) continue;
    const group = groups.find(
      (each) =>
        each.shared.kind === shared.kind &&
        each.changes.some((other) =>
          shared.kind === 'split' ? other.from === change.from : other.to === change.to,
        ),
    );
    if (group === undefined) groups.push({ shared, changes: [change] });
    else group.changes.push(change);
  }
  return groups;
}

function movingModelsOf(group: RefusedGroup): readonly ModelCoordinate[] {
  return group.changes.flatMap((change) => change.renames.map((rename) => rename.from));
}

function staysIn(group: RefusedGroup): readonly ModelCoordinate[] {
  const moving = movingModelsOf(group);
  return group.shared.objects.filter((model) => !moving.some((each) => sameModel(each, model)));
}

/** The models of one collection the moving models become, and the documents already there they read. */
interface MoveDestination {
  readonly collection: string;
  readonly renamedTo: readonly ModelCoordinate[];
  readonly readers: readonly ModelCoordinate[];
}

/** Models the plan without the statements removes from a collection that keeps other models, which still read their documents. */
interface LeftBehind {
  readonly moving: readonly ModelCoordinate[];
  readonly staying: readonly ModelCoordinate[];
  /** The source collection, by its name after the plan's renames. */
  readonly from: string;
}

function destinationStartText({ renamedTo, readers }: MoveDestination): string {
  const one = renamedTo.length === 1;
  return readers.length === 0
    ? `${capitalized(modelsText(renamedTo))} ${one ? 'starts' : 'start'} with no documents.`
    : `${capitalized(modelsText(renamedTo))} ${one ? 'reads' : 'read'} the documents of ${modelsText(readers)} already stored in ${one ? 'its' : 'their'} collection, since no discriminator tells them apart.`;
}

/**
 * What the plan without the statements does to models whose documents no discriminator tells apart
 * from those of the models that stay: they are removed, and nothing is asked. With several source
 * collections, one paragraph says it for all of them.
 */
function removedText(
  left: readonly LeftBehind[],
  destinations: readonly MoveDestination[],
): string {
  const moving = left.flatMap((each) => each.moving);
  const one = moving.length === 1;
  const stillRead = ({ staying }: LeftBehind) =>
    `${modelsText(staying)} still read${staying.length === 1 ? 's' : ''} them`;
  const [only] = left;
  const places = left.map(
    (each) =>
      `those of ${modelsText(each.moving)} in collection "${each.from}", where ${stillRead(each)}`,
  );
  const where =
    left.length === 1 && only !== undefined
      ? `${one ? 'Its' : 'Their'} documents stay in collection "${only.from}", where ${stillRead(only)}.`
      : `Their documents stay where they are: ${places.slice(0, -1).join(', ')}, and ${places.at(-1)}.`;
  const sources = left.map(({ from }) => `"${from}"`);
  const validated =
    sources.length === 1 ? sources[0] : `${sources.slice(0, -1).join(', ')} or ${sources.at(-1)}`;
  return `${capitalized(modelsText(moving))} ${one ? 'is' : 'are'} then removed and nothing is asked, since nothing is deleted. ${where} ${destinations.map(destinationStartText).join(' ')} If the new validator of collection ${validated} does not accept them, its change stops the apply in every database that holds them, until they are deleted or moved there.`;
}

/** The destinations of the moving models, one to a collection. */
function byCollection(destinations: readonly MoveDestination[]): readonly MoveDestination[] {
  const merged: MoveDestination[] = [];
  for (const destination of destinations) {
    const index = merged.findIndex(({ collection }) => collection === destination.collection);
    const found = merged[index];
    if (found === undefined) {
      merged.push(destination);
      continue;
    }
    merged[index] = {
      collection: found.collection,
      renamedTo: [...found.renamedTo, ...destination.renamedTo],
      readers: [
        ...found.readers,
        ...destination.readers.filter(
          (reader) => !found.readers.some((each) => sameModel(each, reader)),
        ),
      ],
    };
  }
  return merged;
}

/** What the plan without the statements does to models whose documents it drops with their collection: it asks about them. */
function askedText(moving: readonly ModelCoordinate[], kept: boolean): string {
  const answer = kept
    ? 'Answered with the --delete it also offers, it plans the change; under db update that deletes the data.'
    : 'Answer it with --delete, which it also offers: that plans the change and deletes the data.';
  return `The plan then asks about the data of ${modelsText(moving)}, which it drops. Its question offers this same rename again, which is refused again for the same reason. ${answer}`;
}

/** What the route says when the plan without the statements is refused as well, so its own refusals say what to change first. */
function leftOutPlanRefused(count: number, refusals: readonly MigrationPlannerConflict[]): string {
  const planned = `Planned without ${count === 1 ? 'it' : 'them'}, the change is refused for another reason as well`;
  if (refusals.length === 0) return `${planned}.`;
  const one = refusals.length === 1;
  return `${planned}: ${joinedList(refusals.map(({ summary }) => `"${summary}"`))}. ${one ? 'That refusal is' : 'Those refusals are'} listed here too, with what to change first.`;
}

function sharedRouteOf(input: {
  readonly statements: readonly ResolvedRenameStatement[];
  readonly fromContract: Contract;
  readonly contract: MongoContract;
  readonly models: readonly ModelRename[];
  readonly collections: CollectionRenames;
  readonly planWithout: PlanWithout;
}): SharedRoute | undefined {
  const { statements, fromContract, contract, models } = input;
  const groups = refusedGroupsOf(input.collections);
  const renames = groups.flatMap((group) => group.changes.flatMap((change) => change.renames));
  const movingModels = renames.map((renamed) => renamed.from);
  const modelStatements = statements.filter(
    (each): each is ResolvedModelRenameStatement =>
      each.entity === 'model' && renames.some((renamed) => renamed.statement === each),
  );
  const [printer] = modelStatements;
  const printerGroup = groups.find((group) =>
    group.changes.some((change) => change.renames.some((renamed) => renamed.statement === printer)),
  );
  if (printer === undefined || printerGroup === undefined) return undefined;
  const fieldStatements = statements.filter(
    (each): each is ResolvedFieldRenameStatement =>
      each.entity === 'field' && movingModels.some((model) => sameModel(model, each.from)),
  );
  const leftOutStatements = [...modelStatements, ...fieldStatements];
  const statementsText = joinedList(
    leftOutStatements.map((each) => renameFlag(each, fromContract, contract)),
  );
  const leavesBehind = (group: RefusedGroup) =>
    group.shared.kind === 'split' &&
    group.changes.every((change) =>
      change.renames.every((renamed) => isRootModel(fromContract, renamed.from)),
    );
  const becomesVariant = (group: RefusedGroup) =>
    group.changes.some((change) =>
      change.renames.some(
        (renamed) => selectedVariantOf(contract.domain, renamed.to) !== undefined,
      ),
    );
  const readersIn = (collection: string, group: RefusedGroup) =>
    modelCoordinates(contract).filter(
      (model) =>
        !becomesVariant(group) &&
        documentCollectionOf(contract, model) === collection &&
        isRootModel(contract, model) &&
        !renames.some((renamed) => sameModel(renamed.to, model)),
    );
  const opening = `Leave out ${statementsText} to plan the change without moving them.`;
  let leftOutResult: { readonly value: ReturnType<PlanWithout> } | undefined;
  const leftOutPlan = () => {
    leftOutResult ??= { value: input.planWithout(leftOutStatements) };
    return leftOutResult.value;
  };
  const leftBehindGroup = (group: RefusedGroup) => leavesBehind(group) && staysIn(group).length > 0;

  /** What the plan without the statements does to each group's models; `kept` when the route then keeps the data it asks about. */
  const consequences = (plan: StatementPlan | undefined, kept: boolean): string => {
    const left = groups.filter(leftBehindGroup);
    const asked = groups.filter((group) => !leftBehindGroup(group));
    const fromOf = (group: RefusedGroup) => {
      const from = group.changes[0]?.from ?? '';
      return plan?.renamedCollections.get(from) ?? from;
    };
    const removed =
      left.length === 0
        ? []
        : [
            removedText(
              left.map((group) => ({
                moving: movingModelsOf(group),
                staying: staysIn(group),
                from: fromOf(group),
              })),
              byCollection(
                left.flatMap((group) =>
                  group.changes.map((change) => ({
                    collection: change.to,
                    renamedTo: change.renames.map((renamed) => renamed.to),
                    readers: readersIn(change.to, group),
                  })),
                ),
              ),
            ),
          ];
    return [
      opening,
      ...removed,
      ...(asked.length === 0 ? [] : [askedText(asked.flatMap(movingModelsOf), kept)]),
    ].join(' ');
  };

  const refusedText = (leftOut: ReturnType<PlanWithout>) =>
    leftOut.ok ? '' : `\n\n${leftOutPlanRefused(leftOutStatements.length, leftOut.failure)}`;

  const handWritten = (): string => {
    const leftOut = leftOutPlan();
    const what = joinedList(
      groups.map((group) => {
        if (group.shared.kind === 'merged') {
          const to = group.changes[0]?.to ?? '';
          const moving = modelsText(movingModelsOf(group));
          const storedElsewhere = staysIn(group).filter(
            (model) => documentCollectionOf(fromContract, model) !== to,
          );
          return storedElsewhere.length === 0
            ? `the documents of ${moving} into collection "${to}"`
            : `the documents of ${moving}, and those of ${modelsText(storedElsewhere)} that collection "${to}" does not already hold, into collection "${to}"`;
        }
        return joinedList(
          group.changes.map(
            (change) =>
              `the documents of ${modelsText(change.renames.map((renamed) => renamed.from))} into collection "${change.to}"`,
          ),
        );
      }),
    );
    return `${consequences(leftOut.ok ? leftOut.value : undefined, false)}${refusedText(leftOut)}\n\n${handWrittenRoute(what)}`;
  };

  const leaveBehind = (): string => {
    const leftOut = leftOutPlan();
    if (!leftOut.ok) return `${consequences(undefined, false)}${refusedText(leftOut)}`;
    const plan = leftOut.value;
    const asked = groups.filter((group) => staysIn(group).length === 0);
    const match: ModelMatchInput = {
      statements,
      models,
      fieldRenames: fieldStatements.map((each) => ({
        from: each.from,
        to: each.to,
        statement: each,
      })),
      fromContract,
      contract,
      collectionAfterRenames: (name) => name,
    };
    const moves = groups.flatMap((group) =>
      group.changes.map((change) =>
        documentMoveOf(
          {
            schema: plan.schema,
            fromContract,
            contract,
            originFrom: change.from,
            to: change.to,
            collectionRenames: plan.collectionRenames,
          },
          change.renames.map((renamed) =>
            movingModelOf(match, modelDisplayName(renamed.from), renamed.from, renamed.to),
          ),
        ),
      ),
    );
    const askedModels = asked.flatMap(movingModelsOf);
    const dropped = joinedList(
      asked.map(
        (group) =>
          `"${plan.renamedCollections.get(group.changes[0]?.from ?? '') ?? group.changes[0]?.from}"`,
      ),
    );
    const answer =
      askedModels.length === 0
        ? ''
        : `, and answer its question about ${modelsText(askedModels)} with the --delete it offers: the copies below run before the plan drops collection${asked.length === 1 ? '' : 's'} ${dropped}, so they keep the documents, and the drop removes only the emptied collection${asked.length === 1 ? '' : 's'}`;
    return `${consequences(plan, true)}\n\nWith migration plan, keep the documents by moving them in the migration that plan writes. Plan the change without ${statementsText}${answer}.\n\n${documentMovesText(moves)}`;
  };

  let built: string | undefined;
  return {
    printer,
    printerKind: printerGroup.shared.kind,
    statementsText,
    text: () => {
      built ??= groups.every(leavesBehind) ? leaveBehind() : handWritten();
      return built;
    },
    leftOutRefusals: () => {
      const leftOut = leftOutPlan();
      return leftOut.ok ? [] : leftOut.failure;
    },
  };
}

/**
 * The refusal of a model rename statement whose collection holds other models that do not move with
 * it, or whose new collection holds models from elsewhere. Every statement the rule refuses shares
 * one route, which the first of them prints; the others name it.
 */
function sharedCollectionRefusal(
  statement: ResolvedModelRenameStatement,
  label: string,
  collections: CollectionRenames,
  models: readonly ModelRename[],
  input: PlanningInput,
): StatementOutcome | undefined {
  const { fromContract, contract, sharedRoute } = input;
  const rename = models.find((model) => model.statement === statement);
  const change = rename === undefined ? undefined : collections.changeOf(rename);
  const shared = change === undefined ? undefined : collections.sharedCollection(change);
  if (change === undefined || shared === undefined || sharedRoute === undefined) return undefined;
  const { from, to } = change;
  const others = modelsText(shared.objects);
  const printerFlag = renameFlag(sharedRoute.printer, fromContract, contract);
  const pointer = (says: string) =>
    `Leave out ${sharedRoute.statementsText} to plan the change without moving them: the refusal of ${printerFlag} says ${says}, and how to keep the documents.`;
  const whyOf = (reason: string) => {
    if (sharedRoute.printer === statement) return `${reason}\n\n${sharedRoute.text()}`;
    if (sharedRoute.printerKind === shared.kind) return pointer('why, what that plan does');
    return `${reason}\n\n${pointer('what that plan does')}`;
  };
  switch (shared.kind) {
    case 'split':
      return refusedOutcome(
        statement,
        `${label}: collection "${from}" also stores ${others}`,
        whyOf(
          `A collection rename moves every document of the collection, and the documents of ${others} do not move to collection "${to}". Moving the documents of one model out of a collection it shares with others is a data migration, which a plan does not write.`,
        ),
      );
    case 'merged':
      return refusedOutcome(
        statement,
        `${label}: collection "${to}" also stores ${others}, whose documents are not in collection "${from}"`,
        whyOf(
          `A collection rename moves the documents of one collection, and collection "${to}" would also store the documents of ${others}. Moving the documents of two collections into one is a data migration, which a plan does not write.`,
        ),
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
function unrenamedCollectionWhy(
  statement: ResolvedFieldRenameStatement,
  collection: string,
  input: PlanningInput,
): string {
  const flag = (each: ResolvedModelRenameStatement) =>
    renameFlag(each, input.fromContract, input.contract);
  const refused = input.sharedCollectionRefusalOf(statement.from);
  const printer = input.sharedRoute?.printer;
  if (refused !== undefined && printer !== undefined) {
    return `The documents of model "${modelDisplayName(statement.from)}", which hold field "${fieldDisplayName(statement.from)}", stay in collection "${collection}": the plan does not rename that collection, since ${flag(refused)} is refused. ${printer === refused ? 'That refusal' : `The refusal of ${flag(printer)}`} names the statements to leave out, this one among them, and how to keep the documents.`;
  }
  if (!sameModel(statement.from, statement.to)) {
    const modelStatement = flag({
      kind: 'rename',
      entity: 'model',
      from: statement.from,
      to: statement.to,
    });
    const shared = input.sharedIfRenamed(statement.from, statement.to);
    return shared === undefined
      ? `Add ${modelStatement} before this statement, so the collection is renamed with its documents.`
      : `${modelStatement} would be refused as well: collection "${shared.kind === 'split' ? collection : (collectionOfModel(input.contract.domain, statement.to) ?? collection)}" also stores ${modelsText(shared.objects)}. Leave out this statement too. To see how to keep the documents of model "${modelDisplayName(statement.from)}", give ${modelStatement} with this statement: its refusal names the route.`;
  }
  return `The plan renames a collection only when every model stored in it moves to the same new collection, its control policy is "managed" in both contracts, and the schema being planned from has the old collection and not the new one, so the field would be renamed in a collection the destination does not store the model in. ${LEAVE_OUT}`;
}

/**
 * Plans a field rename, of a statement or of a field both contracts name alike, in the documents
 * of its model's collection once the collection renames are made. A rename no statement asks for
 * renames nothing in a collection the plan does not rename to the model's new collection, does not
 * keep, or does not manage in both contracts; the plan then is what it is without the rename.
 * It is refused when it would reach the documents of another model the destination stores in the
 * collection (ADR 324): one that stays there and stores the old stored name, or one that arrives
 * there, such as a model whose documents a hand-written move copies in, and stores it in the
 * destination.
 */
function planFieldRename(
  rename: FieldRename,
  statementLabel: string | undefined,
  renamedCollections: ReadonlyMap<string, string>,
  schema: MongoSchemaIR,
  renames: readonly FieldRename[],
  input: PlanningInput,
  pairing: ModelMatchInput,
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
      unrenamedCollectionWhy(statement, collection, input),
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
  const together = renames.filter(
    (other) =>
      other.from.namespaceId === rename.from.namespaceId &&
      storedFieldNameAt(input.fromContract, other.from) === fromStored &&
      storedFieldNameAt(input.contract, other.to) === toStored,
  );
  const staying = otherModelsReached(
    input.fromContract.domain,
    rename.from,
    originCollection,
    variant,
    fromStored,
  ).filter(
    (name) =>
      !together.some((other) => other.from.model === name) &&
      sharesCollectionInDestination(
        { namespaceId: rename.from.namespaceId, model: name },
        destinationCollection,
        pairing,
      ),
  );
  const arriving = otherModelsReached(
    input.contract.domain,
    rename.to,
    destinationCollection,
    selectedVariantOf(input.contract.domain, rename.to),
    fromStored,
  ).filter((name) => {
    if (together.some((other) => other.to.model === name)) return false;
    const origin = originModelOf({ namespaceId: rename.to.namespaceId, model: name }, pairing);
    return origin === undefined || !staying.includes(origin.model);
  });
  const others = [...staying, ...arriving];
  if (others.length > 0) {
    const arrival = arrivalOf(pairing);
    const earlier =
      staying.length === 0
        ? earlierMigrationText(
            arriving.map((name) => ({
              name,
              arrival: arrival(
                { namespaceId: rename.to.namespaceId, model: name },
                collection,
                fromStored,
              ),
            })),
            collection,
            fromStored,
            'holding',
          )
        : '';
    const sharedWhy = `${sharedCollectionWhy(collection, others, 'renaming the field would rename it in the documents')} To change it, ${changed === undefined ? SEPARATE_THE_MODELS : `move the models to separate collections, or keep the stored name ${JSON.stringify(fromStored)} in the contract`}.${earlier}`;
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

/**
 * How each destination model that blocks a rewrite came into its collection: with no origin model
 * stored there after the plan's renames, it is new to the collection; with one that does not store
 * the field, it starts storing it.
 */
export function arrivalOf(match: ModelMatchInput): ArrivalOf {
  return (model, collection, storedName) => {
    const origin = originModelOf(model, match);
    const originCollection =
      origin === undefined ? undefined : documentCollectionOf(match.fromContract, origin);
    if (
      origin === undefined ||
      originCollection === undefined ||
      match.collectionAfterRenames(originCollection) !== collection
    ) {
      return 'joinsCollection';
    }
    return storedFieldsOf(match.fromContract, origin).has(storedName)
      ? undefined
      : 'startsStoringField';
  };
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

/**
 * The stored names the documents of `origins` change, from the origin's to the destination's, as a
 * document move must write them: of the plan's field renames, and of the fields their destination
 * models name alike, which the plan does not rename when a model moves to another collection.
 */
export function movedStoredNames(
  input: ModelMatchInput,
  origins: readonly ModelCoordinate[],
): readonly { readonly from: string; readonly to: string }[] {
  const fieldRenames = [...input.fieldRenames, ...unstatedFieldRenamesOf(input)];
  const moves = origins.flatMap((origin) => storedNameMoves({ ...input, fieldRenames }, origin));
  return moves.filter(
    (move, index) =>
      moves.findIndex((other) => other.from === move.from && other.to === move.to) === index,
  );
}

/**
 * A model whose documents a document move copies from `origin` to `destination`: the stored names
 * that change on the way, those the destination does not store, and its variant there. With no
 * destination model, the copy changes only the stored names.
 */
export function movingModelOf(
  input: ModelMatchInput,
  name: string,
  origin: ModelCoordinate,
  destination: ModelCoordinate | undefined,
): MovingModel {
  const storedNameMoves = movedStoredNames(input, [origin]);
  if (destination === undefined) {
    return { name, storedNameMoves, droppedStoredNames: [], variant: undefined };
  }
  const accounted = new Set([
    ...storedNameMoves.flatMap(({ from, to }) => [from, to]),
    ...storedFieldsOf(input.contract, destination),
  ]);
  return {
    name,
    storedNameMoves,
    droppedStoredNames: [...storedFieldsOf(input.fromContract, origin)].filter(
      (stored) => !accounted.has(stored),
    ),
    variant: selectedVariantOf(input.contract.domain, destination),
  };
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
