import {
  asNamespaceId,
  type Contract,
  type ContractWithDomain,
  type ControlPolicy,
} from '@internal/contract/types';
import {
  canonicalizeSchemasForVerification,
  contractToMongoSchemaIR,
} from '@internal/family-mongo/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import {
  type MigrationDataLoss,
  type MigrationOperationPolicy,
  type MigrationPlanner,
  type MigrationPlannerConflict,
  type MigrationPlannerResult,
  type MigrationPlanWithAuthoringSurface,
  type MigrationScaffoldContext,
  type ModelCoordinate,
  modelDisplayName,
  type PlanOrigin,
  type ResolvedMigrationStatement,
  type ResolvedRenameStatement,
} from '@internal/framework-components/control';
import {
  canonicalize,
  collectionOfModel,
  embeddingModelOf,
  indexLookupKey,
  type MongoContract,
  mongoModelsOf,
  validatorDocumentShapesOf,
} from '@internal/mongo-contract';
import type {
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import { deepEqual, MongoSchemaCollection, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import { unrewritableFieldNameReason } from './migration-factories';
import {
  backfillTransform,
  convertTransform,
  type PlannedTransform,
} from './mongo-data-transforms';
import { documentsNotRewrittenWarnings } from './mongo-documents-not-rewritten';
import { planEnumValueRewrites } from './mongo-enum-value-planning';
import { planFieldFills } from './mongo-field-fills';
import {
  type DiscriminatorFilter,
  type OrderedRewrite,
  overlapRefusal,
  type RewriteFacts,
  variantDiscriminatorFilter,
} from './mongo-rewrite-overlaps';
import { type PlannedRewrite, rewriteRefusals } from './mongo-rewrite-refusals';
import {
  collectionControlOf,
  type FieldRemoval,
  keepCollectionByHandAdvice,
  leftBehindAdvice,
  leftBehindOf,
  leftBehindText,
  type ModelMatchInput,
  planFieldRemovals,
  planStatements,
  planValidatorFieldRemovals,
  type StatementCalls,
} from './mongo-statement-planning';
import { type CollectionRenames, renameRefused } from './mongo-storage-renames';
import { planStoredKeyFills } from './mongo-stored-key-fills';
import { planStoredKeyRewrites } from './mongo-stored-key-planning';
import { suppressedCallWarning } from './mongo-suppressed-calls';
import {
  castFieldCallOf,
  noCastRefusals,
  planFieldTypeChanges,
  planValidatorTypeChanges,
  type TypeChange,
  typeChangeConverted,
  unrewritableTypeChangeRefusals,
} from './mongo-type-changes';
import { mongoTypeLookupsOf } from './mongo-type-lookups';
import type { UnansweredChange } from './mongo-unanswered-changes';
import { planVariantDocumentRewrites, VARIANT_TWO_STEPS } from './mongo-variant-planning';
import type { OpFactoryCall } from './op-factory-call';
import {
  CollModCall,
  CreateCollectionCall,
  CreateIndexCall,
  DropCollectionCall,
  DropIndexCall,
  ReplaceStoredValueCall,
  schemaCollectionToCreateCollectionOptions,
  schemaIndexToCreateIndexOptions,
} from './op-factory-call';
import { PlannerProducedMongoMigration } from './planner-produced-migration';

function validatorsEqual(
  a: MongoSchemaValidator | undefined,
  b: MongoSchemaValidator | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.validationLevel === b.validationLevel &&
    a.validationAction === b.validationAction &&
    canonicalize(a.jsonSchema) === canonicalize(b.jsonSchema)
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Each field a root model or variant of the validator declares, with the distinct schemas they give it, in canonical form. */
function propertiesOf(schema: Record<string, unknown>): Record<string, string> {
  const schemas = new Map<string, Set<string>>();
  for (const shape of validatorDocumentShapesOf(schema)) {
    for (const [field, fieldSchema] of Object.entries(shape.properties)) {
      schemas.set(field, (schemas.get(field) ?? new Set()).add(canonicalize(fieldSchema)));
    }
  }
  return Object.fromEntries(
    [...schemas].map(([field, distinct]) => [field, [...distinct].sort().join('|')]),
  );
}

interface PropertyChanges {
  readonly changed: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

function propertyChanges(
  origin: Readonly<Record<string, unknown>>,
  dest: Readonly<Record<string, unknown>>,
): PropertyChanges {
  return {
    changed: Object.keys(dest).filter(
      (field) => Object.hasOwn(origin, field) && origin[field] !== dest[field],
    ),
    added: Object.keys(dest).filter((field) => !Object.hasOwn(origin, field)),
    removed: Object.keys(origin).filter((field) => !Object.hasOwn(dest, field)),
  };
}

/** The property changes of each kind of document both validators describe that the collection-wide changes do not name, each in the words of the documents it applies to. */
function shapeChanges(
  origin: MongoSchemaValidator,
  dest: MongoSchemaValidator,
  named: PropertyChanges,
): PropertyChanges {
  const canonical = (properties: Readonly<Record<string, unknown>>) =>
    Object.fromEntries(
      Object.entries(properties).map(([field, schema]) => [field, canonicalize(schema)]),
    );
  const shapesBefore = validatorDocumentShapesOf(origin.jsonSchema);
  const changes = validatorDocumentShapesOf(dest.jsonSchema).flatMap((shape) => {
    const before = shapesBefore.find(({ key }) => key === shape.key);
    if (before === undefined || shape.discriminator === undefined) return [];
    const { field, value } = shape.discriminator;
    const where = ` in documents whose ${field} is ${JSON.stringify(value)}`;
    const found = propertyChanges(canonical(before.properties), canonical(shape.properties));
    const unnamed = (kind: keyof PropertyChanges) =>
      found[kind].filter((each) => !named[kind].includes(each)).map((each) => `${each}${where}`);
    return [{ changed: unnamed('changed'), added: unnamed('added'), removed: unnamed('removed') }];
  });
  return {
    changed: changes.flatMap(({ changed }) => changed),
    added: changes.flatMap(({ added }) => added),
    removed: changes.flatMap(({ removed }) => removed),
  };
}

/**
 * A label naming the properties whose schema changed, so a dry run shows what a validator update does: `Update validator on items (changed: meta; added: note)`. A change of a variant's properties that the collection's properties as a whole do not show names the variant's documents.
 */
function validatorUpdateLabel(
  collName: string,
  origin: MongoSchemaValidator,
  dest: MongoSchemaValidator,
): string {
  const whole = propertyChanges(propertiesOf(origin.jsonSchema), propertiesOf(dest.jsonSchema));
  const ofVariants = shapeChanges(origin, dest, whole);
  const changed = [...whole.changed, ...ofVariants.changed];
  const added = [...whole.added, ...ofVariants.added];
  const removed = [...whole.removed, ...ofVariants.removed];
  const parts = [
    ...(changed.length > 0 ? [`changed: ${changed.join(', ')}`] : []),
    ...(added.length > 0 ? [`added: ${added.join(', ')}`] : []),
    ...(removed.length > 0 ? [`removed: ${removed.join(', ')}`] : []),
  ];
  return parts.length === 0
    ? `Update validator on ${collName}`
    : `Update validator on ${collName} (${parts.join('; ')})`;
}

/**
 * The keys of an option MongoDB fills in when a collection is created without them, each with a
 * test for the value it fills in. `listCollections` reports a time-series collection's granularity
 * as "seconds" and its bucketMaxSpanSeconds when they were not given, and bucketRoundingSeconds only
 * for custom bucketing, which a contract cannot state; and a clustered index's v, key and unique, and
 * its name as "_id_".
 */
const SERVER_FILLED: Readonly<
  Record<'timeseries' | 'clusteredIndex', Readonly<Record<string, (value: unknown) => boolean>>>
> = {
  timeseries: {
    granularity: (value) => value === 'seconds',
    bucketMaxSpanSeconds: () => true,
    bucketRoundingSeconds: () => true,
  },
  clusteredIndex: {
    v: () => true,
    key: () => true,
    unique: () => true,
    name: (value) => value === '_id_',
  },
};

/** The origin's value of an option without the keys the server filled in and the destination leaves out. */
function withoutServerFilled(
  option: keyof typeof SERVER_FILLED,
  origin: unknown,
  dest: unknown,
): unknown {
  if (!isPlainObject(origin)) return origin;
  const filled = SERVER_FILLED[option];
  return Object.fromEntries(
    Object.entries(origin).filter(
      ([key, value]) => (isPlainObject(dest) && Object.hasOwn(dest, key)) || !filled[key]?.(value),
    ),
  );
}

function hasImmutableOptionChange(
  origin: MongoSchemaCollectionOptions | undefined,
  dest: MongoSchemaCollectionOptions | undefined,
): string | undefined {
  if (canonicalize(origin?.capped) !== canonicalize(dest?.capped)) return 'capped';
  if (
    canonicalize(withoutServerFilled('timeseries', origin?.timeseries, dest?.timeseries)) !==
    canonicalize(dest?.timeseries)
  )
    return 'timeseries';
  if (canonicalize(origin?.collation) !== canonicalize(dest?.collation)) return 'collation';
  if (
    canonicalize(
      withoutServerFilled('clusteredIndex', origin?.clusteredIndex, dest?.clusteredIndex),
    ) !== canonicalize(dest?.clusteredIndex)
  )
    return 'clusteredIndex';
  return undefined;
}

function collectionHasOptions(coll: MongoSchemaCollection): boolean {
  return !!(coll.options || coll.validator);
}

export type PlanCallsResult =
  | {
      readonly kind: 'success';
      readonly calls: OpFactoryCall[];
      /** One for each change a collection's control policy left out of the plan. */
      readonly warnings: readonly MigrationPlannerConflict[];
    }
  | { readonly kind: 'failure'; readonly conflicts: MigrationPlannerConflict[] };

/**
 * The models of `fromContract` whose documents a drop of `collection` loses, sorted by name: its
 * root models, which variants stored there belong to, else the variants that store their documents
 * there themselves.
 */
function modelsStoredIn(
  fromContract: ContractWithDomain,
  collection: string,
): readonly ModelCoordinate[] {
  const storing = Object.entries(fromContract.domain.namespaces).flatMap(
    ([namespaceId, namespace]) =>
      Object.entries(namespace.models).flatMap(([model, definition]) => {
        const coordinate = { namespaceId: asNamespaceId(namespaceId), model };
        return embeddingModelOf(fromContract.domain, coordinate) === undefined &&
          collectionOfModel(fromContract.domain, coordinate) === collection
          ? [{ coordinate, isRoot: definition.base === undefined }]
          : [];
      }),
  );
  const roots = storing.filter(({ isRoot }) => isRoot);
  return (roots.length > 0 ? roots : storing)
    .map(({ coordinate }) => coordinate)
    .sort((a, b) => modelDisplayName(a).localeCompare(modelDisplayName(b)));
}

/**
 * Each collection drop of the plan, with every model whose documents it loses. When such a model
 * keeps its name and the plan brings its new collection into existence, its question says why the
 * plan does not rename the collection: the models stored there are being split or merged, which is
 * a data migration, or its control policy is not `managed` in both contracts, and then how to
 * rename it by hand.
 */
function collectionDrops(
  calls: readonly OpFactoryCall[],
  fromContract: ContractWithDomain | null,
  contract: ContractWithDomain,
  renames: CollectionRenames,
  collections: { readonly origin: MongoSchemaIR; readonly destination: MongoSchemaIR },
): readonly MigrationDataLoss[] {
  const created = (collection: string) =>
    collections.origin.collection(collection) === undefined &&
    collections.destination.collection(collection) !== undefined;
  const adviceFor = (model: ModelCoordinate, dropped: string): string | undefined => {
    const destinationCollection = modelStoredInDestination(contract, model);
    if (destinationCollection === undefined || !created(destinationCollection)) return undefined;
    const change = { from: dropped, to: destinationCollection };
    const shared = renames.sharedCollection(change);
    if (shared !== undefined) return renames.sharedStorageAdvice(change, shared);
    return renames.managedOnBothSides(change)
      ? undefined
      : keepCollectionByHandAdvice(model, dropped, destinationCollection);
  };
  return calls.flatMap((call, operationIndex): readonly MigrationDataLoss[] => {
    if (!(call instanceof DropCollectionCall)) return [];
    const lost = { operationIndex, loss: 'drop', label: call.label } as const;
    const models = fromContract === null ? [] : modelsStoredIn(fromContract, call.collection);
    if (models.length === 0) {
      return [{ ...lost, subject: { kind: 'storage', name: call.collection } }];
    }
    return models.map((model) => ({
      ...lost,
      subject: { kind: 'model', ...model },
      ...ifDefined('keepDataAdvice', adviceFor(model, call.collection)),
    }));
  });
}

/**
 * A question about each origin root model that moves out of a shared collection, on the operation
 * that gives it its new storage: the create of its new collection, else that collection's validator
 * change. With neither, the plan is refused, since there is no operation to ask on.
 */
function leftBehindLosses(
  calls: readonly OpFactoryCall[],
  match: ModelMatchInput | undefined,
): Result<readonly MigrationDataLoss[], readonly MigrationPlannerConflict[]> {
  const losses: MigrationDataLoss[] = [];
  const conflicts: MigrationPlannerConflict[] = [];
  for (const left of match === undefined ? [] : leftBehindOf(match)) {
    const operationIndex = [
      calls.findIndex(
        (call) => call instanceof CreateCollectionCall && call.collection === left.to,
      ),
      calls.findIndex((call) => call instanceof CollModCall && call.collection === left.to),
    ].find((index) => index !== -1);
    const call = operationIndex === undefined ? undefined : calls[operationIndex];
    if (operationIndex === undefined || call === undefined) {
      conflicts.push(
        renameRefused(
          undefined,
          `Cannot move model "${modelDisplayName(left.model)}" out of collection "${left.collection}": no discriminator tells its documents apart from those of the other models stored there`,
          `${leftBehindText(left)} The plan has no operation that gives the model its new storage to ask about this on. Keep the model in collection "${left.collection}", or move its documents with a hand-written migration first, and plan again.`,
        ),
      );
      continue;
    }
    losses.push({
      operationIndex,
      subject: { kind: 'model', ...left.model },
      loss: 'drop',
      label: call.label,
      keepDataAdvice: leftBehindAdvice(left),
    });
  }
  return conflicts.length > 0 ? notOk(conflicts) : ok(losses);
}

/** The collection the destination stores `model` in, when the destination still has that model. */
function modelStoredInDestination(
  contract: ContractWithDomain,
  model: ModelCoordinate,
): string | undefined {
  const namespace = contract.domain.namespaces[model.namespaceId];
  return namespace !== undefined && Object.hasOwn(namespace.models, model.model)
    ? collectionOfModel(contract.domain, model)
    : undefined;
}

interface CollectionDiff {
  readonly collCreates: readonly OpFactoryCall[];
  readonly drops: readonly OpFactoryCall[];
  readonly creates: readonly OpFactoryCall[];
  readonly validatorOps: readonly OpFactoryCall[];
  readonly mutableOptionOps: readonly OpFactoryCall[];
  readonly collDrops: readonly OpFactoryCall[];
  readonly conflicts: readonly MigrationPlannerConflict[];
}

function callsOf(diff: CollectionDiff): readonly OpFactoryCall[] {
  return [
    ...diff.collCreates,
    ...diff.drops,
    ...diff.creates,
    ...diff.validatorOps,
    ...diff.mutableOptionOps,
    ...diff.collDrops,
  ];
}

/**
 * The calls for one collection. Indexes are paired in `originColl` and `destColl`, which may hold indexes in the form the verifier compares; each create is built from the contract's index as written, in `writtenDestColl`.
 */
function planCollectionDiff(
  collName: string,
  originColl: MongoSchemaCollection | undefined,
  destColl: MongoSchemaCollection | undefined,
  writtenDestColl: MongoSchemaCollection | undefined,
): CollectionDiff {
  const collCreates: OpFactoryCall[] = [];
  const drops: OpFactoryCall[] = [];
  const creates: OpFactoryCall[] = [];
  const validatorOps: OpFactoryCall[] = [];
  const mutableOptionOps: OpFactoryCall[] = [];
  const collDrops: OpFactoryCall[] = [];
  const conflicts: MigrationPlannerConflict[] = [];

  if (!originColl) {
    // Provision contract-declared collections that are absent from
    // the live database. MongoDB lazily materialises a collection
    // on first write, so subsequent `createIndex` calls in the same
    // plan would create the collection for us implicitly — but the
    // schema verifier treats an unmaterialised contract collection
    // as a `missing_table` issue, so a plan that lacks both options
    // and indexes (e.g. a plain `users` collection from the init
    // scaffold) ends up provisioning nothing and failing verify.
    // The planner therefore emits an explicit createCollection for
    // any contract collection that has options/validator OR no
    // indexes to ride along on. Collections that have indexes
    // continue to rely on createIndex for materialisation, keeping
    // existing plans byte-stable.
    if (destColl && (collectionHasOptions(destColl) || destColl.indexes.length === 0)) {
      const opts = collectionHasOptions(destColl)
        ? schemaCollectionToCreateCollectionOptions(destColl)
        : undefined;
      collCreates.push(new CreateCollectionCall(collName, opts));
    }
  } else if (!destColl) {
    collDrops.push(new DropCollectionCall(collName));
  } else {
    const immutableChange = hasImmutableOptionChange(originColl.options, destColl.options);
    if (immutableChange) {
      conflicts.push({
        kind: 'policy-violation',
        summary: `Cannot change immutable collection option '${immutableChange}' on ${collName}`,
        why: `MongoDB does not support modifying the '${immutableChange}' option after collection creation`,
      });
    }

    const mutableCall = planMutableOptionsDiffCall(collName, originColl.options, destColl.options);
    if (mutableCall) mutableOptionOps.push(mutableCall);

    const validatorCall = planValidatorDiffCall(collName, originColl.validator, destColl.validator);
    if (validatorCall) validatorOps.push(validatorCall);
  }

  const originLookup = new Map<string, MongoSchemaIndex>();
  if (originColl) {
    for (const idx of originColl.indexes) {
      originLookup.set(indexLookupKey(idx), idx);
    }
  }

  const destLookup = new Map<string, MongoSchemaIndex>();
  if (destColl) {
    for (const idx of destColl.indexes) {
      destLookup.set(indexLookupKey(idx), idx);
    }
  }

  for (const [lookupKey, idx] of originLookup) {
    if (destLookup.get(lookupKey)?.name !== idx.name) {
      drops.push(new DropIndexCall(collName, idx.keys, schemaIndexToCreateIndexOptions(idx)));
    }
  }

  for (const [lookupKey, idx] of destLookup) {
    if (originLookup.get(lookupKey)?.name !== idx.name) {
      const asWritten =
        writtenDestColl?.indexes.find((written) => written.name === idx.name) ?? idx;
      creates.push(
        new CreateIndexCall(collName, asWritten.keys, schemaIndexToCreateIndexOptions(asWritten)),
      );
    }
  }
  return { collCreates, drops, creates, validatorOps, mutableOptionOps, collDrops, conflicts };
}

function withIndexesOf(schema: MongoSchemaIR, indexesFrom: MongoSchemaIR): MongoSchemaIR {
  return new MongoSchemaIR(
    schema.collections.map(
      (collection) =>
        new MongoSchemaCollection({
          name: collection.name,
          indexes: indexesFrom.collection(collection.name)?.indexes ?? collection.indexes,
          ...ifDefined('validator', collection.validator),
          ...ifDefined('options', collection.options),
        }),
    ),
    { fromDatabase: schema.fromDatabase },
  );
}

/**
 * The origin and destination with indexes the planner can pair by content. A database reports a text index's keys as `_fts` and `_ftsx` and fills in its weights and languages and a collation's unwritten fields, so the indexes of a database origin are compared as the verifier compares them. A contract origin is compared exactly.
 */
function comparableIndexes(
  origin: MongoSchemaIR,
  destination: MongoSchemaIR,
  fromDatabase: boolean,
): { readonly origin: MongoSchemaIR; readonly destination: MongoSchemaIR } {
  if (!fromDatabase) return { origin, destination };
  const canonical = canonicalizeSchemasForVerification(origin, destination);
  return {
    origin: withIndexesOf(origin, canonical.live),
    destination: withIndexesOf(destination, canonical.expected),
  };
}

export class MongoMigrationPlanner implements MigrationPlanner<'mongo', 'mongo'> {
  planCalls(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', 'mongo'>>;
    /** The contract the planner reads as the starting state, or `null` when it has none. */
    readonly fromContract: Contract | null;
    /** What the statements and removed fields plan; its `schema` is diffed in place of `schema`. */
    readonly statementCalls?: StatementCalls;
  }): PlanCallsResult {
    const contract = blindCast<
      MongoContract,
      'framework planner passes the Mongo contract selected for the mongo target'
    >(options.contract);
    const schema = blindCast<
      MongoSchemaIR,
      'framework planner passes the inspected Mongo schema IR selected for the mongo target'
    >(options.schema);
    const writtenDestinationIR = contractToMongoSchemaIR(contract);
    const { origin: originIR, destination: destinationIR } = comparableIndexes(
      options.statementCalls?.schema ?? schema,
      writtenDestinationIR,
      schema.fromDatabase,
    );

    const collCreates: OpFactoryCall[] = [];
    const drops: OpFactoryCall[] = [];
    const creates: OpFactoryCall[] = [];
    const validatorOps: OpFactoryCall[] = [];
    const mutableOptionOps: OpFactoryCall[] = [];
    const collDrops: OpFactoryCall[] = [];
    const conflicts: MigrationPlannerConflict[] = [];
    const warnings: MigrationPlannerConflict[] = [];

    const allCollectionNames = new Set([
      ...originIR.collectionNames,
      ...destinationIR.collectionNames,
    ]);

    for (const collName of [...allCollectionNames].sort()) {
      const originColl = originIR.collection(collName);
      const planned = planCollectionDiff(
        collName,
        originColl,
        destinationIR.collection(collName),
        writtenDestinationIR.collection(collName),
      );
      const control = collectionControlOf(contract, options.fromContract, collName);
      if (!plansChangesTo(control.policy, originColl !== undefined)) {
        warnings.push(
          ...callsOf(planned).map((call) => suppressedCallWarning(call, collName, control)),
        );
        continue;
      }
      collCreates.push(...planned.collCreates);
      drops.push(...planned.drops);
      creates.push(...planned.creates);
      validatorOps.push(...planned.validatorOps);
      mutableOptionOps.push(...planned.mutableOptionOps);
      collDrops.push(...planned.collDrops);
      conflicts.push(...planned.conflicts);
    }

    if (conflicts.length > 0) {
      return { kind: 'failure', conflicts };
    }

    const allCalls = [
      ...(options.statementCalls?.collectionRenames ?? []),
      ...collCreates,
      ...drops,
      ...(options.statementCalls?.rewrites ?? []),
      ...creates,
      ...validatorOps,
      ...mutableOptionOps,
      ...collDrops,
    ];

    for (const call of allCalls) {
      if (!options.policy.allowedOperationClasses.includes(call.operationClass)) {
        conflicts.push({
          kind: 'policy-violation',
          summary: `${call.operationClass} operation disallowed: ${call.label}`,
          why: `Policy does not allow '${call.operationClass}' operations`,
          refusedOperationClass: call.operationClass,
        });
      }
    }

    if (conflicts.length > 0) {
      return { kind: 'failure', conflicts };
    }

    return { kind: 'success', calls: allCalls, warnings };
  }

  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    /** The contract the planner reads as the starting state, or `null` when it has none. */
    readonly fromContract: Contract | null;
    /** The origin the produced plan asserts: its `describe().from` and `origin`. */
    readonly origin: PlanOrigin | null;
    /** The `--rename` statements, resolved. */
    readonly statements: readonly ResolvedMigrationStatement[];
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', 'mongo'>>;
    /**
     * POSIX-relative path from the migration package dir to
     * `migrations/snapshots`, e.g. `'../../snapshots'`. Threaded straight
     * into the produced plan's `renderTypeScript()` metadata.
     */
    readonly snapshotsImportPath: string;
  }): MigrationPlannerResult {
    const contract = blindCast<
      MongoContract,
      'framework planner passes the Mongo contract selected for the mongo target'
    >(options.contract);
    const originIR = blindCast<
      MongoSchemaIR,
      'framework planner passes the inspected Mongo schema IR selected for the mongo target'
    >(options.schema);
    const fromContract = options.fromContract;
    const renames = options.statements.filter(
      (statement): statement is ResolvedRenameStatement => statement.kind === 'rename',
    );
    const statementPlan = planStatements({
      statements: renames,
      fromContract,
      contract,
      schema: originIR,
    });
    if (!statementPlan.ok) return { kind: 'failure', conflicts: statementPlan.failure };
    const {
      schema,
      collectionRenames,
      fieldRenameCalls,
      fieldRenames,
      callOfStatement,
      models,
      collections,
      renamedCollections,
    } = statementPlan.value;
    const destinationIR = contractToMongoSchemaIR(contract);
    const storedKeys = planStoredKeyRewrites({
      statements: renames,
      fromContract,
      contract,
      schema,
      destination: destinationIR,
    });
    if (!storedKeys.ok) return { kind: 'failure', conflicts: [...storedKeys.failure] };
    const storedKeyRewrites = [...storedKeys.value.renames, ...storedKeys.value.removals];
    const enumValues = planEnumValueRewrites({
      statements: renames,
      fromContract,
      contract,
      schema,
      lookups: mongoTypeLookupsOf(options.frameworkComponents),
    });
    if (!enumValues.ok) return { kind: 'failure', conflicts: [...enumValues.failure] };
    const { replacements: valueReplacements, removals: valueRemovals } = enumValues.value;
    const renamedTo = renamedCollections;
    const match: ModelMatchInput | undefined =
      fromContract === null
        ? undefined
        : {
            statements: renames,
            models,
            fieldRenames,
            fromContract,
            contract,
            collectionAfterRenames: (collection) => renamedTo.get(collection) ?? collection,
          };
    const lookups = mongoTypeLookupsOf(options.frameworkComponents);
    const plannedFills = planFieldFills({
      match,
      contract,
      lookups,
      schema,
      destination: destinationIR,
      statements: options.statements,
    });
    if (!plannedFills.ok) return { kind: 'failure', conflicts: [...plannedFills.failure] };
    const fills = plannedFills.value;
    const variants = planVariantDocumentRewrites({
      statements: options.statements,
      fromContract,
      contract,
      schema,
      keptCollections: new Set(
        schema.collectionNames.filter((name) => destinationIR.collection(name) !== undefined),
      ),
      collectionAfterRenames: (collection) => renamedTo.get(collection) ?? collection,
      models,
      enumReplacements: valueReplacements.flatMap(({ call }) =>
        call instanceof ReplaceStoredValueCall ? [call] : [],
      ),
      fieldRenames,
      fieldRenameCalls: fieldRenameCalls.map(({ call }) => call),
    });
    if (!variants.ok) return { kind: 'failure', conflicts: [...variants.failure] };
    const { deletes: variantDeletes, replacements: variantReplacements } = variants.value;
    const variantCalls = new Set<OpFactoryCall>(variantReplacements.map(({ call }) => call));
    const removals: readonly FieldRemoval[] =
      fromContract === null
        ? planValidatorFieldRemovals({ origin: schema, destination: destinationIR, contract })
        : planFieldRemovals({
            statements: renames,
            models,
            fieldRenames,
            fromContract,
            contract,
            collectionAfterRenames: (collection) => renamedTo.get(collection) ?? collection,
            keptCollections: new Set(
              schema.collectionNames.filter((name) => destinationIR.collection(name) !== undefined),
            ),
          });
    const typeChanges: readonly TypeChange[] =
      fromContract === null
        ? planValidatorTypeChanges({ origin: schema, destination: destinationIR, contract })
        : planFieldTypeChanges(
            {
              statements: renames,
              models,
              fieldRenames,
              fromContract,
              contract,
              collectionAfterRenames: (collection) => renamedTo.get(collection) ?? collection,
              keptCollections: new Set(
                schema.collectionNames.filter(
                  (name) => destinationIR.collection(name) !== undefined,
                ),
              ),
            },
            lookups,
          );
    const contracts = { fromContract: fromContract ?? contract, contract };
    const converted: TypeChange[] = [];
    const transforms = options.statements.flatMap((statement): PlannedTransform[] => {
      if (statement.kind === 'convert' && statement.entity === 'field') {
        const change = typeChangeConverted(statement, typeChanges);
        if (change !== undefined) converted.push(change);
        return [{ statement, outcome: convertTransform(statement, change, contracts) }];
      }
      if (
        statement.kind === 'backfill' &&
        statement.entity === 'field' &&
        embeddingModelOf(contract.domain, statement.field) === undefined
      ) {
        return [
          {
            statement,
            outcome: backfillTransform(statement, { contract, schema, match }),
          },
        ];
      }
      return [];
    });
    const unconverted = typeChanges.filter((change) => !converted.includes(change));
    const rewritable = unconverted.filter(
      (change) => unrewritableFieldNameReason(change.field) === undefined,
    );
    const casts = rewritable.flatMap((change) => {
      const call = castFieldCallOf(change);
      return call === undefined ? [] : [{ ...change, call }];
    });
    const storedKeyFills = planStoredKeyFills({
      statements: options.statements,
      fromContract,
      contract,
      lookups,
      schema,
      destination: destinationIR,
    });
    if (!storedKeyFills.ok) return { kind: 'failure', conflicts: [...storedKeyFills.failure] };
    const rewrites: readonly PlannedRewrite[] = [
      ...removals.map(
        ({ call, destination, variant }): PlannedRewrite => ({
          kind: 'removal',
          collection: call.collection,
          field: call.field,
          variant,
          model: destination,
          storedKey: undefined,
          keepAdvice: 'keep the field in the contract',
          renameStatement: undefined,
        }),
      ),
      ...casts.map(
        (change): PlannedRewrite => ({
          kind: 'cast',
          collection: change.collection,
          field: change.field,
          variant: change.variant,
          model: change.destination,
          storedKey: undefined,
          keepAdvice: "keep the field's type in the contract",
          renameStatement: undefined,
        }),
      ),
      ...transforms.flatMap(({ outcome }) =>
        outcome.kind === 'transform' ? [outcome.rewrite] : [],
      ),
      ...fills.map(
        ({ call, subject, variant }): PlannedRewrite => ({
          kind: 'fill',
          collection: call.options.collection,
          field: call.options.field,
          variant,
          model: subject.kind === 'field' ? subject : undefined,
          storedKey: undefined,
          keepAdvice: 'make the field optional in the contract',
          renameStatement: undefined,
        }),
      ),
    ];
    const refusals = [
      ...transforms.flatMap(({ outcome }) =>
        outcome.kind === 'refused' ? [outcome.conflict] : [],
      ),
      ...unrewritableTypeChangeRefusals(unconverted, contract),
      ...noCastRefusals(rewritable, contract),
      ...rewrites.flatMap((rewrite) =>
        rewriteRefusals(rewrite, contract, {
          timeSeries: schema.collection(rewrite.collection)?.options?.timeseries !== undefined,
          validator: schema.collection(rewrite.collection)?.validator?.jsonSchema,
        }),
      ),
    ];
    if (refusals.length > 0) return { kind: 'failure', conflicts: refusals };
    const callsOf = new Map<ResolvedMigrationStatement, readonly OpFactoryCall[]>([
      ...renames.map((statement, index) => {
        const call = callOfStatement[index];
        const keyCalls = [
          ...storedKeyRewrites,
          ...variantReplacements,
          ...valueReplacements,
        ].flatMap((rewrite) => (rewrite.statement === statement ? [rewrite.call] : []));
        return [statement, call === undefined ? keyCalls : [call, ...keyCalls]] as const;
      }),
      ...transforms.map(({ statement, outcome }) =>
        outcome.kind === 'transform'
          ? ([statement, [outcome.call]] as const)
          : ([statement, []] as const),
      ),
      ...variantReplacements.flatMap((rewrite) =>
        rewrite.statement?.kind === 'convert' ? [[rewrite.statement, [rewrite.call]] as const] : [],
      ),
      ...options.statements.flatMap((statement) => {
        const calls = storedKeyFills.value.flatMap((fill) =>
          fill.statement === statement ? [fill.call] : [],
        );
        return calls.length === 0 ? [] : [[statement, calls] as const];
      }),
    ]);
    const twoMigrationsAdvice = new Map<OpFactoryCall, string>([
      ...[...valueReplacements, ...valueRemovals].map(
        (rewrite) => [rewrite.call, rewrite.twoMigrationsAdvice] as const,
      ),
      ...[...variantDeletes, ...variantReplacements].map(
        (rewrite) => [rewrite.call, VARIANT_TWO_STEPS] as const,
      ),
    ]);
    const changeOfCall = new Map<OpFactoryCall, UnansweredChange>([
      ...removals.map(({ call, subject }) => [call, { kind: 'removed', subject }] as const),
      ...variantDeletes.map(
        ({ call, model }) =>
          [call, { kind: 'removed', subject: { kind: 'model', ...model } }] as const,
      ),
      ...storedKeys.value.removals.map(
        ({ call, subject }) => [call, { kind: 'removed', subject }] as const,
      ),
      ...valueRemovals.map(
        ({ call, enumValue }) =>
          [call, { kind: 'removed', subject: { kind: 'enumValue', ...enumValue } }] as const,
      ),
      ...fills.map(({ call, subject }) => [call, { kind: 'newRequired', subject }] as const),
      ...storedKeyFills.value.flatMap(({ call, subject, text }) =>
        text === undefined ? [] : [[call, { kind: 'newRequired', subject }] as const],
      ),
    ]);
    const rewriteOf = (facts: RewriteFacts): OrderedRewrite => {
      const statements = options.statements.filter((statement) =>
        (callsOf.get(statement) ?? []).includes(facts.call),
      );
      return {
        ...facts,
        statements,
        twoMigrationsAdvice: twoMigrationsAdvice.get(facts.call),
        unanswered: statements.length === 0 ? changeOfCall.get(facts.call) : undefined,
      };
    };
    const writesDiscriminator = ({ statement }: PlannedTransform) => {
      const { namespaceId, model, field } = statement.field;
      return mongoModelsOf(contract.domain, namespaceId)[model]?.discriminator?.field === field;
    };
    const transformRewrites = (
      kind: 'convert' | 'backfill',
      selected: (transform: PlannedTransform) => boolean = () => true,
    ) =>
      transforms.filter(selected).flatMap(({ statement, outcome }) =>
        statement.kind === kind && outcome.kind === 'transform'
          ? [
              rewriteOf({
                kind: 'dataTransform',
                call: outcome.call,
                transformedField: outcome.rewrite.field,
                discriminatorFilter: variantDiscriminatorFilter(outcome.rewrite.variant),
              }),
            ]
          : [],
      );
    const fieldRenamesSelecting = (kind: DiscriminatorFilter['kind'] | undefined) =>
      fieldRenameCalls.flatMap(({ call, discriminatorFilter }) =>
        discriminatorFilter?.kind === kind
          ? [rewriteOf({ kind: 'renameField', call, discriminatorFilter })]
          : [],
      );
    const orderedRewrites = [
      ...fieldRenamesSelecting('variant'),
      ...fieldRenamesSelecting(undefined),
      ...variantDeletes.map(({ call, field, from }) =>
        rewriteOf({ kind: 'deleteDocuments', call, deletedVariant: { field, value: from } }),
      ),
      ...variantReplacements.map(({ call, to }) =>
        rewriteOf({
          kind: 'replaceStoredValue',
          call,
          writtenValue:
            valueReplacements.find((replacement) => replacement.call === call)?.writtenValue ?? to,
          discriminatorFilter: undefined,
        }),
      ),
      ...fieldRenamesSelecting('noneOf'),
      ...storedKeys.value.renames.map(({ call, variant }) =>
        rewriteOf({
          kind: 'renameStoredKey',
          call,
          discriminatorFilter: variantDiscriminatorFilter(variant),
        }),
      ),
      ...valueReplacements.flatMap(({ call, writtenValue, variant }) =>
        variantCalls.has(call)
          ? []
          : [
              rewriteOf({
                kind: 'replaceStoredValue',
                call,
                writtenValue,
                discriminatorFilter: variantDiscriminatorFilter(variant),
              }),
            ],
      ),
      ...transformRewrites('backfill', writesDiscriminator),
      ...casts.map(({ call, variant }) =>
        rewriteOf({
          kind: 'castField',
          call,
          discriminatorFilter: variantDiscriminatorFilter(variant),
        }),
      ),
      ...transformRewrites('convert'),
      ...fills.map(({ call, variant }) =>
        rewriteOf({
          kind: 'fillField',
          call,
          discriminatorFilter: variantDiscriminatorFilter(variant),
        }),
      ),
      ...storedKeyFills.value.map(({ call, variant }) =>
        rewriteOf({
          kind: 'fillStoredKey',
          call,
          discriminatorFilter: variantDiscriminatorFilter(variant),
        }),
      ),
      ...transformRewrites('backfill', (transform) => !writesDiscriminator(transform)),
      ...removals.map(({ call, discriminatorFilter }) =>
        rewriteOf({ kind: 'unsetField', call, discriminatorFilter }),
      ),
      ...storedKeys.value.removals.map(({ call, variant }) =>
        rewriteOf({
          kind: 'removeStoredKey',
          call,
          discriminatorFilter: variantDiscriminatorFilter(variant),
        }),
      ),
      ...valueRemovals.map(({ call, variant }) =>
        rewriteOf({
          kind: 'removeStoredValue',
          call,
          discriminatorFilter: variantDiscriminatorFilter(variant),
        }),
      ),
    ];
    const overlap = overlapRefusal(orderedRewrites, {
      ...contracts,
      statements: options.statements,
      fieldRenames,
    });
    if (overlap !== undefined) return { kind: 'failure', conflicts: [overlap] };
    const result = this.planCalls({
      ...options,
      statementCalls: {
        schema,
        collectionRenames,
        rewrites: orderedRewrites.map(({ call }) => call),
      },
    });
    if (result.kind === 'failure') return result;
    const { calls, warnings } = result;
    const allWarnings = [
      ...warnings,
      ...storedKeys.value.warnings,
      ...(match === undefined ? [] : documentsNotRewrittenWarnings(match)),
    ];
    const fieldLoss: readonly MigrationDataLoss[] = [
      ...variantDeletes.map(
        (rewrite): MigrationDataLoss => ({
          operationIndex: calls.indexOf(rewrite.call),
          subject: { kind: 'model', ...rewrite.model },
          loss: 'drop',
          label: rewrite.call.label,
        }),
      ),
      ...removals.map((removal) => ({
        operationIndex: calls.indexOf(removal.call),
        subject: removal.subject,
        loss: 'drop' as const,
        label: removal.call.label,
      })),
      ...storedKeys.value.removals.map((removal) => ({
        operationIndex: calls.indexOf(removal.call),
        subject: removal.subject,
        loss: 'drop' as const,
        label: removal.call.label,
      })),
      ...valueRemovals.map(
        (removal): MigrationDataLoss => ({
          operationIndex: calls.indexOf(removal.call),
          subject: { kind: 'enumValue', ...removal.enumValue },
          loss: 'drop',
          label: removal.call.label,
        }),
      ),
      ...casts.flatMap(({ call, subject }): MigrationDataLoss[] =>
        call.operationClass !== 'destructive'
          ? []
          : [
              {
                operationIndex: calls.indexOf(call),
                subject,
                loss: 'typeChange',
                label: call.label,
              },
            ],
      ),
    ];
    const leftBehind = leftBehindLosses(calls, match);
    if (!leftBehind.ok) return { kind: 'failure', conflicts: [...leftBehind.failure] };
    return {
      kind: 'success',
      plan: new PlannerProducedMongoMigration(
        calls,
        {
          from: options.origin?.storageHash ?? null,
          to: contract.storage.storageHash,
        },
        options.snapshotsImportPath,
      ),
      appliedStatements: options.statements.map((statement) => ({
        statement,
        operationIndexes: (callsOf.get(statement) ?? []).map((call) => calls.indexOf(call)),
      })),
      dataLoss: [
        ...collectionDrops(calls, fromContract, contract, collections, {
          origin: schema,
          destination: destinationIR,
        }),
        ...leftBehind.value,
        ...fieldLoss,
      ].sort((a, b) => a.operationIndex - b.operationIndex),
      accessChanges: [],
      temporaryValues: [
        ...fills.map((fill) => ({
          operationIndex: calls.indexOf(fill.call),
          subject: fill.subject,
          value: fill.text,
        })),
        ...storedKeyFills.value.flatMap(({ call, subject, text }) =>
          text === undefined ? [] : [{ operationIndex: calls.indexOf(call), subject, value: text }],
        ),
      ],
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
    };
  }

  /**
   * Produce an empty `migration.ts` authoring surface for `migration new`.
   *
   * The "empty migration" is a `PlannerProducedMongoMigration` with no
   * operations; `renderTypeScript()` emits a stub class with the correct
   * `from`/`to` metadata that the user then fills in with operations. The
   * contract path on the context is unused — Mongo's emitted source does
   * not import from the generated contract `.d.ts`.
   */
  emptyMigration(context: MigrationScaffoldContext): MigrationPlanWithAuthoringSurface {
    return new PlannerProducedMongoMigration(
      [],
      {
        from: context.fromHash,
        to: context.toHash,
      },
      context.snapshotsImportPath,
    );
  }
}

function plansChangesTo(policy: ControlPolicy, collectionExists: boolean): boolean {
  switch (policy) {
    case 'managed':
      return true;
    case 'tolerated':
      return !collectionExists;
    case 'external':
    case 'observed':
      return false;
  }
}

function planValidatorDiffCall(
  collName: string,
  originValidator: MongoSchemaValidator | undefined,
  destValidator: MongoSchemaValidator | undefined,
): OpFactoryCall | undefined {
  if (validatorsEqual(originValidator, destValidator)) return undefined;

  if (destValidator) {
    return new CollModCall(
      collName,
      {
        validator: { $jsonSchema: destValidator.jsonSchema },
        validationLevel: destValidator.validationLevel,
        validationAction: destValidator.validationAction,
      },
      {
        id: `validator.${collName}.${originValidator ? 'update' : 'add'}`,
        label: originValidator
          ? validatorUpdateLabel(collName, originValidator, destValidator)
          : `Add validator on ${collName}`,
        operationClass: 'widening',
        checkDocuments: true,
      },
    );
  }

  return new CollModCall(
    collName,
    {
      validator: {},
      validationLevel: 'strict',
      validationAction: 'error',
    },
    {
      id: `validator.${collName}.remove`,
      label: `Remove validator on ${collName}`,
      operationClass: 'widening',
    },
  );
}

function planMutableOptionsDiffCall(
  collName: string,
  origin: MongoSchemaCollectionOptions | undefined,
  dest: MongoSchemaCollectionOptions | undefined,
): OpFactoryCall | undefined {
  const originCSPPI = origin?.changeStreamPreAndPostImages;
  const destCSPPI = dest?.changeStreamPreAndPostImages;
  if (deepEqual(originCSPPI, destCSPPI)) return undefined;

  const desiredCSPPI = destCSPPI ?? { enabled: false };
  return new CollModCall(
    collName,
    {
      changeStreamPreAndPostImages: desiredCSPPI,
    },
    {
      id: `options.${collName}.update`,
      label: `Update mutable options on ${collName}`,
      operationClass: 'widening',
    },
  );
}
