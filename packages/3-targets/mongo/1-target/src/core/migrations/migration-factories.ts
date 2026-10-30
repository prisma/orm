import { MONGO_INDEX_OPTION_KEYS, type MongoIndexOptionKey } from '@internal/mongo-contract';
import type {
  MongoDmlCheck,
  MongoDmlOperation,
  MongoFilterExpr,
  MongoIndexKey,
} from '@internal/mongo-query-ast/control';
import {
  buildIndexOpId,
  CollModCommand,
  type CollModOptions,
  type CreateCollectionOptions,
  type CreateIndexOptions,
  DropCollectionCommand,
  DropIndexCommand,
  defaultMongoIndexName,
  keysToKeySpec,
  ListCollectionsCommand,
  ListIndexesCommand,
  MongoAndExpr,
  MongoExistsExpr,
  MongoFieldFilter,
  type MongoMigrationPlanOperation,
  MongoNotExpr,
  RenameCollectionCommand,
} from '@internal/mongo-query-ast/control';
import {
  type MongoQueryPlan,
  RawAggregateCommand,
  RawUpdateManyCommand,
} from '@internal/mongo-query-ast/execution';
import { createFieldAccessor } from '@internal/mongo-query-builder';
import { collection } from '@internal/mongo-query-builder/contract-free';
import type { Document, MongoValue } from '@internal/mongo-value';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { mongoTargetError } from '../mongo-target-errors';
import type { CollModMeta } from './op-factory-call';

type StringField = { readonly codecId: 'mongo/string@1'; readonly nullable: false };
type DocField = { readonly codecId: 'mongo/document@1'; readonly nullable: false };

type IndexInfoDocShape = {
  readonly key: DocField;
  readonly name: StringField;
};

type CollectionInfoDocShape = {
  readonly name: StringField;
};

interface Buildable {
  build(): MongoQueryPlan;
}

function isBuildable(value: unknown): value is Buildable {
  if (typeof value !== 'object' || value === null || !('build' in value)) return false;
  return typeof Reflect.get(value, 'build') === 'function';
}

function resolveQuery(value: MongoQueryPlan | Buildable): MongoQueryPlan {
  return isBuildable(value) ? value.build() : value;
}

// Every MongoDB document carries `_id`, so `exists('_id')` is equivalent to
// "match all". The filter AST has no identity/always-true expression.
const MATCH_ALL_FILTER: MongoFilterExpr = MongoExistsExpr.exists('_id');

export function dataTransform(
  name: string,
  options: {
    /**
     * Optional opt-in routing identity. Presence opts the transform into
     * invariant-aware routing; absence means it is path-dependent and
     * not referenceable from refs.
     */
    invariantId?: string;
    check?: {
      source: () => MongoQueryPlan | Buildable;
      filter?: MongoFilterExpr;
      expect?: 'exists' | 'notExists';
      description?: string;
    };
    run: () => MongoQueryPlan | Buildable;
  },
): MongoDmlOperation {
  let precheck: readonly MongoDmlCheck[] = [];
  let postcheck: readonly MongoDmlCheck[] = [];

  if (options.check) {
    const source = resolveQuery(options.check.source());
    const filter = options.check.filter ?? MATCH_ALL_FILTER;
    const description = options.check.description ?? `Check for data transform: ${name}`;
    const precheckExpect = options.check.expect ?? 'exists';
    const postcheckExpect: 'exists' | 'notExists' =
      precheckExpect === 'exists' ? 'notExists' : 'exists';

    precheck = [{ description, source, filter, expect: precheckExpect }];
    postcheck = [{ description, source, filter, expect: postcheckExpect }];
  }

  const run: MongoQueryPlan[] = [resolveQuery(options.run())];

  return {
    id: `data_transform.${name}`,
    label: `Data transform: ${name}`,
    operationClass: 'data',
    name,
    ...ifDefined('invariantId', options.invariantId),
    precheck,
    run,
    postcheck,
  };
}

export interface FieldRewriteOptions {
  readonly filter?: Document;
}

