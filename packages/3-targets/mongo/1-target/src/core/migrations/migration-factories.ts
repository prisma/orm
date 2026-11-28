import type { JsonValue } from '@internal/contract/types';
import {
  isDisabledChangeStream,
  isSimpleCollation,
  reportedCappedMax,
  reportedCappedSize,
  reportsValidator,
} from '@internal/family-mongo/schema-verify';
import {
  defaultMongoIndexName,
  MONGO_INDEX_OPTION_KEYS,
  type MongoIndexOptionKey,
} from '@internal/mongo-contract';
import type {
  MongoDmlCheck,
  MongoDmlOperation,
  MongoFieldRewriteMeta,
  MongoFilterExpr,
  MongoIndexKey,
  MongoMigrationCheck,
} from '@internal/mongo-query-ast/control';
import {
  buildIndexOpId,
  CollModCommand,
  type CollModOptions,
  type CreateCollectionOptions,
  type CreateIndexOptions,
  DropCollectionCommand,
  DropIndexCommand,
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
  RawDeleteManyCommand,
  RawUpdateManyCommand,
} from '@internal/mongo-query-ast/execution';
import { createFieldAccessor } from '@internal/mongo-query-builder';
import { collection } from '@internal/mongo-query-builder/contract-free';
import type { Document, MongoValue } from '@internal/mongo-value';
import type { CollationOptions } from '@internal/mongo-value/mongodb-types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { mongoTargetError } from '../mongo-target-errors';
import { convertKeepsEveryValue, isConvertTarget } from './bson-convert';
import type { CollModMeta } from './op-factory-call';
import {
  documentsWithObject,
  type Expression,
  holdsKey,
  keyOf,
  keysOf,
  lacksKey,
  objectsRewritePipeline,
  type StoredKeyPath,
  storedKeyPath,
} from './stored-key-path';

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

/**
 * A raw `aggregate` on a collection. It is a read, as a data transform's check makes, or a write
 * when the pipeline ends in `$merge` or `$out`, which can skip document validation as `rawUpdateMany` can.
 */
export function rawAggregate(
  collectionName: string,
  pipeline: readonly Document[],
  options?: { readonly bypassDocumentValidation?: boolean },
): MongoQueryPlan {
  return rewritePlan(
    collectionName,
    new RawAggregateCommand(
      collectionName,
      pipeline,
      ifDefined('bypassDocumentValidation', options?.bypassDocumentValidation),
    ),
  );
}

/**
 * A raw `updateMany` on a collection, which a data transform's run can make skip document
 * validation. `update` is an update document, such as `{ $set: { age: 0 } }`, or an aggregation
 * pipeline, such as `[{ $set: { age: { $toInt: '$age' } } }]`, which can read the document's own
 * values.
 */
export function rawUpdateMany(
  collectionName: string,
  filter: Document,
  update: Document | readonly Document[],
  options?: { readonly bypassDocumentValidation?: boolean },
): MongoQueryPlan {
  return rewritePlan(
    collectionName,
    new RawUpdateManyCommand(
      collectionName,
      filter,
      update,
      ifDefined('bypassDocumentValidation', options?.bypassDocumentValidation),
    ),
  );
}

export interface FieldRewriteOptions {
  readonly filter?: Document;
}

function documentsHolding(fields: readonly string[], filter: Document | undefined): Document {
  const conditions: Document[] = [
    ...(filter === undefined ? [] : [filter]),
    ...fields.map((field) => ({ [field]: { $exists: true } })),
  ];
  const [only] = conditions;
  return conditions.length === 1 && only !== undefined ? only : { $and: conditions };
}

const UNREWRITABLE_KEYS: ReadonlyArray<{
  readonly matches: (key: string) => boolean;
  readonly reason: string;
}> = [
  { matches: (key) => key === '', reason: 'it is empty' },
  {
    matches: (key) => key.includes('.'),
    reason: 'MongoDB reads a name containing "." as a path into embedded documents',
  },
  {
    matches: (key) => key.startsWith('$'),
    reason: 'MongoDB reads a name starting with "$" as an operator',
  },
];

/** Why a key of a document or of an object inside one cannot be rewritten, if it cannot. */
export function unrewritableKeyReason(key: string): string | undefined {
  return UNREWRITABLE_KEYS.find((rule) => rule.matches(key))?.reason;
}

/** Why `renameField` and `unsetField` cannot rewrite a field of this name, if they cannot. */
export function unrewritableFieldNameReason(field: string): string | undefined {
  return field === '_id'
    ? 'MongoDB does not let a document change its _id'
    : unrewritableKeyReason(field);
}

/** The plan meta of the raw queries a migration's operations run and check with. */
const RAW_PLAN_META = { target: 'mongo', storageHash: '', lane: 'mongo-raw' } as const;

function assertRewritableField(collectionName: string, field: string): void {
  const reason = unrewritableFieldNameReason(field);
  if (reason === undefined) return;
  throw mongoTargetError(
    'MIGRATION.FIELD_NAME_UNSUPPORTED',
    `Field "${field}" in collection ${collectionName} cannot be rewritten: ${reason}.`,
    { meta: { collection: collectionName, field, reason } },
  );
}

