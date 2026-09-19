import { CrossReferenceSchema } from '@internal/contract/types';
import { type Type, type } from 'arktype';
import type { MongoJsonObject, MongoJsonPrimitive, MongoJsonValue } from './contract-types';

const ControlPolicySchema = type("'managed' | 'tolerated' | 'external' | 'observed'");

const ScalarFieldTypeSchema = type({
  '+': 'reject',
  kind: "'scalar'",
  codecId: 'string',
  'typeParams?': 'Record<string, unknown>',
});

const ValueObjectFieldTypeSchema = type({
  '+': 'reject',
  kind: "'valueObject'",
  name: 'string',
});

const UnionFieldTypeSchema = type({
  '+': 'reject',
  kind: "'union'",
  members: ScalarFieldTypeSchema.or(ValueObjectFieldTypeSchema).array(),
});

const FieldTypeSchema = ScalarFieldTypeSchema.or(ValueObjectFieldTypeSchema).or(
  UnionFieldTypeSchema,
);

const DomainEnumRefSchema = type({
  plane: "'domain'",
  namespaceId: 'string',
  entityKind: "'enum'",
  entityName: 'string',
  'spaceId?': 'string',
});

const ContractEnumSchema = type({
  '+': 'reject',
  codecId: 'string',
  members: type({
    name: 'string',
    value: 'string | number | boolean | null | unknown[] | Record<string, unknown>',
  })
    .array()
    .atLeastLength(1)
    .readonly(),
});

const RawFieldSchema = type({
  '+': 'reject',
  type: FieldTypeSchema,
  'nullable?': 'boolean',
  'many?': 'boolean',
  'dict?': 'boolean',
  'valueSet?': DomainEnumRefSchema,
});

const FieldSchema = RawFieldSchema.pipe((field) => ({
  ...field,
  nullable: field.nullable ?? false,
}));

const RelationOnSchema = type({
  '+': 'reject',
  localFields: 'string[]',
  targetFields: 'string[]',
});

const ToOneReferenceRelationSchema = type({
  '+': 'reject',
  to: CrossReferenceSchema,
  cardinality: "'1:1' | 'N:1'",
  'nullable?': 'boolean',
  on: RelationOnSchema,
});

const ToManyReferenceRelationSchema = type({
  '+': 'reject',
  to: CrossReferenceSchema,
  cardinality: "'1:N'",
  on: RelationOnSchema,
});

const EmbedRelationSchema = type({
  '+': 'reject',
  to: CrossReferenceSchema,
  cardinality: "'1:1' | '1:N'",
});

const RelationSchema = ToOneReferenceRelationSchema.or(ToManyReferenceRelationSchema).or(
  EmbedRelationSchema,
);

const StorageRelationEntrySchema = type({
  '+': 'reject',
  field: 'string',
});

const MongoJsonPrimitiveSchema = type
  .declare<MongoJsonPrimitive>()
  .type('string | number | boolean | null');

function isMongoJsonRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function withUnseenReference(value: object, seen: WeakSet<object>, visit: () => boolean): boolean {
  if (seen.has(value)) {
    return false;
  }

  seen.add(value);
  const result = visit();
  seen.delete(value);
  return result;
}

function isMongoJsonObject(value: unknown, seen: WeakSet<object>): value is MongoJsonObject {
  return (
    isMongoJsonRecord(value) &&
    withUnseenReference(value, seen, () =>
      Object.values(value).every((entry) => isMongoJsonValue(entry, seen)),
    )
  );
}

