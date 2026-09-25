import type {
  MongoDataTransformCheck,
  MongoDataTransformOperation,
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
} from '@internal/mongo-query-ast/control';
import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import { createFieldAccessor } from '@internal/mongo-query-builder';
import { collection } from '@internal/mongo-query-builder/contract-free';
import type { MongoValue } from '@internal/mongo-value';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { CollModMeta } from './op-factory-call';

type StringField = { readonly codecId: 'mongo/string@1'; readonly nullable: false };
type BoolField = { readonly codecId: 'mongo/bool@1'; readonly nullable: false };
type DocField = { readonly codecId: 'mongo/document@1'; readonly nullable: false };

type IndexInfoDocShape = {
  readonly key: DocField;
  readonly unique: BoolField;
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
): MongoDataTransformOperation {
  let precheck: readonly MongoDataTransformCheck[] = [];
  let postcheck: readonly MongoDataTransformCheck[] = [];

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

function formatKeys(keys: ReadonlyArray<MongoIndexKey>): string {
  return keys.map((k) => `${k.field}:${k.direction}`).join(', ');
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

export function createIndex(
  collectionName: string,
  keys: ReadonlyArray<MongoIndexKey>,
  options?: CreateIndexOptions,
): MongoMigrationPlanOperation {
  const name = defaultMongoIndexName(keys);
  const f = createFieldAccessor<IndexInfoDocShape>();
  const filter = keyFilter(keys);
  const fullFilter = options?.unique ? filter.and(f.unique.eq(true)) : filter;

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
        filter: fullFilter,
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
    operationClass: 'destructive',
    precheck: [
      {
        description: `index exists on ${collectionName}`,
        source: new ListIndexesCommand(collectionName),
        filter,
        expect: 'exists',
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

export function setValidation(
  collectionName: string,
  schema: Record<string, unknown>,
  options?: { validationLevel?: 'strict' | 'moderate'; validationAction?: 'error' | 'warn' },
): MongoMigrationPlanOperation {
  return {
    id: `collection.${collectionName}.setValidation`,
    label: `Set validation on ${collectionName}`,
    operationClass: 'destructive',
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

export function collMod(
  collectionName: string,
  options: CollModOptions,
  meta?: CollModMeta,
): MongoMigrationPlanOperation {
  const hasValidator = options.validator != null && Object.keys(options.validator).length > 0;

  return {
    id: meta?.id ?? `collection.${collectionName}.collMod`,
    label: meta?.label ?? `Modify collection ${collectionName}`,
    operationClass: meta?.operationClass ?? 'destructive',
    precheck:
      options.validator != null
        ? [
            {
              description: `collection ${collectionName} exists`,
              source: new ListCollectionsCommand(),
              filter: MongoFieldFilter.eq('name', collectionName),
              expect: 'exists' as const,
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
              // Include the $jsonSchema body so the idempotency probe only skips when the
              // live validator body genuinely already equals the target — not merely when
              // level/action happen to be unchanged (which was the silent-skip bug for widen ops).
              // MongoFieldFilter.eq compares with order-sensitive deepEqual, not canonicalize.
              // That is safe here because MongoDB preserves BSON key order when round-tripping
              // the $jsonSchema through listCollections (confirmed by the MMS integration test),
              // so a matching live validator compares equal. The only consequence of skipping
              // canonicalization is a safe false-negative on the skip: a validator installed
              // out-of-band with a different key order simply re-runs the collMod harmlessly.
              // The cast is safe: CollModOptions.validator is Record<string,unknown>, and its
              // $jsonSchema value is always a plain BSON object (MongoDocument at runtime).
              ...(options.validator?.['$jsonSchema'] !== undefined
                ? [
                    MongoFieldFilter.eq(
                      'options.validator.$jsonSchema',
                      blindCast<
                        MongoValue,
                        'options.validator.$jsonSchema is a plain BSON object — the factory only populates this from a MongoSchemaValidator.jsonSchema record, which is a MongoDocument at runtime'
                      >(options.validator?.['$jsonSchema']),
                    ),
                  ]
                : []),
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