function rewritePlan(
  collectionName: string,
  command: RawAggregateCommand | RawUpdateManyCommand | RawDeleteManyCommand,
) {
  return { collection: collectionName, command, meta: { ...RAW_PLAN_META } };
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

export interface CastFieldOptions {
  readonly collection: string;
  readonly field: string;
  /** The BSON types the field held before, which say whether the cast keeps every value. */
  readonly from: readonly string[];
  /** The BSON type `$convert` casts the field to. */
  readonly to: string;
  /** Whether the field is a list, whose elements are cast one by one. */
  readonly list?: boolean;
  readonly filter?: Document;
}

/**
 * The documents whose field holds a value of none of the BSON types `types`, or, for a list, an
 * element of none of them. A single value is read with `$expr`, since a query's `$type` and `$ne`
 * look at the elements of a list.
 */
export function documentsNotOfType(
  field: string,
  shape: { readonly types: readonly string[]; readonly list: boolean },
): Document {
  if (shape.list) {
    return { [field]: { $elemMatch: { $ne: null, $not: { $type: [...shape.types] } } } };
  }
  return {
    $expr: { $not: { $in: [{ $type: `$${field}` }, ['missing', 'null', ...shape.types]] } },
  };
}

/** The documents where the field is missing or holds `null`, read with `$expr` so a list holding `null` is not one. */
export function documentsMissingOrNull(field: string): Document {
  return { $expr: { $in: [{ $type: `$${field}` }, ['missing', 'null']] } };
}

const NUMBER_TYPES: readonly string[] = ['int', 'long', 'double', 'decimal'];

/**
 * The documents whose field holds a value of one of the BSON types `types`, or, for a list, an
 * element of one of them. A single value is read with `$expr`, since a query's `$type` looks at the
 * elements of a list.
 */
function documentsOfType(
  field: string,
  shape: { readonly types: readonly string[]; readonly list: boolean },
): Document {
  if (shape.list) return { [field]: { $elemMatch: { $type: [...shape.types] } } };
  return { $expr: { $in: [{ $type: `$${field}` }, [...shape.types]] } };
}

/**
 * The documents the cast changes: those holding a value of a type it is planned from, other than
 * `to`. A value of any other type is left as it is, for the validator change's document check to
 * name. A cast planned from no type casts every value that is not of type `to`.
 */
function documentsToCast(field: string, to: string, options: CastFieldOptions): Document {
  const list = options.list === true;
  const from = [
    ...new Set(options.from.flatMap((type) => (type === 'number' ? NUMBER_TYPES : [type]))),
  ].filter((type) => type !== to);
  const condition =
    options.from.length === 0
      ? documentsNotOfType(field, { types: [to], list })
      : documentsOfType(field, { types: from, list });
  return options.filter === undefined ? condition : { $and: [options.filter, condition] };
}

function castExpression(field: string, to: string, list: boolean): Document {
  return list
    ? {
        $map: {
          input: `$${field}`,
          as: 'value',
          in: { $convert: { input: '$$value', to } },
        },
      }
    : { $convert: { input: `$${field}`, to } };
}

/**
 * Casts a field to the BSON type `to` with `$convert`, in the documents where it holds another
 * type. A value `$convert` cannot cast fails the update. Widening when every type in `from` casts
 * to `to` keeping its value, destructive otherwise.
 */
export function castField(options: CastFieldOptions): MongoDmlOperation {
  const { collection: collectionName, field, to, filter } = options;
  assertRewritableField(collectionName, field);
  if (!isConvertTarget(to)) {
    throw mongoTargetError(
      'MIGRATION.INVALID_OPERATION_ENTRY',
      `castField casts field "${field}" in collection ${collectionName} to "${to}", which $convert cannot cast to.`,
      { meta: { context: 'castField', collection: collectionName, field, to } },
    );
  }
  const listOf = (types: string) => (options.list === true ? `list of ${types}` : types);
  const id = `field.${collectionName}.${field}.cast(${to})${idSuffix(filter)}`;
  const toCast = documentsToCast(field, to, options);
  return {
    id,
    meta: { rewrite: { kind: 'cast', collection: collectionName, field, to } },
    label: `Cast field ${field} in collection ${collectionName}${options.from.length === 0 ? '' : ` from ${listOf(options.from.join(', '))}`} to ${listOf(to)}${labelSuffix(filter)}`,
    operationClass:
      options.from.length > 0 && options.from.every((from) => convertKeepsEveryValue(from, to))
        ? 'widening'
        : 'destructive',
    name: id,
    precheck: [],
    run: [
      rewritePlan(
        collectionName,
        new RawUpdateManyCommand(
          collectionName,
          toCast,
          [{ $set: { [field]: castExpression(field, to, options.list === true) } }],
          { bypassDocumentValidation: true },
        ),
      ),
    ],
    postcheck: [
      {
        description: `no document in ${collectionName} holds ${field} as ${options.from.length === 0 ? `another type than ${to}` : `a type it is cast from, ${options.from.join(', ')}`}`,
        source: rewritePlan(
          collectionName,
          new RawAggregateCommand(collectionName, [{ $match: toCast }, { $limit: 1 }]),
        ),
        filter: MATCH_ALL_FILTER,
        expect: 'notExists',
      },
    ],
  };
}

export interface FillFieldOptions {
  readonly collection: string;
  readonly field: string;
  /** An aggregation expression for the value, so it is stored with its BSON type: `{ $toLong: 0 }` stores a long. */
  readonly value: JsonValue;
  readonly filter?: Document;
}

/**
 * Sets a field to `value` in the documents where it is missing or `null`, skipping document
 * validation, as a migration fills a new required field with a temporary value.
 */
export function fillField(options: FillFieldOptions): MongoDmlOperation {
  const { collection: collectionName, field, value, filter } = options;
  assertRewritableField(collectionName, field);
  const id = `field.${collectionName}.${field}.fill${idSuffix(filter)}`;
  const unfilled = documentsMissingOrNull(field);
  const toFill = filter === undefined ? unfilled : { $and: [filter, unfilled] };
  return {
    id,
    meta: { rewrite: { kind: 'fill', collection: collectionName, field } },
    label: `Fill field ${field} in collection ${collectionName} where it is missing or null${labelSuffix(filter)}`,
    operationClass: 'widening',
    name: id,
    precheck: [],
    run: [
      rawUpdateMany(collectionName, toFill, [{ $set: { [field]: value } }], {
        bypassDocumentValidation: true,
      }),
    ],
    postcheck: [
      {
        description: `no document in ${collectionName} has ${field} missing or null`,
        source: rawAggregate(collectionName, [{ $match: toFill }, { $limit: 1 }]),
        filter: MATCH_ALL_FILTER,
        expect: 'notExists',
      },
    ],
  };
}

export interface StoredKeyOptions {
  readonly collection: string;
  /** The stored name of the root field whose value holds the key. */
  readonly field: string;
  /** A JSONPath from the field's value to the key, such as `$[*].street`. A wildcard selects the elements of a list; it does not select an object's member values. */
  readonly path: string;
  readonly filter?: Document;
}

export interface RenameStoredKeyOptions extends StoredKeyOptions {
  readonly to: string;
}

export interface FillStoredKeyOptions extends StoredKeyOptions {
  /** An aggregation expression for the value, so it is stored with its BSON type: `{ $toLong: 0 }` stores a long. */
  readonly value: JsonValue;
}

/** Where the objects that hold a key are: the path to them, and the root field and collection. */
function placeAt(options: StoredKeyOptions, path: string): string {
  return `at path ${JSON.stringify(path)} in field ${options.field} of collection ${options.collection}`;
}

function keyPlace(options: StoredKeyOptions, keyPath: StoredKeyPath): string {
  return placeAt(options, keyPath.objectsText);
}

function assertRewritableKey(options: StoredKeyOptions, keyPath: StoredKeyPath, key: string): void {
  const reason = unrewritableKeyReason(key);
  if (reason === undefined) return;
  throw mongoTargetError(
    'MIGRATION.FIELD_NAME_UNSUPPORTED',
    `Key ${JSON.stringify(key)} ${keyPlace(options, keyPath)} cannot be rewritten: ${reason}.`,
    {
      meta: {
        collection: options.collection,
        field: options.field,
        path: options.path,
        key,
        reason,
      },
    },
  );
}

/** The key path of a stored key operation, refusing a root field or a key MongoDB cannot rewrite. */
function rewritableKeyPath(factory: string, options: StoredKeyOptions): StoredKeyPath {
  assertRewritableField(options.collection, options.field);
  const keyPath = storedKeyPath(options.field, options.path);
  if (!keyPath.ok) {
    throw mongoTargetError(
      'MIGRATION.INVALID_OPERATION_ENTRY',
      `${factory} cannot act ${placeAt(options, options.path)}: ${keyPath.failure}.`,
      {
        meta: {
          context: factory,
          collection: options.collection,
          field: options.field,
          path: options.path,
          reason: keyPath.failure,
        },
      },
    );
  }
  for (const key of keysOf(keyPath.value)) assertRewritableKey(options, keyPath.value, key);
  return keyPath.value;
}

function withFilter(filter: Document | undefined, condition: Document): Document {
  return filter === undefined ? condition : { $and: [filter, condition] };
}

function storedKeyId(options: StoredKeyOptions, action: string): string {
  return `storedKey.${options.collection}.${options.field}.${options.path}.${action}${idSuffix(options.filter)}`;
}

function noDocumentMatches(
  collectionName: string,
  match: Document,
  description: string,
  collation?: CollationOptions,
): MongoDmlCheck {
  return {
    description,
    source: rewritePlan(
      collectionName,
      new RawAggregateCommand(
        collectionName,
        [{ $match: match }, { $limit: 1 }],
        ifDefined('collation', collation),
      ),
    ),
    filter: MATCH_ALL_FILTER,
    expect: 'notExists',
  };
}

function storedKeyRewrite(
  options: StoredKeyOptions,
  toRewrite: Document,
  keyPath: StoredKeyPath,
  rewrite: (object: Expression) => Document,
): MongoQueryPlan {
  return rawUpdateMany(options.collection, toRewrite, objectsRewritePipeline(keyPath, rewrite), {
    bypassDocumentValidation: true,
  });
}

function literal(key: string): Document {
  return { $literal: key };
}

/**
 * Renames the last key of `path` to `to` in every object at the path inside root field `field`,
 * skipping document validation. The precheck stops when an object holds both names.
 */
export function renameStoredKey(options: RenameStoredKeyOptions): MongoDmlOperation {
  const keyPath = rewritableKeyPath('renameStoredKey', options);
  const { collection: collectionName, field, path, to, filter } = options;
  assertRewritableKey(options, keyPath, to);
  const { key } = keyPath;
  if (key === to) {
    throw mongoTargetError(
      'MIGRATION.INVALID_OPERATION_ENTRY',
      `renameStoredKey renames key ${JSON.stringify(key)} ${keyPlace(options, keyPath)} to its own name.`,
      {
        meta: {
          context: 'renameStoredKey',
          collection: collectionName,
          field,
          path,
          reason: 'the new name is the old name',
        },
      },
    );
  }
  const place = keyPlace(options, keyPath);
  const holdingKey = withFilter(
    filter,
    documentsWithObject(keyPath, (object) => holdsKey(object, key)),
  );
  const holdingBoth = withFilter(
    filter,
    documentsWithObject(keyPath, (object) => ({
      $and: [holdsKey(object, key), holdsKey(object, to)],
    })),
  );
  const id = storedKeyId(options, `rename(${to})`);
  return {
    id,
    meta: { rewrite: { kind: 'renameStoredKey', collection: collectionName, field, path, to } },
    label: `Rename key ${JSON.stringify(key)} to ${JSON.stringify(to)} ${place}${labelSuffix(filter)}`,
    operationClass: 'widening',
    name: id,
    precheck: [
      noDocumentMatches(
        collectionName,
        holdingBoth,
        `no object ${place} holds both key ${JSON.stringify(key)} and key ${JSON.stringify(to)}; remove one of the two keys from those objects`,
      ),
    ],
    run: [
      storedKeyRewrite(options, holdingKey, keyPath, (object) => ({
        $cond: [
          holdsKey(object, key),
          {
            $setField: {
              field: literal(to),
              input: { $unsetField: { field: literal(key), input: object } },
              value: keyOf(object, key),
            },
          },
          object,
        ],
      })),
    ],
    postcheck: [
      noDocumentMatches(
        collectionName,
        holdingKey,
        `no object ${place} holds key ${JSON.stringify(key)}`,
      ),
    ],
  };
}

/** Removes the last key of `path` from every object at the path inside root field `field`, skipping document validation. */
export function removeStoredKey(options: StoredKeyOptions): MongoDmlOperation {
  const keyPath = rewritableKeyPath('removeStoredKey', options);
  const { collection: collectionName, field, path, filter } = options;
  const { key } = keyPath;
  const holdingKey = withFilter(
    filter,
    documentsWithObject(keyPath, (object) => holdsKey(object, key)),
  );
  const id = storedKeyId(options, 'remove');
  return {
    id,
    meta: { rewrite: { kind: 'removeStoredKey', collection: collectionName, field, path } },
    label: `Remove key ${JSON.stringify(key)} ${keyPlace(options, keyPath)}${labelSuffix(filter)}`,
    operationClass: 'destructive',
    name: id,
    precheck: [],
    run: [
      storedKeyRewrite(options, holdingKey, keyPath, (object) => ({
        $unsetField: { field: literal(key), input: object },
      })),
    ],
    postcheck: [
      noDocumentMatches(
        collectionName,
        holdingKey,
        `no object ${keyPlace(options, keyPath)} holds key ${JSON.stringify(key)}`,
      ),
    ],
  };
}

/**
 * Sets the last key of `path` to `value` in every object at the path inside root field `field`
 * where it is missing or `null`, skipping document validation.
 */
export function fillStoredKey(options: FillStoredKeyOptions): MongoDmlOperation {
  const keyPath = rewritableKeyPath('fillStoredKey', options);
  const { collection: collectionName, field, path, value, filter } = options;
  const { key } = keyPath;
  const lackingKey = withFilter(
    filter,
    documentsWithObject(keyPath, (object) => lacksKey(object, key)),
  );
  const id = storedKeyId(options, 'fill');
  return {
    id,
    meta: { rewrite: { kind: 'fillStoredKey', collection: collectionName, field, path } },
    label: `Fill key ${JSON.stringify(key)} ${keyPlace(options, keyPath)} where it is missing or null${labelSuffix(filter)}`,
    operationClass: 'widening',
    name: id,
    precheck: [],
    run: [
      storedKeyRewrite(options, lackingKey, keyPath, (object) => ({
        $cond: [
          lacksKey(object, key),
          { $setField: { field: literal(key), input: object, value } },
          object,
        ],
      })),
    ],
    postcheck: [
      noDocumentMatches(
        collectionName,
        lackingKey,
        `no object ${keyPlace(options, keyPath)} lacks key ${JSON.stringify(key)} or holds null there`,
      ),
    ],
  };
}

/** A value a stored value operation matches by equality: an enum's stored value. */
export type StoredValue = string | number | boolean;

export interface StoredValueOptions {
  readonly collection: string;
  /** The stored name of the root field that holds the value, or whose value holds it. */
  readonly field: string;
  /** A JSONPath from the field's value to the key that holds the value, such as `$[*].status`; absent for the field itself. */
  readonly path?: string;
  readonly filter?: Document;
}

export interface ReplaceStoredValueOptions extends StoredValueOptions {
  readonly from: StoredValue;
  /** An aggregation expression for the new value, so it is stored with its BSON type: `{ $toDouble: 2 }` stores a double. */
  readonly to: JsonValue;
}

export interface RemoveStoredValueOptions extends StoredValueOptions {
  readonly value: StoredValue;
  /** Whether the field or key must hold a value, so the operation stops while a document holds the value there outside a list. */
  readonly required?: boolean;
  /** The enum value whose stored value is removed, which the failure names when a required place holds it. */
  readonly enumValue?: Extract<MongoFieldRewriteMeta, { kind: 'removeStoredValue' }>['enumValue'];
}

/** Where a stored value operation acts: the root field, or the key path inside it. */
interface StoredValuePlace {
  readonly keyPath: StoredKeyPath | undefined;
  /** As a label names it: `at path "$.status" in field profile of collection users`. */
  readonly text: string;
}

function isStoredValue(value: unknown): value is StoredValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function storedValuePlace(
  factory: string,
  options: StoredValueOptions,
  value: unknown,
): StoredValuePlace {
  const { collection: collectionName, field, path } = options;
  if (!isStoredValue(value)) {
    throw mongoTargetError(
      'MIGRATION.INVALID_OPERATION_ENTRY',
      `${factory} cannot match value ${JSON.stringify(value)} in field ${field} of collection ${collectionName}: it compares only strings, numbers and booleans.`,
      {
        meta: {
          context: factory,
          collection: collectionName,
          field,
          reason: 'the value is not a string, a number or a boolean',
        },
      },
    );
  }
  if (path === undefined) {
    assertRewritableField(collectionName, field);
    return { keyPath: undefined, text: `in field ${field} of collection ${collectionName}` };
  }
  const at = { collection: collectionName, field, path };
  return { keyPath: rewritableKeyPath(factory, at), text: placeAt(at, path) };
}

function equalsValue(held: Expression, value: StoredValue): Document {
  return { $eq: [held, { $literal: value }] };
}

/** Whether a value is `value`, or a list with an element equal to it. */
function holdsValue(held: Expression, value: StoredValue): Document {
  return {
    $cond: [{ $isArray: held }, { $in: [{ $literal: value }, held] }, equalsValue(held, value)],
  };
}

/** The documents in which the value at the place satisfies `condition`. */
function documentsWhereValue(
  options: StoredValueOptions,
  place: StoredValuePlace,
  condition: (held: Expression) => Document,
): Document {
  const { keyPath } = place;
  const match =
    keyPath === undefined
      ? { $expr: condition(`$${options.field}`) }
      : documentsWithObject(keyPath, (object) => condition(keyOf(object, keyPath.key)));
  return withFilter(options.filter, match);
}

/**
 * The update pipeline that rewrites the value at the place: a list with `inList`, and a value equal
 * to `matched` with `replacement`, or, when it is `undefined`, by removing the field or key.
 */
function storedValuePipeline(
  options: StoredValueOptions,
  place: StoredValuePlace,
  matched: StoredValue,
  inList: (list: Expression) => Document,
  replacement: JsonValue | undefined,
): readonly Document[] {
  const { keyPath } = place;
  if (keyPath === undefined) {
    const held = `$${options.field}`;
    return [
      {
        $set: {
          [options.field]: {
            $cond: [
              { $isArray: held },
              inList(held),
              {
                $cond: [
                  equalsValue(held, matched),
                  replacement === undefined ? '$$REMOVE' : replacement,
                  held,
                ],
              },
            ],
          },
        },
      },
    ];
  }
  const key = literal(keyPath.key);
  return objectsRewritePipeline(keyPath, (object) => {
    const held = keyOf(object, keyPath.key);
    const set = (value: Expression | JsonValue) => ({
      $setField: { field: key, input: object, value },
    });
    return {
      $cond: [
        { $isArray: held },
        set(inList(held)),
        {
          $cond: [
            equalsValue(held, matched),
            replacement === undefined
              ? { $unsetField: { field: key, input: object } }
              : set(replacement),
            object,
          ],
        },
      ],
    };
  });
}

function storedValueId(options: StoredValueOptions, action: string): string {
  const path = options.path === undefined ? '' : `.${options.path}`;
  return `storedValue.${options.collection}.${options.field}${path}.${action}${idSuffix(options.filter)}`;
}

const TYPED_CONSTANT = new Set(['$literal', '$toDouble', '$toLong', '$toInt', '$toDecimal']);

/** The constant an expression writes, as a label shows it: unwrapped from `$literal` or a cast. */
function expressionText(value: JsonValue): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const entries = Object.entries(value);
    const [only] = entries;
    if (entries.length === 1 && only !== undefined && TYPED_CONSTANT.has(only[0])) {
      return expressionText(only[1] ?? null);
    }
  }
  return JSON.stringify(value);
}