function isMongoJsonValue(value: unknown, seen = new WeakSet<object>()): value is MongoJsonValue {
  if (MongoJsonPrimitiveSchema.allows(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return withUnseenReference(value, seen, () =>
      value.every((entry) => isMongoJsonValue(entry, seen)),
    );
  }
  return isMongoJsonObject(value, seen);
}

const MongoJsonValueSchema = type('unknown').narrow((value, ctx) =>
  isMongoJsonValue(value) ? true : ctx.mustBe('a JSON-serializable MongoJsonValue'),
);

const MongoJsonObjectSchema = type({ '[string]': 'unknown' }).narrow((value, ctx) =>
  isMongoJsonRecord(value) &&
  Object.values(value).every((entry) => MongoJsonValueSchema.allows(entry))
    ? true
    : ctx.mustBe('a JSON object with MongoJsonValue entries'),
);

const NumberRecordSchema = type({ '[string]': 'number' });

const IndexFieldsSchema = type({
  '+': 'reject',
  '[string]': '1 | -1 | "text" | "2dsphere" | "2d" | "hashed"',
}).narrow((fields, ctx) =>
  Object.keys(fields).length > 0 ? true : ctx.mustBe('an index field map with at least one entry'),
);

const CollationSchema = type({
  '+': 'reject',
  'kind?': "'mongo-collation-options'",
  locale: 'string',
  'caseLevel?': 'boolean',
  'caseFirst?': '"off" | "upper" | "lower"',
  'strength?': '1 | 2 | 3 | 4 | 5',
  'numericOrdering?': 'boolean',
  'alternate?': '"non-ignorable" | "shifted"',
  'maxVariable?': '"punct" | "space"',
  'backwards?': 'boolean',
  'normalization?': 'boolean',
});

const IndexOptionDefaultsSchema = type({
  '+': 'reject',
  'kind?': "'mongo-index-option-defaults'",
  'storageEngine?': MongoJsonObjectSchema,
});

const TimeSeriesCollectionOptionsSchema = type({
  '+': 'reject',
  'kind?': "'mongo-time-series-collection-options'",
  timeField: 'string',
  'metaField?': 'string',
  'granularity?': '"seconds" | "minutes" | "hours"',
  'bucketMaxSpanSeconds?': 'number',
  'bucketRoundingSeconds?': 'number',
});

const ClusteredCollectionKeySchema = type({
  '+': 'reject',
  '[string]': '1',
}).narrow((key, ctx) =>
  Object.keys(key).length > 0
    ? true
    : ctx.mustBe('a clustered index key map with at least one entry'),
);

const ClusteredCollectionOptionsSchema = type({
  '+': 'reject',
  'kind?': "'mongo-clustered-collection-options'",
  'name?': 'string',
  key: ClusteredCollectionKeySchema,
  unique: 'boolean',
});

const ChangeStreamPreAndPostImagesSchema = type({
  '+': 'reject',
  'kind?': "'mongo-change-stream-pre-and-post-images-options'",
  enabled: 'boolean',
});

const CollectionOptionsSchema = type({
  '+': 'reject',
  'capped?': 'boolean',
  'size?': 'number',
  'max?': 'number',
  'storageEngine?': MongoJsonObjectSchema,
  'indexOptionDefaults?': IndexOptionDefaultsSchema,
  'collation?': CollationSchema,
  'timeseries?': TimeSeriesCollectionOptionsSchema,
  'clusteredIndex?': ClusteredCollectionOptionsSchema,
  'expireAfterSeconds?': 'number',
  'changeStreamPreAndPostImages?': ChangeStreamPreAndPostImagesSchema,
});

const ModelStorageSchema = type({
  '+': 'reject',
  'collection?': 'string',
  'relations?': type({ '[string]': StorageRelationEntrySchema }),
});

const DiscriminatorSchema = type({
  '+': 'reject',
  field: 'string',
});

const VariantEntrySchema = type({
  '+': 'reject',
  value: 'string',
});

const ModelDefinitionSchema = type({
  '+': 'reject',
  fields: type({ '[string]': FieldSchema }),
  storage: ModelStorageSchema,
  'relations?': type({ '[string]': RelationSchema }),
  'discriminator?': DiscriminatorSchema,
  'variants?': type({ '[string]': VariantEntrySchema }),
  'base?': CrossReferenceSchema,
  'owner?': 'string',
});

const WildcardProjectionSchema = type({
  '+': 'reject',
  '[string]': '0 | 1',
});

const IndexOptionsSchema = type({
  '+': 'reject',
  'kind?': "'mongo-index-options'",
  'unique?': 'boolean',
  'name?': 'string',
  'partialFilterExpression?': MongoJsonObjectSchema,
  'sparse?': 'boolean',
  'expireAfterSeconds?': 'number',
  'weights?': NumberRecordSchema,
  'default_language?': 'string',
  'language_override?': 'string',
  'textIndexVersion?': 'number',
  '2dsphereIndexVersion?': 'number',
  'bits?': 'number',
  'min?': 'number',
  'max?': 'number',
  'bucketSize?': 'number',
  'hidden?': 'boolean',
  'collation?': CollationSchema,
  'wildcardProjection?': WildcardProjectionSchema,
});

const IndexSchema = type({
  '+': 'reject',
  fields: IndexFieldsSchema,
  'options?': IndexOptionsSchema,
});

const MongoIndexKeySchema = type({
  '+': 'reject',
  field: 'string',
  direction: '1 | -1 | "text" | "2dsphere" | "2d" | "hashed"',
});

const MongoStorageIndexSchema = type({
  '+': 'reject',
  'kind?': "'mongo-index'",
  keys: MongoIndexKeySchema.array().atLeastLength(1),
  'unique?': 'boolean',
  'sparse?': 'boolean',
  'expireAfterSeconds?': 'number',
  'partialFilterExpression?': 'Record<string, unknown>',
  'wildcardProjection?': 'Record<string, 0 | 1>',
  'collation?': 'Record<string, unknown>',
  'weights?': 'Record<string, number>',
  'default_language?': 'string',
  'language_override?': 'string',
});

const MongoStorageValidatorSchema = type({
  '+': 'reject',
  'kind?': "'mongo-validator'",
  jsonSchema: 'Record<string, unknown>',
  validationLevel: "'strict' | 'moderate'",
  validationAction: "'error' | 'warn'",
});

const CappedOptionsSchema = type({
  '+': 'reject',
  size: 'number',
  'max?': 'number',
});

const TimeseriesOptionsSchema = type({
  '+': 'reject',
  'kind?': "'mongo-time-series-collection-options'",
  timeField: 'string',
  'metaField?': 'string',
  'granularity?': "'seconds' | 'minutes' | 'hours'",
  'bucketMaxSpanSeconds?': 'number',
  'bucketRoundingSeconds?': 'number',
});

const ClusteredIndexSchema = type({
  '+': 'reject',
  'name?': 'string',
});

const MongoCollectionOptionsSchema = type({
  '+': 'reject',
  'kind?': "'mongo-collection-options'",
  'capped?': CappedOptionsSchema,
  'storageEngine?': MongoJsonObjectSchema,
  'indexOptionDefaults?': IndexOptionDefaultsSchema,
  'timeseries?': TimeseriesOptionsSchema,
  'collation?': 'Record<string, unknown>',
  'expireAfterSeconds?': 'number',
  'changeStreamPreAndPostImages?': ChangeStreamPreAndPostImagesSchema,
  'clusteredIndex?': ClusteredIndexSchema,
});

export const StorageCollectionSchema = type({
  '+': 'reject',
  'kind?': "'mongo-collection'",
  'indexes?': MongoStorageIndexSchema.array(),
  'validator?': MongoStorageValidatorSchema,
  'options?': MongoCollectionOptionsSchema,
  'control?': ControlPolicySchema,
});

export const StorageValueSetSchema = type({
  '+': 'reject',
  kind: "'valueSet'",
  values: type('string | number | boolean | null | unknown[] | Record<string, unknown>')
    .array()
    .readonly(),
});

function collectionEntrySchema(fragments?: ReadonlyMap<string, Type<unknown>>): Type<unknown> {
  if (fragments === undefined || fragments.size === 0) {
    return StorageCollectionSchema;
  }
  return type('unknown').narrow((entry, ctx) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return ctx.mustBe('an object');
    }
    const kind = (entry as { kind?: unknown }).kind;
    if (typeof kind === 'string') {
      const fragment = fragments.get(kind);
      if (fragment !== undefined) {
        const parsed = fragment(entry);
        if (parsed instanceof type.errors) {
          return ctx.reject({ expected: parsed.summary });
        }
        return true;
      }
    }
    const parsed = StorageCollectionSchema(entry);
    if (parsed instanceof type.errors) {
      return ctx.reject({ expected: parsed.summary });
    }
    return true;
  });
}