const REWRITE_PLAN_META = { target: 'mongo', storageHash: '', lane: 'mongo-raw' } as const;

function documentsHolding(fields: readonly string[], filter: Document | undefined): Document {
  const conditions: Document[] = [
    ...(filter === undefined ? [] : [filter]),
    ...fields.map((field) => ({ [field]: { $exists: true } })),
  ];
  const [only] = conditions;
  return conditions.length === 1 && only !== undefined ? only : { $and: conditions };
}

const UNREWRITABLE_FIELD_NAMES: ReadonlyArray<{
  readonly matches: (field: string) => boolean;
  readonly reason: string;
}> = [
  { matches: (field) => field === '', reason: 'it is empty' },
  { matches: (field) => field === '_id', reason: 'MongoDB does not let a document change its _id' },
  {
    matches: (field) => field.includes('.'),
    reason: 'MongoDB reads a name containing "." as a path into embedded documents',
  },
  {
    matches: (field) => field.startsWith('$'),
    reason: 'MongoDB reads a name starting with "$" as an operator',
  },
];

/** Why `renameField` and `unsetField` cannot rewrite a field of this name, if they cannot. */
export function unrewritableFieldNameReason(field: string): string | undefined {
  return UNREWRITABLE_FIELD_NAMES.find((rule) => rule.matches(field))?.reason;
}

function assertRewritableField(collectionName: string, field: string): void {
  const reason = unrewritableFieldNameReason(field);
  if (reason === undefined) return;
  throw mongoTargetError(
    'MIGRATION.FIELD_NAME_UNSUPPORTED',
    `Field "${field}" in collection ${collectionName} cannot be rewritten: ${reason}.`,
    { meta: { collection: collectionName, field, reason } },
  );
}

function rewritePlan(collectionName: string, command: RawAggregateCommand | RawUpdateManyCommand) {
  return { collection: collectionName, command, meta: { ...REWRITE_PLAN_META } };
}

function noDocumentHolds(
  collectionName: string,
  fields: readonly string[],
  filter: Document | undefined,
): MongoDmlCheck {
  return {
    description: `no document in ${collectionName} holds ${fields.length === 1 ? fields[0] : `both ${fields.join(' and ')}`}`,
    source: rewritePlan(
      collectionName,
      new RawAggregateCommand(collectionName, [
        { $match: documentsHolding(fields, filter) },
        { $limit: 1 },
      ]),
    ),
    filter: MATCH_ALL_FILTER,
    expect: 'notExists',
  };
}

function rewriteUpdate(
  collectionName: string,
  field: string,
  filter: Document | undefined,
  update: Document,
): MongoQueryPlan {
  return rewritePlan(
    collectionName,
    new RawUpdateManyCommand(collectionName, documentsHolding([field], filter), update, {
      bypassDocumentValidation: true,
    }),
  );
}

function idSuffix(filter: Document | undefined): string {
  return filter === undefined ? '' : `.where(${JSON.stringify(filter)})`;
}

function valueList(values: readonly unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join(', ');
}

/** A field condition in words: `type is "bug"`, `type is not "bug"`, `type is none of "bug", "task"`. */
function conditionInWords(field: string, condition: unknown): string | undefined {
  const excluded: unknown =
    typeof condition === 'object' && condition !== null && !Array.isArray(condition)
      ? Reflect.get(condition, '$nin')
      : undefined;
  if (Array.isArray(excluded)) {
    return excluded.length === 1
      ? `${field} is not ${valueList(excluded)}`
      : `${field} is none of ${valueList(excluded)}`;
  }
  return typeof condition === 'object' && condition !== null
    ? undefined
    : `${field} is ${JSON.stringify(condition)}`;
}

/** The documents a filter selects, in words where the planner wrote it, for an operation's label. */
function labelSuffix(filter: Document | undefined): string {
  if (filter === undefined) return '';
  const entries = Object.entries(filter);
  const words = entries.map(([field, condition]) => conditionInWords(field, condition));
  return words.every((word) => word !== undefined) && words.length > 0
    ? ` in documents whose ${words.join(' and ')}`
    : ` in documents matching ${JSON.stringify(filter)}`;
}