function holdingDescription(options: StoredValueOptions, value: StoredValue): string {
  const at = options.path === undefined ? '' : ` at path ${JSON.stringify(options.path)}`;
  return `no document in ${options.collection} holds value ${JSON.stringify(value)}${at} in field ${options.field}`;
}

/**
 * Replaces the stored value `from` with `to` where the field, or the key at `path` inside it, holds
 * it: the value itself, or each element of a list equal to it. Skips document validation.
 */
export function replaceStoredValue(options: ReplaceStoredValueOptions): MongoDmlOperation {
  const { collection: collectionName, field, path, from, to, filter } = options;
  const place = storedValuePlace('replaceStoredValue', options, from);
  const holding = documentsWhereValue(options, place, (held) => holdsValue(held, from));
  const id = storedValueId(options, `replace(${JSON.stringify(from)})`);
  return {
    id,
    meta: {
      rewrite: {
        kind: 'replaceStoredValue',
        collection: collectionName,
        field,
        ...ifDefined('path', path),
      },
    },
    label: `Replace value ${JSON.stringify(from)} with ${expressionText(to)} ${place.text}${labelSuffix(filter)}`,
    operationClass: 'widening',
    name: id,
    precheck: [],
    run: [
      rawUpdateMany(
        collectionName,
        holding,
        storedValuePipeline(
          options,
          place,
          from,
          (list) => ({
            $map: {
              input: list,
              as: 'value',
              in: { $cond: [equalsValue('$$value', from), to, '$$value'] },
            },
          }),
          to,
        ),
        { bypassDocumentValidation: true },
      ),
    ],
    postcheck: [noDocumentMatches(collectionName, holding, holdingDescription(options, from))],
  };
}

