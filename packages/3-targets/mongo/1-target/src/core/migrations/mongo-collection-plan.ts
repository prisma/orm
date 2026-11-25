import type { Contract, ControlPolicy } from '@internal/contract/types';
import {
  canonicalizeSchemasForVerification,
  contractToMongoSchemaIR,
} from '@internal/family-mongo/control';
import type { MigrationPlannerConflict } from '@internal/framework-components/control';
import {
  canonicalize,
  indexLookupKey,
  type MongoContract,
  validatorDocumentShapesOf,
} from '@internal/mongo-contract';
import type {
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import { deepEqual, MongoSchemaCollection, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { ifDefined } from '@internal/utils/defined';
import { collectionHasOptions, writesCollectionCreate } from './mongo-collection-creates';
import { type CollectionControl, collectionControlOf } from './mongo-control-policy';
import type { OpFactoryCall } from './op-factory-call';
import {
  CollModCall,
  CreateCollectionCall,
  CreateIndexCall,
  DropCollectionCall,
  DropIndexCall,
  schemaCollectionToCreateCollectionOptions,
  schemaIndexToCreateIndexOptions,
} from './op-factory-call';

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

export interface CollectionDiff {
  readonly collCreates: readonly OpFactoryCall[];
  readonly drops: readonly OpFactoryCall[];
  readonly creates: readonly OpFactoryCall[];
  readonly validatorOps: readonly OpFactoryCall[];
  readonly mutableOptionOps: readonly OpFactoryCall[];
  readonly collDrops: readonly OpFactoryCall[];
  readonly conflicts: readonly MigrationPlannerConflict[];
}

export function callsOf(diff: CollectionDiff): readonly OpFactoryCall[] {
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
    if (destColl && writesCollectionCreate(destColl)) {
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

/** The schemas a plan compares one collection in: the origin, the destination in the form the diff pairs indexes in, and the destination as the contract writes it. */
export interface CollectionPlanSchemas {
  readonly origin: MongoSchemaIR;
  readonly destination: MongoSchemaIR;
  readonly writtenDestination: MongoSchemaIR;
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

/** The schemas a plan compares its collections in, from the schema it starts from and its destination contract. */
export function collectionPlanSchemasOf(
  origin: MongoSchemaIR,
  contract: MongoContract,
  fromDatabase: boolean,
): CollectionPlanSchemas {
  const writtenDestination = contractToMongoSchemaIR(contract);
  return { ...comparableIndexes(origin, writtenDestination, fromDatabase), writtenDestination };
}

/**
 * What a plan writes for one collection: its calls, or, when the collection's control policy
 * leaves its changes out of the plan, the calls it leaves out and that policy.
 */
export type CollectionPlan =
  | { readonly kind: 'planned'; readonly diff: CollectionDiff }
  | {
      readonly kind: 'leftOut';
      readonly calls: readonly OpFactoryCall[];
      readonly control: CollectionControl;
    };

export function collectionPlanOf(
  collection: string,
  schemas: CollectionPlanSchemas,
  contracts: { readonly contract: MongoContract; readonly fromContract: Contract | null },
): CollectionPlan {
  const origin = schemas.origin.collection(collection);
  const diff = planCollectionDiff(
    collection,
    origin,
    schemas.destination.collection(collection),
    schemas.writtenDestination.collection(collection),
  );
  const control = collectionControlOf(contracts.contract, contracts.fromContract, collection);
  return plansChangesTo(control.policy, origin !== undefined)
    ? { kind: 'planned', diff }
    : { kind: 'leftOut', calls: callsOf(diff), control };
}

/** The schema with collection `from` under the name `to`. */
export function renameInSchema(schema: MongoSchemaIR, from: string, to: string): MongoSchemaIR {
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