export function renameField(
  collectionName: string,
  from: string,
  to: string,
  options?: FieldRewriteOptions,
): MongoDmlOperation {
  assertRewritableField(collectionName, from);
  assertRewritableField(collectionName, to);
  if (from === to) {
    throw mongoTargetError(
      'MIGRATION.INVALID_OPERATION_ENTRY',
      `renameField renames field "${from}" in collection ${collectionName} to its own name.`,
      {
        meta: {
          context: 'renameField',
          collection: collectionName,
          field: from,
          reason: 'the new name is the old name',
        },
      },
    );
  }
  const filter = options?.filter;
  const id = `field.${collectionName}.${from}.rename(${to})${idSuffix(filter)}`;
  return {
    id,
    label: `Rename field ${from} to ${to} in collection ${collectionName}${labelSuffix(filter)}`,
    operationClass: 'widening',
    name: id,
    precheck: [noDocumentHolds(collectionName, [from, to], filter)],
    run: [rewriteUpdate(collectionName, from, filter, { $rename: { [from]: to } })],
    postcheck: [noDocumentHolds(collectionName, [from], filter)],
  };
}

export function unsetField(
  collectionName: string,
  field: string,
  options?: FieldRewriteOptions,
): MongoDmlOperation {
  assertRewritableField(collectionName, field);
  const filter = options?.filter;
  const id = `field.${collectionName}.${field}.unset${idSuffix(filter)}`;
  return {
    id,
    label: `Remove field ${field} from collection ${collectionName}${labelSuffix(filter)}`,
    operationClass: 'destructive',
    name: id,
    precheck: [],
    run: [rewriteUpdate(collectionName, field, filter, { $unset: { [field]: '' } })],
    postcheck: [noDocumentHolds(collectionName, [field], filter)],
  };
}

function formatKeys(keys: ReadonlyArray<MongoIndexKey>): string {
  return keys.map((k) => `${k.field}:${k.direction}`).join(', ');
}

/** What an index check matches, which is the index's keys and collection, not its name. */
function indexObject(collectionName: string, keys: ReadonlyArray<MongoIndexKey>): string {
  if (isTextIndex(keys)) return `a text index in "${collectionName}"`;
  const spec = keys.map((key) => `${key.field}: ${JSON.stringify(key.direction)}`).join(', ');
  return `an index on { ${spec} } in "${collectionName}"`;
}

function isTextIndex(keys: ReadonlyArray<MongoIndexKey>): boolean {
  return keys.some((k) => k.direction === 'text');
}

function keyFilter(keys: ReadonlyArray<MongoIndexKey>) {
  const f = createFieldAccessor<IndexInfoDocShape>();
  return isTextIndex(keys)
    ? f.rawPath('key._fts').eq('text')
    : f.key.eq(
        blindCast<
          MongoValue,
          'keysToKeySpec returns a plain BSON object used as a MongoValue equality target'
        >(keysToKeySpec(keys)),
      );
}

function documentValue(document: Readonly<Record<string, unknown>>): MongoValue {
  return blindCast<MongoValue, 'index options and validators are plain BSON documents'>(document);
}

/** MongoDB stores a text index's text fields as `_fts` and `_ftsx` in the place of the first one. */
function textIndexKeySpec(keys: ReadonlyArray<MongoIndexKey>): Record<string, unknown> {
  const spec: Record<string, unknown> = {};
  for (const key of keys) {
    if (key.direction !== 'text') spec[key.field] = key.direction;
    else if (!Object.hasOwn(spec, '_fts')) Object.assign(spec, { _fts: 'text', _ftsx: 1 });
  }
  return spec;
}

/** MongoDB lists every text field's weight, 1 when none is given, ordered by field name. */
function textIndexWeights(
  keys: ReadonlyArray<MongoIndexKey>,
  weights: Readonly<Record<string, number>> | undefined,
): Record<string, number> {
  const fields = keys.filter((key) => key.direction === 'text').map((key) => key.field);
  return Object.fromEntries(fields.sort().map((field) => [field, weights?.[field] ?? 1]));
}