/**
 * Removes the stored value `value` where the field, or the key at `path` inside it, holds it: the
 * field or key goes where it equals the value, and the value is pulled from a list. With
 * `required`, the operation first checks that no document holds the value there outside a list.
 * Skips document validation.
 */
export function removeStoredValue(options: RemoveStoredValueOptions): MongoDmlOperation {
  const { collection: collectionName, field, path, value, filter, required, enumValue } = options;
  const place = storedValuePlace('removeStoredValue', options, value);
  const holding = documentsWhereValue(options, place, (held) => holdsValue(held, value));
  const id = storedValueId(options, `remove(${JSON.stringify(value)})`);
  return {
    id,
    meta: {
      rewrite: {
        kind: 'removeStoredValue',
        collection: collectionName,
        field,
        ...ifDefined('path', path),
        value,
        ...ifDefined('required', required),
        ...ifDefined('filter', filter),
        ...ifDefined('enumValue', enumValue),
      },
    },
    label: `Remove value ${JSON.stringify(value)} ${path === undefined ? `from field ${field} of collection ${collectionName}` : place.text}${labelSuffix(filter)}`,
    operationClass: 'destructive',
    name: id,
    precheck:
      required === true
        ? [
            noDocumentMatches(
              collectionName,
              documentsWhereValue(options, place, (held) => equalsValue(held, value)),
              `${holdingDescription(options, value)}, which is required`,
            ),
          ]
        : [],
    run: [
      rawUpdateMany(
        collectionName,
        holding,
        storedValuePipeline(
          options,
          place,
          value,
          (list) => ({
            $filter: {
              input: list,
              as: 'value',
              cond: { $not: [equalsValue('$$value', value)] },
            },
          }),
          undefined,
        ),
        { bypassDocumentValidation: true },
      ),
    ],
    postcheck: [noDocumentMatches(collectionName, holding, holdingDescription(options, value))],
  };
}