/**
 * Builds the per-namespace envelope schema for Mongo storage. Pack
 * contributions are keyed by the descriptor's `discriminator` and
 * validate each entry by matching the entry's `kind` field. Mongo today
 * has no pack contributions; the composition surface exists for symmetry
 * with SQL and as the substrate for future entity kinds.
 *
 * `'kind?': 'string'` because `kind` is non-enumerable on built
 * Mongo namespace IR classes and therefore absent from the wire shape; the
 * type-side narrowing is enforced by the IR class, not by this validator.
 */
export function createMongoNamespaceEnvelopeSchema(
  fragments?: ReadonlyMap<string, Type<unknown>>,
): Type<unknown> {
  return type({
    '+': 'reject',
    id: 'string',
    'kind?': 'string',
    entries: type({
      'collection?': type({ '[string]': collectionEntrySchema(fragments) }),
      'valueSet?': type({ '[string]': StorageValueSetSchema }),
    }),
  }).narrow((ns, ctx) => {
    if (typeof ns !== 'object' || ns === null || Array.isArray(ns)) {
      return ctx.mustBe('an object');
    }
    if (Object.hasOwn(ns, 'collections') || Object.hasOwn(ns, 'tables')) {
      return ctx.reject({
        expected:
          'namespace must use `entries: { collection? }`; flat `collections` / `tables` keys are no longer accepted',
      });
    }
    return true;
  }) as Type<unknown>;
}