function flagFilter(field: string, on: boolean | undefined): MongoFilterExpr {
  const set = MongoFieldFilter.eq(field, true);
  return on ? set : new MongoNotExpr(set);
}

function optionFilter(field: string, value: MongoValue | undefined): MongoFilterExpr {
  return value === undefined ? MongoExistsExpr.notExists(field) : MongoFieldFilter.eq(field, value);
}

/**
 * MongoDB completes a collation with its defaults, so only the fields the call gives are compared, as
 * the verifier does. An index with no collation must have none.
 */
function collationFilters(collation: CreateIndexOptions['collation']): MongoFilterExpr[] {
  if (collation === undefined) return [MongoExistsExpr.notExists('collation')];
  return Object.entries(collation).map(([option, value]) =>
    MongoFieldFilter.eq(
      `collation.${option}`,
      blindCast<MongoValue, 'collation options are BSON scalars'>(value),
    ),
  );
}

/**
 * Matches an index with these keys and the options the planner tells indexes apart by. MongoDB
 * stores the options as given, except that it completes a collation and a text index's weights and
 * languages with their defaults, so those are compared as MongoDB lists them.
 */
export type IndexOptionFilter = (
  options: CreateIndexOptions | undefined,
  keys: ReadonlyArray<MongoIndexKey>,
) => readonly MongoFilterExpr[];

const textIndexOnly =
  (filter: IndexOptionFilter): IndexOptionFilter =>
  (options, keys) =>
    isTextIndex(keys) ? filter(options, keys) : [];

/** `name` is derived from the keys, so it tells no two indexes apart. */
type UncomparedCreateIndexOption = 'name';

/**
 * One filter per option the verifier compares. An option of `Options` missing from that list is
 * required here with type `never`, so it fails to compile until the list names it.
 */
export type IndexOptionFilters<Options extends object = CreateIndexOptions> = {
  readonly [K in MongoIndexOptionKey]: IndexOptionFilter;
} & {
  readonly [K in Exclude<keyof Options, UncomparedCreateIndexOption | MongoIndexOptionKey>]: never;
};

const INDEX_OPTION_FILTERS: IndexOptionFilters = {
  unique: (options) => [flagFilter('unique', options?.unique)],
  sparse: (options) => [flagFilter('sparse', options?.sparse)],
  expireAfterSeconds: (options) => [
    optionFilter('expireAfterSeconds', options?.expireAfterSeconds),
  ],
  partialFilterExpression: (options) => [
    optionFilter(
      'partialFilterExpression',
      options?.partialFilterExpression && documentValue(options.partialFilterExpression),
    ),
  ],
  wildcardProjection: (options) => [
    optionFilter(
      'wildcardProjection',
      options?.wildcardProjection && documentValue(options.wildcardProjection),
    ),
  ],
  collation: (options) => collationFilters(options?.collation),
  weights: textIndexOnly((options, keys) => [
    MongoFieldFilter.eq('weights', documentValue(textIndexWeights(keys, options?.weights))),
  ]),
  default_language: textIndexOnly((options) => [
    MongoFieldFilter.eq(
      'default_language',
      options?.default_language ?? TEXT_INDEX_DEFAULT_LANGUAGE,
    ),
  ]),
  language_override: textIndexOnly((options) => [
    MongoFieldFilter.eq(
      'language_override',
      options?.language_override ?? TEXT_INDEX_DEFAULT_LANGUAGE_OVERRIDE,
    ),
  ]),
};

function indexDefinitionFilter(
  keys: ReadonlyArray<MongoIndexKey>,
  options: CreateIndexOptions | undefined,
): MongoFilterExpr {
  return MongoAndExpr.of([
    isTextIndex(keys)
      ? MongoFieldFilter.eq('key', documentValue(textIndexKeySpec(keys)))
      : keyFilter(keys),
    ...MONGO_INDEX_OPTION_KEYS.flatMap((option) => INDEX_OPTION_FILTERS[option](options, keys)),
  ]);
}