export interface DeleteDocumentsOptions {
  readonly collection: string;
  readonly filter: Document;
  /** The collation the delete and its check select with, in place of the collection's own. */
  readonly collation?: CollationOptions;
}

/** The documents a filter selects, in words where the planner wrote it, for an operation's label. */
function selectedText(filter: Document): string {
  const words = Object.entries(filter).map(([field, condition]) =>
    conditionInWords(field, condition),
  );
  return words.length > 0 && words.every((word) => word !== undefined)
    ? `whose ${words.join(' and ')}`
    : `matching ${JSON.stringify(filter)}`;
}

/** Deletes the documents of a collection that `filter` selects, as a variant's documents are deleted. */
export function deleteDocuments(options: DeleteDocumentsOptions): MongoDmlOperation {
  const { collection: collectionName, filter, collation } = options;
  const id = `documents.${collectionName}.delete${idSuffix(filter)}`;
  return {
    id,
    label: `Delete the documents of collection ${collectionName} ${selectedText(filter)}`,
    operationClass: 'destructive',
    name: id,
    precheck: [],
    run: [
      rewritePlan(
        collectionName,
        new RawDeleteManyCommand(collectionName, filter, ifDefined('collation', collation)),
      ),
    ],
    postcheck: [
      noDocumentMatches(
        collectionName,
        filter,
        `no document in ${collectionName} matches ${JSON.stringify(filter)}`,
        collation,
      ),
    ],
  };
}