/**
 * Builds the full Mongo contract schema. The per-namespace entry
 * threading happens through {@link createMongoNamespaceEnvelopeSchema};
 * the rest of the envelope is family-shared.
 */
export function createMongoContractSchema(
  fragments?: ReadonlyMap<string, Type<unknown>>,
): Type<unknown> {
  const namespaceEnvelope = createMongoNamespaceEnvelopeSchema(fragments);
  return type({
    '+': 'reject',
    targetFamily: "'mongo'",
    'schemaVersion?': 'string',
    'target?': 'string',
    'storageHash?': 'string',
    'profileHash?': 'string',
    roots: type({ '[string]': CrossReferenceSchema }),
    'capabilities?': 'Record<string, unknown>',
    'extensions?': 'Record<string, unknown>',
    'meta?': 'Record<string, unknown>',
    'defaultControlPolicy?': ControlPolicySchema,
    'sources?': 'Record<string, unknown>',
    '_generated?': 'Record<string, unknown>',
    domain: type({
      namespaces: type({
        '[string]': type({
          models: type({ '[string]': ModelDefinitionSchema }),
          'valueObjects?': type({
            '[string]': type({ '+': 'reject', fields: type({ '[string]': FieldSchema }) }),
          }),
          'enum?': type({ '[string]': ContractEnumSchema }),
        }),
      }),
    }),
    storage: type({
      '+': 'reject',
      namespaces: type({ '[string]': namespaceEnvelope }),
      'storageHash?': 'string',
    }),
  }) as Type<unknown>;
}

export const MongoContractSchema = createMongoContractSchema();

export {
  CollationSchema,
  CollectionOptionsSchema,
  IndexFieldsSchema,
  IndexOptionsSchema,
  IndexSchema,
  MongoIndexKeySchema,
  MongoStorageIndexSchema,
  NumberRecordSchema,
  WildcardProjectionSchema,
};