const TEXT_INDEX_DEFAULT_LANGUAGE = 'english';
const TEXT_INDEX_DEFAULT_LANGUAGE_OVERRIDE = 'language';

export function createIndex(
  collectionName: string,
  keys: ReadonlyArray<MongoIndexKey>,
  options?: CreateIndexOptions,
): MongoMigrationPlanOperation {
  const name = defaultMongoIndexName(keys);
  const filter = keyFilter(keys);

  return {
    id: buildIndexOpId('create', collectionName, keys),
    label: `Create index on ${collectionName} (${formatKeys(keys)})`,
    operationClass: 'additive',
    precheck: [
      {
        description: `index does not already exist on ${collectionName}`,
        source: new ListIndexesCommand(collectionName),
        filter,
        expect: 'notExists',
        object: indexObject(collectionName, keys),
      },
    ],
    execute: [
      {
        description: `create index on ${collectionName}`,
        command: collection(collectionName).createIndex(keys, {
          ...options,
          name,
        }),
      },
    ],
    postcheck: [
      {
        description: `index exists on ${collectionName}`,
        source: new ListIndexesCommand(collectionName),
        filter: indexDefinitionFilter(keys, options),
        expect: 'exists',
      },
    ],
  };
}

export function dropIndex(
  collectionName: string,
  keys: ReadonlyArray<MongoIndexKey>,
): MongoMigrationPlanOperation {
  const indexName = defaultMongoIndexName(keys);
  const filter = keyFilter(keys);

  return {
    id: buildIndexOpId('drop', collectionName, keys),
    label: `Drop index on ${collectionName} (${formatKeys(keys)})`,
    operationClass: 'widening',
    precheck: [
      {
        description: `index exists on ${collectionName}`,
        source: new ListIndexesCommand(collectionName),
        filter,
        expect: 'exists',
        object: indexObject(collectionName, keys),
      },
    ],
    execute: [
      {
        description: `drop index on ${collectionName}`,
        command: new DropIndexCommand(collectionName, indexName),
      },
    ],
    postcheck: [
      {
        description: `index no longer exists on ${collectionName}`,
        source: new ListIndexesCommand(collectionName),
        filter,
        expect: 'notExists',
        object: indexObject(collectionName, keys),
      },
    ],
  };
}

export function createCollection(
  collectionName: string,
  options?: CreateCollectionOptions,
): MongoMigrationPlanOperation {
  const f = createFieldAccessor<CollectionInfoDocShape>();

  return {
    id: `collection.${collectionName}.create`,
    label: `Create collection ${collectionName}`,
    operationClass: 'additive',
    precheck: [
      {
        description: `collection ${collectionName} does not exist`,
        source: new ListCollectionsCommand(),
        filter: f.name.eq(collectionName),
        expect: 'notExists',
        object: `collection "${collectionName}"`,
      },
    ],
    execute: [
      {
        description: `create collection ${collectionName}`,
        command: collection(collectionName).createCollection(options),
      },
    ],
    postcheck: [],
  };
}

export function dropCollection(collectionName: string): MongoMigrationPlanOperation {
  return {
    id: `collection.${collectionName}.drop`,
    label: `Drop collection ${collectionName}`,
    operationClass: 'destructive',
    precheck: [],
    execute: [
      {
        description: `drop collection ${collectionName}`,
        command: new DropCollectionCommand(collectionName),
      },
    ],
    postcheck: [],
  };
}

function collectionCheck(name: string, expect: 'exists' | 'notExists') {
  return {
    description:
      expect === 'exists' ? `collection ${name} exists` : `collection ${name} does not exist`,
    source: new ListCollectionsCommand(),
    filter: MongoFieldFilter.eq('name', name),
    expect,
    object: `collection "${name}"`,
  };
}