function formatKeys(keys: ReadonlyArray<MongoIndexKey>): string {
  return keys.map((k) => `${k.field}:${k.direction}`).join(', ');
}

/** What an index content check matches: the index's keys and options in its collection, whatever its name. */
function indexObject(collectionName: string, keys: ReadonlyArray<MongoIndexKey>): string {
  if (isTextIndex(keys)) return `a text index in "${collectionName}"`;
  const spec = keys.map((key) => `${key.field}: ${JSON.stringify(key.direction)}`).join(', ');
  return `an index on { ${spec} } in "${collectionName}"`;
}

function namedIndexObject(collectionName: string, name: string): string {
  return `an index named "${name}" in "${collectionName}"`;
}

function nameFilter(name: string): MongoFilterExpr {
  return MongoFieldFilter.eq('name', name);
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

/** The name is checked on its own, beside the definition. */
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

/**
 * Creates an index under `options.name`, or under the name MongoDB would give it when the call gives none. The precheck requires that the collection holds no index with that name and none with the same keys and options; the postcheck requires an index with that name, keys and options.
 */
export function createIndex(
  collectionName: string,
  keys: ReadonlyArray<MongoIndexKey>,
  options?: CreateIndexOptions,
): MongoMigrationPlanOperation {
  const name = options?.name ?? defaultMongoIndexName(keys);
  const definition = indexDefinitionFilter(keys, options);

  return {
    id: buildIndexOpId('create', collectionName, name),
    label: `Create index ${name} on ${collectionName} (${formatKeys(keys)})`,
    operationClass: 'additive',
    precheck: [
      {
        description: `no index named ${name} exists on ${collectionName}`,
        source: new ListIndexesCommand(collectionName),
        filter: nameFilter(name),
        expect: 'notExists',
        object: namedIndexObject(collectionName, name),
      },
      {
        description: `no index with the same keys and options exists on ${collectionName}`,
        source: new ListIndexesCommand(collectionName),
        filter: definition,
        expect: 'notExists',
        object: indexObject(collectionName, keys),
      },
    ],
    execute: [
      {
        description: `create index ${name} on ${collectionName}`,
        command: collection(collectionName).createIndex(keys, {
          ...options,
          name,
        }),
      },
    ],
    postcheck: [
      {
        description: `index ${name} exists on ${collectionName}`,
        source: new ListIndexesCommand(collectionName),
        filter: MongoAndExpr.of([nameFilter(name), definition]),
        expect: 'exists',
      },
    ],
  };
}

/**
 * Drops the index named `options.name`, or the name MongoDB would give the keys when the call gives none. `options` lists every option the index has, as `migration plan` writes them: the precheck requires an index with that name, those keys and exactly those options, so an option left out must be absent from the index. A call without options checks the keys only. The postcheck requires that no index with that name is left.
 */
export function dropIndex(
  collectionName: string,
  keys: ReadonlyArray<MongoIndexKey>,
  options?: CreateIndexOptions,
): MongoMigrationPlanOperation {
  const name = options?.name ?? defaultMongoIndexName(keys);
  const content = options === undefined ? keyFilter(keys) : indexDefinitionFilter(keys, options);

  return {
    id: buildIndexOpId('drop', collectionName, name),
    label: `Drop index ${name} on ${collectionName} (${formatKeys(keys)})`,
    operationClass: 'widening',
    precheck: [
      {
        description: `index ${name} exists on ${collectionName} with the expected keys and options`,
        source: new ListIndexesCommand(collectionName),
        filter: MongoAndExpr.of([nameFilter(name), content]),
        expect: 'exists',
        object: namedIndexObject(collectionName, name),
      },
    ],
    execute: [
      {
        description: `drop index ${name} on ${collectionName}`,
        command: new DropIndexCommand(collectionName, name),
      },
    ],
    postcheck: [
      {
        description: `index ${name} no longer exists on ${collectionName}`,
        source: new ListIndexesCommand(collectionName),
        filter: nameFilter(name),
        expect: 'notExists',
        object: namedIndexObject(collectionName, name),
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
    postcheck: [
      {
        description: `collection ${collectionName} exists with the options it is created with`,
        source: new ListCollectionsCommand(),
        filter: MongoAndExpr.of([
          f.name.eq(collectionName),
          ...createdCollectionOptionFilters(options ?? {}),
        ]),
        expect: 'exists',
        object: `collection "${collectionName}"`,
      },
    ],
  };
}

/**
 * How the postcheck compares each option `listCollections` reports: the validator whole, a
 * scalar exactly, and a document by the fields the call gives, since MongoDB completes a time-series
 * spec, a collation and a clustered index with defaults. Every option is listed, so a new one does
 * not compile until it is placed.
 */
const CREATED_OPTION_KINDS = {
  validator: 'validator',
  validationLevel: 'scalar',
  validationAction: 'scalar',
  capped: 'scalar',
  size: 'scalar',
  max: 'scalar',
  timeseries: 'document',
  collation: 'document',
  changeStreamPreAndPostImages: 'document',
  clusteredIndex: 'document',
} as const satisfies Record<keyof CreateCollectionOptions, 'validator' | 'scalar' | 'document'>;

/** The options MongoDB reports for a collection created with `options`, by the family's rule. */
function reportedCreateOptions(options: CreateCollectionOptions): CreateCollectionOptions {
  const { validator, capped, size, max, collation, changeStreamPreAndPostImages, ...rest } =
    options;
  return {
    ...rest,
    ...(reportsValidator(validator) ? ifDefined('validator', validator) : {}),
    ...(capped === true ? { capped } : {}),
    ...(size === undefined ? {} : { size: reportedCappedSize(size) }),
    ...(max === undefined ? {} : { max: reportedCappedMax(max) }),
    ...(isSimpleCollation(collation) ? {} : ifDefined('collation', collation)),
    ...(isDisabledChangeStream(changeStreamPreAndPostImages)
      ? {}
      : ifDefined('changeStreamPreAndPostImages', changeStreamPreAndPostImages)),
  };
}

/** Options `listCollections` can report that `createCollection` never sets, so a collection that has one was made another way. */
const OPTIONS_CREATE_NEVER_SETS = [
  'viewOn',
  'pipeline',
  'expireAfterSeconds',
  'storageEngine',
  'indexOptionDefaults',
  'encryptedFields',
] as const;

/**
 * What `listCollections` reports for a collection created with `options`, so that the create is
 * skipped on a re-run only when the collection it made is there, and not for one made another way.
 * Its `type` must be the kind the call creates, an option the call does not give, or sets to a
 * default MongoDB does not report, must be absent, and so must every option the call never sets.
 */
function createdCollectionOptionFilters(options: CreateCollectionOptions): MongoFilterExpr[] {
  const reported = reportedCreateOptions(options);
  return [
    MongoFieldFilter.eq('type', options.timeseries === undefined ? 'collection' : 'timeseries'),
    ...Object.entries(CREATED_OPTION_KINDS).flatMap(([option, kind]): MongoFilterExpr[] => {
      const given: unknown = Reflect.get(reported, option);
      if (given === undefined) return [MongoExistsExpr.notExists(`options.${option}`)];
      if (kind === 'validator') {
        return [
          MongoFieldFilter.eq(
            'options.validator',
            blindCast<MongoValue, 'the validator option is a plain BSON document'>(given),
          ),
        ];
      }
      if (kind === 'scalar') {
        return [
          MongoFieldFilter.eq(
            `options.${option}`,
            blindCast<MongoValue, 'scalar collection options are BSON scalars'>(given),
          ),
        ];
      }
      return Object.entries(Object(given)).map(([field, value]) =>
        MongoFieldFilter.eq(
          `options.${option}.${field}`,
          blindCast<MongoValue, 'collection options are plain BSON values'>(value),
        ),
      );
    }),
    ...OPTIONS_CREATE_NEVER_SETS.map((option) => MongoExistsExpr.notExists(`options.${option}`)),
  ];
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
  options?: {
    validationLevel?: 'strict' | 'moderate';
    validationAction?: 'error' | 'warn';
    /** Whether to check first that every document fits the new validator, and stop if one does not. */
    checkDocuments?: boolean;
  },
): MongoMigrationPlanOperation {
  const validator: CollModOptions = {
    validator: { $jsonSchema: schema },
    ...ifDefined('validationLevel', options?.validationLevel),
    ...ifDefined('validationAction', options?.validationAction),
  };
  const checks =
    options?.checkDocuments === true
      ? collMod(collectionName, validator, { checkDocuments: true })
      : { precheck: [], postcheck: [] };
  return {
    id: `collection.${collectionName}.setValidation`,
    label: `Set validation on ${collectionName}`,
    operationClass: 'widening',
    precheck: checks.precheck,
    execute: [
      {
        description: `set validation on ${collectionName}`,
        command: new CollModCommand(collectionName, validator),
      },
    ],
    postcheck: checks.postcheck,
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

/**
 * A check that no document of `collection` fails `validator`: an aggregate that matches the
 * documents the validator rejects.
 */
function documentsFitValidator(
  collection: string,
  validator: Readonly<Record<string, unknown>>,
): MongoMigrationCheck {
  return {
    description: `every document in ${collection} fits the new validator`,
    source: {
      collection,
      command: new RawAggregateCommand(collection, [
        { $match: { $nor: [validator] } },
        { $limit: 1 },
      ]),
      meta: { ...RAW_PLAN_META },
    },
    filter: MongoExistsExpr.exists('_id'),
    expect: 'notExists',
  };
}

export function collMod(
  collectionName: string,
  options: CollModOptions,
  meta?: CollModMeta,
): MongoMigrationPlanOperation {
  const hasValidator = options.validator != null && Object.keys(options.validator).length > 0;
  if (meta?.checkDocuments === true && !hasValidator) {
    throw mongoTargetError(
      'MIGRATION.INVALID_OPERATION_ENTRY',
      `collMod of collection ${collectionName} checks the documents, but sets no validator to check them against.`,
      { meta: { context: 'collMod', collection: collectionName } },
    );
  }

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
            ...(meta?.checkDocuments === true
              ? [documentsFitValidator(collectionName, options.validator)]
              : []),
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
