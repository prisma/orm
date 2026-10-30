import {
  asNamespaceId,
  type Contract,
  type ContractModel,
  type ContractRelation,
  type ContractWithDomain,
  type ControlPolicy,
  governingControlPolicy,
} from '@internal/contract/types';
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
  collectionControlPoliciesOf,
  collectionControlPolicyOf,
  collectionRootModelsOf,
  hasOwnFieldStoredAs,
  MongoCollection,
  type MongoContract,
  type MongoModelStorage,
  modelAndBasesOf,
  mongoModelsOf,
  ownEmbedStoredNamesOf,
  ownStoredNameOf,
  ownStoredNamesOf,
  validatorFieldNamesOf,
  validatorRootShapesOf,
} from '@internal/mongo-contract';
import { MongoSchemaCollection, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import { unrewritableFieldNameReason } from './migration-factories';
import {
  type OpFactoryCall,
  RenameCollectionCall,
  RenameFieldCall,
  UnsetFieldCall,
} from './op-factory-call';

type Document = Record<string, unknown>;

/** The collection a model stores its documents in; a model without `@@map` names it verbatim. */
export function collectionOf(
  contract: ContractWithDomain | null,
  coordinate: ModelCoordinate,
): string {
  const collection =
    contract?.domain.namespaces[coordinate.namespaceId]?.models[coordinate.model]?.storage[
      'collection'
    ];
  return typeof collection === 'string' ? collection : coordinate.model;
}

function modelAt(
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

/**
 * The condition that selects a variant's documents in the collection it shares with its base: the
 * base's discriminator field holding the variant's value. A model that is not a variant has none.
 */
function variantFilter(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): Document | undefined {
  const base = modelAt(contract, coordinate)?.base;
  if (base === undefined) return undefined;
  const baseModel = modelAt(contract, {
    namespaceId: asNamespaceId(base.namespace),
    model: base.model,
  });
  const field = baseModel?.discriminator?.field;
  const variants = Object.entries(baseModel?.variants ?? {});
  const value = variants.find(
    ([, variant]) =>
      variant.namespace === coordinate.namespaceId && variant.model === coordinate.model,
  )?.[0];
  return baseModel === undefined || field === undefined || value === undefined
    ? undefined
    : { [ownStoredNameOf(baseModel, field)]: value };
}

/** The control policy that governs a collection, and the policy its contract declares for it. */
export interface CollectionControl {
  readonly policy: ControlPolicy;
  readonly declared: ControlPolicy | undefined;
}

function declaredCollection(contract: Contract, collection: string): MongoCollection | undefined {
  return Object.values(contract.storage.namespaces)
    .map((namespace) => namespace.entries['collection']?.[collection])
    .find((entry) => entry instanceof MongoCollection);
}

/**
 * The control policy of `collection`. A collection the contract leaves out keeps the policy `fromContract` gave it, when that was not `managed`, so leaving an `external` collection out of the contract does not drop it.
 */
export function collectionControlOf(
  contract: MongoContract,
  fromContract: Contract | null,
  collection: string,
): CollectionControl {
  const declared = declaredCollection(contract, collection);
  const original =
    declared === undefined && fromContract !== null
      ? declaredCollection(fromContract, collection)
      : undefined;
  const policy = collectionControlPolicyOf(collection, collectionControlPoliciesOf(contract));
  if (original === undefined || fromContract === null) {
    return { policy, declared: declared?.control };
  }
  const originalPolicy = governingControlPolicy(
    { explicitNodeControlPolicy: original.control },
    fromContract.defaultControlPolicy,
  );
  return {
    policy: originalPolicy === 'managed' ? policy : originalPolicy,
    declared: original.control,
  };
}

export function collectionControlPolicy(contract: MongoContract, collection: string) {
  return collectionControlOf(contract, null, collection).policy;
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
  readonly rewrites: readonly (RenameFieldCall | UnsetFieldCall)[];
}

export interface StatementPlan {
  /** The origin schema with each renamed collection under its new name, for the diff to compare. */
  readonly schema: MongoSchemaIR;
  readonly collectionRenames: readonly RenameCollectionCall[];
  readonly fieldRenames: readonly RenameFieldCall[];
  /** For each statement, in order, the call that carries it out, or `undefined` when storage does not change. */
  readonly callOfStatement: readonly (OpFactoryCall | undefined)[];
}

function refused(
  statement: ResolvedMigrationStatement,
  label: string,
  reason: string,
  why: string,
): MigrationPlannerConflict {
  return {
    kind: 'statementRefused',
    summary: `${label}: ${reason}`,
    why,
    refusedStatement: statement,
  };
}

const LEAVE_OUT = 'Leave out this statement.';

const SEPARATE_THE_MODELS =
  'move the models to separate collections, or carry out the change in a dataTransform operation of a migration.ts, with a filter that selects only their documents';

/**
 * The discriminator field and value a variant's filter selects, or `undefined` for a filter that selects by anything else, or no filter.
 */
function discriminatorValueOf(
  filter: Document | undefined,
): { readonly field: string; readonly value: unknown } | undefined {
  const entries = Object.entries(filter ?? {});
  if (entries.length !== 1) return undefined;
  const [entry] = entries;
  if (entry === undefined) return undefined;
  const [field, value] = entry;
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? { field, value }
    : undefined;
}

/**
 * The other models stored in `collection`, root models and their variants, whose documents a change of `storedName` with `filter` reaches, and which store the field themselves or through their base. No discriminator tells the documents of several root models apart, so without a filter, or with a base model's filter, every other root model's documents are reached. A variant's filter, one discriminator value, reaches a model only when its documents can hold that value: a variant of another root model with the same discriminator field and value, or a model that declares the discriminator field itself.
 */
function otherModelsReached(
  contract: ContractWithDomain,
  model: ModelCoordinate,
  collection: string,
  filter: Document | undefined,
  storedName: string,
): readonly string[] {
  const models = mongoModelsOf(contract.domain, model.namespaceId);
  const baseOf = (name: string) => {
    const base = models[name]?.base;
    return base === undefined ? undefined : models[base.model];
  };
  const storesOrInherits = (name: string, storedName: string) =>
    modelAndBasesOf(models, name).some((each) => ownStores(each, storedName));
  const selected = discriminatorValueOf(filter);
  const canHold = (name: string) => {
    if (selected === undefined) return true;
    const base = baseOf(name);
    const discriminator = base?.discriminator?.field;
    if (
      base !== undefined &&
      discriminator !== undefined &&
      ownStoredNameOf(base, discriminator) === selected.field
    ) {
      return Object.entries(base.variants ?? {}).some(
        ([value, variant]) => variant.model === name && value === selected.value,
      );
    }
    return storesOrInherits(name, selected.field);
  };
  const subjectRoot = modelAt(contract, model)?.base?.model ?? model.model;
  return (collectionRootModelsOf(models)[collection] ?? [])
    .filter((name) => name !== subjectRoot)
    .flatMap((name) => [
      name,
      ...Object.values(models[name]?.variants ?? {}).map((variant) => variant.model),
    ])
    .filter((name) => canHold(name) && storesOrInherits(name, storedName));
}

function sharedCollectionWhy(
  collection: string,
  others: readonly string[],
  change: string,
): string {
  const names = others.map((name) => JSON.stringify(name)).join(', ');
  return `Collection ${JSON.stringify(collection)} stores several models and no discriminator tells their documents apart, so ${change} of ${names} too.`;
}

/**
 * A removal the plan cannot carry out because another root model stored in the same collection still stores the field, and no discriminator selects the documents of the model that loses it.
 */
export function sharedCollectionRemovalRefusals(
  removals: readonly FieldRemoval[],
  contract: ContractWithDomain,
): readonly MigrationPlannerConflict[] {
  return removals.flatMap((removal): MigrationPlannerConflict[] => {
    const { subject, call } = removal;
    if (subject.kind !== 'field') return [];
    const others = otherModelsReached(contract, subject, call.collection, call.filter, call.field);
    if (others.length === 0) return [];
    return [
      {
        kind: 'fieldRemovalRefused',
        summary: `Cannot remove field ${JSON.stringify(call.field)} of model ${JSON.stringify(subject.model)} from collection ${JSON.stringify(call.collection)}: model ${others.map((name) => JSON.stringify(name)).join(', ')} stores it in the same collection`,
        why: `${sharedCollectionWhy(call.collection, others, 'removing the field would remove it from the documents')} To keep it in ${others.map((name) => JSON.stringify(name)).join(', ')} documents only, ${SEPARATE_THE_MODELS}.`,
      },
    ];
  });
}

const TIME_SERIES_UPDATES =
  'MongoDB updates the documents of a time-series collection only through its metaField';

/**
 * A removal the plan cannot carry out because its collection is a time-series collection, whose
 * documents MongoDB does not let an update change except through the metaField.
 */
export function timeSeriesRemovalRefusals(
  removals: readonly FieldRemoval[],
  schema: MongoSchemaIR,
): readonly MigrationPlannerConflict[] {
  return removals
    .filter(
      (removal) => schema.collection(removal.call.collection)?.options?.timeseries !== undefined,
    )
    .map((removal) => ({
      kind: 'fieldRemovalRefused',
      summary: `Cannot remove field ${JSON.stringify(removal.call.field)} from collection ${JSON.stringify(removal.call.collection)}: it is a time-series collection`,
      why: `${TIME_SERIES_UPDATES}, so the field cannot be removed from the documents that hold it. Keep the field in the contract, as an optional field if new documents leave it out, then run this command again.`,
    }));
}

/**
 * Plans the rename each statement states, in order: a model statement whose collection changes renames the
 * collection in the schema the diff then starts from, and a field statement whose stored name
 * changes renames the field in the documents that hold it.
 */
export function planStatements(input: {
  readonly statements: readonly ResolvedRenameStatement[];
  readonly fromContract: ContractWithDomain;
  readonly contract: MongoContract;
  readonly schema: MongoSchemaIR;
}): Result<StatementPlan, readonly MigrationPlannerConflict[]> {
  let schema = input.schema;
  const collectionRenames: RenameCollectionCall[] = [];
  const fieldRenames: RenameFieldCall[] = [];
  const callOfStatement: (OpFactoryCall | undefined)[] = [];
  const conflicts: MigrationPlannerConflict[] = [];
  const renamedCollections = new Map<string, string>();

  for (const statement of input.statements) {
    const label = `Cannot ${describeMigrationStatement(statement, input.fromContract, input.contract)}`;
    const outcome: StatementOutcome =
      statement.entity === 'namespace'
        ? {
            kind: 'refused',
            conflict: refused(
              statement,
              label,
              'MongoDB does not rename namespaces in this release',
              LEAVE_OUT,
            ),
          }
        : statement.entity === 'enumValue'
          ? {
              kind: 'refused',
              conflict: refused(
                statement,
                label,
                'MongoDB does not rename enum values in this release',
                LEAVE_OUT,
              ),
            }
          : statement.entity === 'valueObjectField'
            ? {
                kind: 'refused',
                conflict: refused(
                  statement,
                  label,
                  'MongoDB does not rename value object fields in this release',
                  LEAVE_OUT,
                ),
              }
            : statement.entity === 'model'
              ? planModelStatement(statement, label, schema, input)
              : planFieldStatement(statement, label, renamedCollections, schema, input);
    if (outcome.kind === 'refused') {
      conflicts.push(outcome.conflict);
      callOfStatement.push(undefined);
      continue;
    }
    if (outcome.kind === 'renameCollection') {
      schema = renameInSchema(schema, outcome.call.from, outcome.call.to);
      renamedCollections.set(outcome.call.from, outcome.call.to);
      collectionRenames.push(outcome.call);
    }
    if (outcome.kind === 'renameField') {
      const same = fieldRenames.find((call) => sameFieldRename(call, outcome.call));
      if (same !== undefined) {
        callOfStatement.push(same);
        continue;
      }
      fieldRenames.push(outcome.call);
    }
    callOfStatement.push(outcome.kind === 'unchanged' ? undefined : outcome.call);
  }

  return conflicts.length > 0
    ? notOk(conflicts)
    : ok({ schema, collectionRenames, fieldRenames, callOfStatement });
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
  | { readonly kind: 'renameField'; readonly call: RenameFieldCall }
  | { readonly kind: 'refused'; readonly conflict: MigrationPlannerConflict };

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
  return {
    kind: 'refused',
    conflict: refused(
      statement,
      label,
      `collection "${collection}" has control policy "${policy}"`,
      `Statements rename only collections, and fields of collections, whose control policy is "managed". Make the change in the database yourself and leave out this statement.`,
    ),
  };
}

/**
 * The reason and advice when a statement renames a variant whose discriminator value changes: its
 * documents keep the old value, which the new validator does not accept.
 */
function discriminatorValueChange(
  statement: ResolvedModelRenameStatement,
  input: { readonly fromContract: ContractWithDomain; readonly contract: MongoContract },
): readonly [reason: string, why: string] | undefined {
  const before = variantFilter(input.fromContract, statement.from);
  const after = variantFilter(input.contract, statement.to);
  const base = modelAt(input.contract, statement.to)?.base;
  if (before === undefined || after === undefined || base === undefined) return undefined;
  const [field, oldValue] = Object.entries(before)[0] ?? [];
  const newValue = Object.values(after)[0];
  if (field === undefined || oldValue === newValue) return undefined;
  const fromName = modelDisplayName(statement.from);
  const toName = modelDisplayName(statement.to);
  return [
    `its discriminator value changes from ${JSON.stringify(oldValue)} to ${JSON.stringify(newValue)}`,
    `The documents of "${fromName}" hold ${field} ${JSON.stringify(oldValue)}, and this release does not rewrite a discriminator value, so they would no longer match "${toName}" and would fail validation. Keep the value: declare "${toName}" with @@base(${base.model}, ${JSON.stringify(oldValue)}). A later release changes a stored value with --convert.`,
  ];
}

function planModelStatement(
  statement: ResolvedModelRenameStatement,
  label: string,
  schema: MongoSchemaIR,
  input: { readonly fromContract: ContractWithDomain; readonly contract: MongoContract },
): StatementOutcome {
  const discriminatorChange = discriminatorValueChange(statement, input);
  if (discriminatorChange !== undefined) {
    return { kind: 'refused', conflict: refused(statement, label, ...discriminatorChange) };
  }
  const from = collectionOf(input.fromContract, statement.from);
  const to = collectionOf(input.contract, statement.to);
  if (from === to) return { kind: 'unchanged' };
  const policyRefusal = controlPolicyRefusal(statement, label, input.contract, to);
  if (policyRefusal !== undefined) return policyRefusal;
  const refuse = (reason: string, why: string): StatementOutcome => ({
    kind: 'refused',
    conflict: refused(statement, label, reason, why),
  });
  const source = schema.collection(from);
  if (source === undefined) {
    return refuse(
      `the schema being planned from has no collection "${from}"`,
      `The database has no collection "${from}", or "${from}" is a view, which MongoDB cannot rename. Inspect it with prisma db schema, or ${LEAVE_OUT.toLowerCase()}`,
    );
  }
  if (source.options?.timeseries !== undefined) {
    return refuse(
      `collection "${from}" is a time-series collection`,
      `MongoDB cannot rename a time-series collection. Leave out this statement. To keep the documents, first create collection "${to}" yourself with the same time-series options and copy them into it; the plan then drops "${from}" once --delete names the model.`,
    );
  }
  const invalid = invalidCollectionNameReason(to);
  if (invalid !== undefined) {
    return refuse(
      `MongoDB does not accept the collection name "${to}": ${invalid}`,
      'Give the model a collection name MongoDB accepts with @@map, then run this command again.',
    );
  }
  if (schema.collection(to) !== undefined) {
    return refuse(
      `the schema being planned from already has a collection "${to}"`,
      `A rename cannot replace a collection that already exists. Rename or drop collection "${to}" first, or ${LEAVE_OUT.toLowerCase()}`,
    );
  }
  return { kind: 'renameCollection', call: new RenameCollectionCall(from, to) };
}

function planFieldStatement(
  statement: ResolvedFieldRenameStatement,
  label: string,
  renamedCollections: ReadonlyMap<string, string>,
  schema: MongoSchemaIR,
  input: {
    readonly statements: readonly ResolvedRenameStatement[];
    readonly fromContract: ContractWithDomain;
    readonly contract: MongoContract;
  },
): StatementOutcome {
  const refuse = (reason: string, why: string): StatementOutcome => ({
    kind: 'refused',
    conflict: refused(statement, label, reason, why),
  });
  const fromField = storedField(modelAt(input.fromContract, statement.from), statement.from.field);
  const toField = storedField(modelAt(input.contract, statement.to), statement.to.field);
  if (fromField.kind === 'embed' || toField.kind === 'embed') {
    return refuse(
      'the field is an embedded relation',
      `Renaming an embedded relation is not supported in this release. ${LEAVE_OUT}`,
    );
  }
  if (fromField.kind !== 'field' && toField.kind !== 'field') return { kind: 'unchanged' };
  if (fromField.kind !== 'field' || toField.kind !== 'field') {
    return refuse(
      'the field is stored in documents on one side of the statement only',
      `A relation is not stored in documents, so a statement cannot rename a field to or from one. ${LEAVE_OUT}`,
    );
  }
  const fromStored = resolvedStoredNameAt(input.fromContract, statement.from);
  const toStored = resolvedStoredNameAt(input.contract, statement.to);
  const originCollection = collectionOf(input.fromContract, statement.from);
  const collection = renamedCollections.get(originCollection) ?? originCollection;
  const destinationCollection = collectionOf(input.contract, statement.to);
  if (fromStored === toStored && collection === destinationCollection) {
    return { kind: 'unchanged' };
  }
  if (fromStored === '_id' || toStored === '_id') {
    return refuse('it renames _id', `MongoDB does not let a document change its _id. ${LEAVE_OUT}`);
  }
  const unsafeFrom = unrewritableFieldNameReason(fromStored);
  if (unsafeFrom !== undefined) {
    return refuse(
      `the stored name "${fromStored}" cannot be rewritten`,
      `${unsafeFrom}, so a statement cannot move its values. Rename it in the database yourself, or ${LEAVE_OUT.toLowerCase()}`,
    );
  }
  const unsafeTo = unrewritableFieldNameReason(toStored);
  if (unsafeTo !== undefined) {
    return refuse(
      `the stored name "${toStored}" cannot be written`,
      `${unsafeTo}. Give the field a stored name without "." that does not start with "$" (with @map), or ${LEAVE_OUT.toLowerCase()}`,
    );
  }
  if (collection !== destinationCollection) {
    return refuse(
      `the model's collection changes from "${originCollection}" to "${destinationCollection}", and no statement renames it`,
      collectionChangeAdvice(statement, originCollection, destinationCollection),
    );
  }
  if (schema.collection(collection)?.options?.timeseries !== undefined) {
    return refuse(
      `collection "${collection}" is a time-series collection`,
      `${TIME_SERIES_UPDATES}, so a statement cannot move the values of a field in them. Keep the stored name: store the field as ${JSON.stringify(fromStored)} (with @map(${JSON.stringify(fromStored)}) in PSL), then run this command again without this statement.`,
    );
  }
  const policyRefusal = controlPolicyRefusal(statement, label, input.contract, collection);
  if (policyRefusal !== undefined) return policyRefusal;
  const variant = variantFilter(input.fromContract, statement.from);
  const renamedTogether = new Set(
    input.statements.flatMap((other) =>
      other.entity === 'field' &&
      other.from.namespaceId === statement.from.namespaceId &&
      storedFieldNameAt(input.fromContract, other.from) === fromStored &&
      storedFieldNameAt(input.contract, other.to) === toStored
        ? [other.from.model]
        : [],
    ),
  );
  const others = otherModelsReached(
    input.fromContract,
    statement.from,
    originCollection,
    variant,
    fromStored,
  ).filter((name) => !renamedTogether.has(name));
  if (others.length > 0) {
    return refuse(
      `model ${others.map((name) => JSON.stringify(name)).join(', ')} stores field ${JSON.stringify(fromStored)} in the same collection, ${JSON.stringify(collection)}`,
      `${sharedCollectionWhy(collection, others, 'renaming the field would rename it in the documents')} To change it, ${SEPARATE_THE_MODELS}.`,
    );
  }
  const filter = variant ?? rootDocumentsLosing(input.contract, statement.to, fromStored)?.filter;
  return {
    kind: 'renameField',
    call: new RenameFieldCall(collection, fromStored, toStored, filter),
  };
}

function collectionChangeAdvice(
  statement: ResolvedFieldRenameStatement,
  from: string,
  to: string,
): string {
  if (!sameModel(statement.from, statement.to)) {
    return `Add --rename ${modelDisplayName(statement.from)}:${modelDisplayName(statement.to)} before this statement, so the collection is renamed with its documents.`;
  }
  return `A statement cannot rename the collection of a model that keeps its name. Rename the collection in a step of its own first: change only @@map and emit the contract. ${renameCollectionByHandSteps(statement.from, from, to)} Then change the field and run this statement again.`;
}

function renameCollectionByHandSteps(model: ModelCoordinate, from: string, to: string): string {
  return `With db update, rename the collection in the database yourself, for example db.getCollection(${JSON.stringify(from)}).renameCollection(${JSON.stringify(to)}) in mongosh, then run db update. With migration plan, plan it, passing --delete ${modelDisplayName(model)} to answer its question; in its migration.ts make renameCollection(${JSON.stringify(from)}, ${JSON.stringify(to)}) the first operation, imported with the other operations, delete the drop of "${from}", and delete the create of "${to}" if there is one; run node on that migration.ts so it writes ops.json again; then apply it with prisma db migrate.`;
}

/**
 * How to keep the documents of a model that keeps its name while its collection changes from
 * `from` to `to`: no statement can rename that collection, so the user renames it by hand.
 */
export function keepCollectionByHandAdvice(
  model: ModelCoordinate,
  from: string,
  to: string,
): string {
  return `To keep its documents, rename collection "${from}" to "${to}" instead; a statement cannot rename the collection of a model that keeps its name. ${renameCollectionByHandSteps(model, from, to)}`;
}

export interface FieldRemoval {
  readonly call: UnsetFieldCall;
  readonly subject: MigrationSubject;
}

function modelCoordinates(contract: ContractWithDomain): readonly ModelCoordinate[] {
  return Object.entries(contract.domain?.namespaces ?? {}).flatMap(([namespaceId, namespace]) =>
    Object.keys(namespace.models).map((model) => ({
      namespaceId: asNamespaceId(namespaceId),
      model,
    })),
  );
}

function sameModel(a: ModelCoordinate, b: ModelCoordinate): boolean {
  return a.namespaceId === b.namespaceId && a.model === b.model;
}

/**
 * The destination model an origin model became: the one a statement renamed it to, else the one of
 * the same name, else the only one stored the same way (same collection, same variant value).
 */
function destinationModelOf(
  origin: ModelCoordinate,
  input: FieldRemovalInput,
): ModelCoordinate | undefined {
  const renamed = input.statements.find(
    (statement): statement is ResolvedModelRenameStatement =>
      statement.entity === 'model' && sameModel(statement.from, origin),
  );
  if (renamed !== undefined) return renamed.to;
  if (modelAt(input.contract, origin) !== undefined) return origin;
  const collection = input.collectionAfterRenames(collectionOf(input.fromContract, origin));
  const filter = JSON.stringify(variantFilter(input.fromContract, origin) ?? null);
  const stored = modelCoordinates(input.contract).filter(
    (candidate) =>
      collectionOf(input.contract, candidate) === collection &&
      JSON.stringify(variantFilter(input.contract, candidate) ?? null) === filter,
  );
  const [only] = stored;
  return stored.length === 1 ? only : undefined;
}

interface FieldRemovalInput {
  readonly statements: readonly ResolvedRenameStatement[];
  readonly fromContract: ContractWithDomain;
  readonly contract: MongoContract;
  readonly collectionAfterRenames: (collection: string) => string;
  readonly keptCollections: ReadonlySet<string>;
}

function renamedByStatement(input: FieldRemovalInput, field: FieldCoordinate): boolean {
  return input.statements.some(
    (statement) =>
      statement.entity === 'field' &&
      sameModel(statement.from, field) &&
      statement.from.field === field.field,
  );
}

/** Whether one of `model`'s own fields or embed relations is stored under `storedName`. */
function ownStores(model: ContractModel<MongoModelStorage>, storedName: string): boolean {
  return (
    hasOwnFieldStoredAs(model, storedName) ||
    Object.values(ownEmbedStoredNamesOf(model)).includes(storedName)
  );
}

/** The stored names of the documents of the model at `coordinate`: its fields and embed relations, its own and those it inherits. */
function storedFieldsOf(contract: ContractWithDomain, coordinate: ModelCoordinate): Set<string> {
  const models = mongoModelsOf(contract.domain, coordinate.namespaceId);
  return new Set(
    modelAndBasesOf(models, coordinate.model).flatMap((model) => [
      ...Object.values(ownStoredNamesOf(model)),
      ...Object.values(ownEmbedStoredNamesOf(model)),
    ]),
  );
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
): { readonly filter: Document | undefined } | undefined {
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
  if (discriminator === undefined || keeping.length === 0) return { filter: undefined };
  return { filter: { [ownStoredNameOf(model, discriminator)]: { $nin: keeping } } };
}

/**
 * Each field an origin model stores that its destination model no longer stores, in a collection
 * the plan keeps: removing it is data loss, carried out by unsetting it from the documents that
 * hold it, in a collection whose control policy is `managed`. A variant's field is unset only from that variant's documents, unless its destination
 * base now stores it. A base field is unset from the documents of every variant that does not now
 * store it itself.
 */
export function planFieldRemovals(input: FieldRemovalInput): readonly FieldRemoval[] {
  return modelCoordinates(input.fromContract).flatMap((origin) => {
    const collection = input.collectionAfterRenames(collectionOf(input.fromContract, origin));
    if (!input.keptCollections.has(collection)) return [];
    if (collectionControlPolicy(input.contract, collection) !== 'managed') return [];
    const destination = destinationModelOf(origin, input);
    if (destination === undefined) return [];
    const model = modelAt(input.fromContract, origin);
    if (model === undefined) return [];
    const variant = variantFilter(input.fromContract, origin);
    const losing = (storedName: string): { readonly filter: Document | undefined } | undefined => {
      if (variant !== undefined) {
        return storedFieldsOf(input.contract, destination).has(storedName)
          ? undefined
          : { filter: variant };
      }
      return rootDocumentsLosing(input.contract, destination, storedName);
    };
    return Object.entries(ownStoredNamesOf(model))
      .filter(
        ([field, storedName]) =>
          unrewritableFieldNameReason(storedName) === undefined &&
          !renamedByStatement(input, { ...origin, field }),
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
      }));
  });
}