export function renameCollection(from: string, to: string): MongoMigrationPlanOperation {
  return {
    id: `collection.${from}.rename(${to})`,
    label: `Rename collection ${from} to ${to}`,
    operationClass: 'widening',
    precheck: [collectionCheck(from, 'exists'), collectionCheck(to, 'notExists')],
    execute: [
      {
        description: `rename collection ${from} to ${to}`,
        command: new RenameCollectionCommand(from, to),
      },
    ],
    postcheck: [collectionCheck(to, 'exists'), collectionCheck(from, 'notExists')],
  };
}

export function setValidation(
  collectionName: string,
  schema: Record<string, unknown>,
  options?: { validationLevel?: 'strict' | 'moderate'; validationAction?: 'error' | 'warn' },
): MongoMigrationPlanOperation {
  return {
    id: `collection.${collectionName}.setValidation`,
    label: `Set validation on ${collectionName}`,
    operationClass: 'widening',
    precheck: [],
    execute: [
      {
        description: `set validation on ${collectionName}`,
        command: new CollModCommand(collectionName, {
          validator: { $jsonSchema: schema },
          ...ifDefined('validationLevel', options?.validationLevel),
          ...ifDefined('validationAction', options?.validationAction),
        }),
      },
    ],
    postcheck: [],
  };
}

/**
 * Matches the collection's validator body. MongoDB returns the validator through `listCollections`
 * with its keys in the order given, so the order-sensitive comparison holds once the collMod ran; a
 * validator written by hand with another key order only makes the collMod run again.
 */
function validatorBodyFilter(validator: Readonly<Record<string, unknown>>): MongoFilterExpr {
  const { $jsonSchema, ...rest } = validator;
  return $jsonSchema !== undefined && Object.keys(rest).length === 0
    ? MongoFieldFilter.eq(
        'options.validator.$jsonSchema',
        blindCast<MongoValue, 'a $jsonSchema validator is a plain BSON document'>($jsonSchema),
      )
    : MongoFieldFilter.eq('options.validator', documentValue(validator));
}

export function collMod(
  collectionName: string,
  options: CollModOptions,
  meta?: CollModMeta,
): MongoMigrationPlanOperation {
  const hasValidator = options.validator != null && Object.keys(options.validator).length > 0;

  return {
    id: meta?.id ?? `collection.${collectionName}.collMod`,
    label: meta?.label ?? `Modify collection ${collectionName}`,
    operationClass: meta?.operationClass ?? 'widening',
    precheck:
      options.validator != null
        ? [
            {
              description: `collection ${collectionName} exists`,
              source: new ListCollectionsCommand(),
              filter: MongoFieldFilter.eq('name', collectionName),
              expect: 'exists' as const,
              object: `collection "${collectionName}"`,
            },
          ]
        : [],
    execute: [
      {
        description: `modify ${collectionName}`,
        command: new CollModCommand(collectionName, options),
      },
    ],
    postcheck: hasValidator
      ? [
          {
            description: `validator applied on ${collectionName}`,
            source: new ListCollectionsCommand(),
            filter: MongoAndExpr.of([
              MongoFieldFilter.eq('name', collectionName),
              ...(options.validationLevel
                ? [MongoFieldFilter.eq('options.validationLevel', options.validationLevel)]
                : []),
              ...(options.validationAction
                ? [MongoFieldFilter.eq('options.validationAction', options.validationAction)]
                : []),
              validatorBodyFilter(options.validator ?? {}),
            ]),
            expect: 'exists' as const,
          },
        ]
      : [],
  };
}

export function validatedCollection(
  name: string,
  schema: Record<string, unknown>,
  indexes: ReadonlyArray<{ keys: MongoIndexKey[]; unique?: boolean }>,
): MongoMigrationPlanOperation[] {
  return [
    createCollection(name, {
      validator: { $jsonSchema: schema },
      validationLevel: 'strict',
      validationAction: 'error',
    }),
    ...indexes.map((idx) =>
      createIndex(name, idx.keys, idx.unique !== undefined ? { unique: idx.unique } : undefined),
    ),
  ];
}
