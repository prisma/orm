import type { PlanMeta } from '@internal/contract/types';
import {
  type AnyMongoDdlCommand,
  type AnyMongoInspectionCommand,
  type AnyMongoMigrationOperation,
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
  DropIndexCommand,
  ListCollectionsCommand,
  ListIndexesCommand,
  MongoAndExpr,
  type MongoDataTransformCheck,
  type MongoDataTransformOperation,
  MongoExistsExpr,
  MongoFieldFilter,
  type MongoFilterExpr,
  type MongoMigrationCheck,
  type MongoMigrationPlanOperation,
  type MongoMigrationStep,
  MongoNotExpr,
  MongoOrExpr,
} from '@internal/mongo-query-ast/control';
import {
  AggregateCommand,
  type AnyMongoCommand,
  MongoAddFieldsStage,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoMergeStage,
  type MongoPipelineStage,
  MongoProjectStage,
  type MongoQueryPlan,
  MongoSortStage,
  type MongoUpdatePipelineStage,
  RawAggregateCommand,
  RawDeleteManyCommand,
  RawDeleteOneCommand,
  RawFindOneAndDeleteCommand,
  RawFindOneAndUpdateCommand,
  RawInsertManyCommand,
  RawInsertOneCommand,
  RawUpdateManyCommand,
  RawUpdateOneCommand,
} from '@internal/mongo-query-ast/execution';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { type } from 'arktype';
import { mongoTargetError } from './mongo-target-errors';

const IndexKeyDirection = type('1 | -1 | "text" | "2dsphere" | "2d" | "hashed"');
const IndexKeyJson = type({ field: 'string', direction: IndexKeyDirection });

const CollationJson = type({
  locale: 'string',
  'caseLevel?': 'boolean',
  'caseFirst?': 'string',
  'strength?': 'number',
  'numericOrdering?': 'boolean',
  'alternate?': 'string',
  'maxVariable?': 'string',
  'backwards?': 'boolean',
  'normalization?': 'boolean',
});

const CreateIndexJson = type({
  kind: '"createIndex"',
  collection: 'string',
  keys: IndexKeyJson.array().atLeastLength(1),
  'unique?': 'boolean',
  'sparse?': 'boolean',
  'expireAfterSeconds?': 'number',
  'partialFilterExpression?': 'Record<string, unknown>',
  'name?': 'string',
  'wildcardProjection?': 'Record<string, 0 | 1>',
  'collation?': CollationJson,
  'weights?': 'Record<string, number>',
  'default_language?': 'string',
  'language_override?': 'string',
});

const DropIndexJson = type({
  kind: '"dropIndex"',
  collection: 'string',
  name: 'string',
});

const CreateCollectionJson = type({
  kind: '"createCollection"',
  collection: 'string',
  'validator?': 'Record<string, unknown>',
  'validationLevel?': '"strict" | "moderate"',
  'validationAction?': '"error" | "warn"',
  'capped?': 'boolean',
  'size?': 'number',
  'max?': 'number',
  'timeseries?': {
    timeField: 'string',
    'metaField?': 'string',
    'granularity?': '"seconds" | "minutes" | "hours"',
  },
  'collation?': CollationJson,
  'changeStreamPreAndPostImages?': { enabled: 'boolean' },
  'clusteredIndex?': {
    key: 'Record<string, number>',
    unique: 'boolean',
    'name?': 'string',
  },
});

const DropCollectionJson = type({
  kind: '"dropCollection"',
  collection: 'string',
});

const CollModJson = type({
  kind: '"collMod"',
  collection: 'string',
  'validator?': 'Record<string, unknown>',
  'validationLevel?': '"strict" | "moderate"',
  'validationAction?': '"error" | "warn"',
  'changeStreamPreAndPostImages?': { enabled: 'boolean' },
});

const ListIndexesJson = type({
  kind: '"listIndexes"',
  collection: 'string',
});

const ListCollectionsJson = type({
  kind: '"listCollections"',
});

const FieldFilterJson = type({
  kind: '"field"',
  field: 'string',
  op: 'string',
  value: 'unknown',
});

const AndFilterJson = type({
  kind: '"and"',
  exprs: 'Record<string, unknown>[]',
});

const OrFilterJson = type({
  kind: '"or"',
  exprs: 'Record<string, unknown>[]',
});

const NotFilterJson = type({
  kind: '"not"',
  expr: 'Record<string, unknown>',
});

const ExistsFilterJson = type({
  kind: '"exists"',
  field: 'string',
  exists: 'boolean',
});

// ============================================================================
// DML command schemas
// ============================================================================

const RawInsertOneJson = type({
  kind: '"rawInsertOne"',
  collection: 'string',
  document: 'Record<string, unknown>',
});

const RawInsertManyJson = type({
  kind: '"rawInsertMany"',
  collection: 'string',
  documents: 'Record<string, unknown>[]',
});

const RawUpdateOneJson = type({
  kind: '"rawUpdateOne"',
  collection: 'string',
  filter: 'Record<string, unknown>',
  update: 'Record<string, unknown> | Record<string, unknown>[]',
});

const RawUpdateManyJson = type({
  kind: '"rawUpdateMany"',
  collection: 'string',
  filter: 'Record<string, unknown>',
  update: 'Record<string, unknown> | Record<string, unknown>[]',
});

const RawDeleteOneJson = type({
  kind: '"rawDeleteOne"',
  collection: 'string',
  filter: 'Record<string, unknown>',
});

const RawDeleteManyJson = type({
  kind: '"rawDeleteMany"',
  collection: 'string',
  filter: 'Record<string, unknown>',
});

const RawAggregateJson = type({
  kind: '"rawAggregate"',
  collection: 'string',
  pipeline: 'Record<string, unknown>[]',
});

const RawFindOneAndUpdateJson = type({
  kind: '"rawFindOneAndUpdate"',
  collection: 'string',
  filter: 'Record<string, unknown>',
  update: 'Record<string, unknown> | Record<string, unknown>[]',
  upsert: 'boolean',
});

const RawFindOneAndDeleteJson = type({
  kind: '"rawFindOneAndDelete"',
  collection: 'string',
  filter: 'Record<string, unknown>',
});

const TypedAggregateJson = type({
  kind: '"aggregate"',
  collection: 'string',
  pipeline: 'Record<string, unknown>[]',
});

const PlanMetaJson = type({
  target: 'string',
  storageHash: 'string',
  lane: 'string',
  'targetFamily?': 'string',
  'profileHash?': 'string',
  'annotations?': 'Record<string, unknown>',
});

const QueryPlanJson = type({
  collection: 'string',
  command: 'Record<string, unknown>',
  meta: PlanMetaJson,
});

const MatchStageJson = type({
  kind: '"match"',
  filter: 'Record<string, unknown>',
});

const LimitStageJson = type({
  kind: '"limit"',
  limit: 'number',
});

const SortStageJson = type({
  kind: '"sort"',
  sort: 'Record<string, 1 | -1>',
});

const ProjectStageJson = type({
  kind: '"project"',
  projection: 'Record<string, 0 | 1>',
});

const AddFieldsStageJson = type({
  kind: '"addFields"',
  fields: 'Record<string, unknown>',
});

const LookupStageJson = type({
  kind: '"lookup"',
  from: 'string',
  as: 'string',
  'localField?': 'string',
  'foreignField?': 'string',
  'pipeline?': 'Record<string, unknown>[]',
  'let_?': 'Record<string, unknown>',
});

// ============================================================================
// DDL check/step schemas
// ============================================================================

const CheckJson = type({
  description: 'string',
  source: 'Record<string, unknown>',
  filter: 'Record<string, unknown>',
  expect: '"exists" | "notExists"',
});

const StepJson = type({
  description: 'string',
  command: 'Record<string, unknown>',
});

const DdlOperationJson = type({
  id: 'string',
  label: 'string',
  operationClass: '"additive" | "widening" | "destructive"',
  precheck: 'Record<string, unknown>[]',
  execute: 'Record<string, unknown>[]',
  postcheck: 'Record<string, unknown>[]',
});

const DataTransformCheckJson = type({
  description: 'string',
  source: 'Record<string, unknown>',
  filter: 'Record<string, unknown>',
  expect: '"exists" | "notExists"',
});

const DataTransformOperationJson = type({
  id: 'string',
  label: 'string',
  operationClass: '"data"',
  name: 'string',
  precheck: 'Record<string, unknown>[]',
  run: 'Record<string, unknown>[]',
  postcheck: 'Record<string, unknown>[]',
});

type SerializedSlot =
  | Record<string, unknown>
  | readonly unknown[]
  | string
  | number
  | boolean
  | null
  | undefined;

function recordValue(json: unknown, key: string, context: string): SerializedSlot {
  if (json === null || typeof json !== 'object') {
    throw mongoTargetError(
      'MIGRATION.INVALID_OPERATION_ENTRY',
      `Invalid ${context}: expected object`,
      {
        meta: { context },
      },
    );
  }
  return blindCast<
    SerializedSlot,
    'serialized migration JSON slot may contain primitives, records, arrays, null, or undefined'
  >(Reflect.get(json, key));
}

function recordKind(json: unknown, context: string): string {
  const kind = recordValue(json, 'kind', context);
  return typeof kind === 'string' ? kind : '';
}

function validate<T>(schema: { assert: (data: unknown) => T }, data: unknown, context: string): T {
  try {
    return schema.assert(stripUndefinedDeep(data));
  } catch (error) {
    /* v8 ignore start -- assertion libraries always throw Error instances */
    const message = error instanceof Error ? error.message : String(error);
    /* v8 ignore stop */
    throw mongoTargetError('MIGRATION.INVALID_OPERATION_ENTRY', `Invalid ${context}: ${message}`, {
      meta: { context },
      cause: error,
    });
  }
}

/**
 * Strip `undefined`-valued properties before they reach arktype's optional-key
 * assertions.
 *
 * Op IRs (e.g. `CreateCollectionCommand`) assign every optional field on
 * every instance — fields the caller did not provide land as
 * `undefined`-valued properties. arktype treats `{ foo?: 'boolean' }` as
 * "key may be absent, but if present must be boolean", so the bare instance
 * fails validation when it crosses the deserialize boundary in-process
 * (no JSON round-trip happens between planner → runner). This helper
 * recovers the JSON-round-tripped shape (undefined keys absent) without
 * forcing every caller to round-trip.
 *
 * Returns the original value reference whenever no change is needed.
 * That preserves prototype-bound payload values such as BSON wrappers
 * (`ObjectId`, `Decimal128`, `Binary`, …) which embed no `undefined`
 * own-enumerable properties and therefore never trigger a rebuild.
 * Top-level op IRs (class instances with `undefined` optional fields)
 * still get flattened to plain records as required by arktype.
 */
function stripUndefinedDeep(value: unknown): SerializedSlot {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const stripped = stripUndefinedDeep(item);
      if (stripped !== item) changed = true;
      return stripped;
    });
    return changed ? next : value;
  }
  if (value === null || typeof value !== 'object') {
    return blindCast<SerializedSlot, 'primitive serialized values are valid operation JSON slots'>(
      value,
    );
  }
  const entries = Object.entries(value);
  const out: Record<string, unknown> = {};
  let changed = false;
  for (const [key, val] of entries) {
    if (val === undefined) {
      changed = true;
      continue;
    }
    const stripped = stripUndefinedDeep(val);
    if (stripped !== val) changed = true;
    out[key] = stripped;
  }
  return changed
    ? out
    : blindCast<SerializedSlot, 'object serialized values are valid operation JSON slots'>(value);
}

function deserializeFilterExpr(json: unknown): MongoFilterExpr {
  const kind = recordKind(json, 'filter expression');
  switch (kind) {
    case 'field': {
      const data = validate(FieldFilterJson, json, 'field filter');
      return MongoFieldFilter.of(
        data.field,
        data.op,
        blindCast<never, 'field filter values are carried opaquely by the query AST'>(data.value),
      );
    }
    case 'and': {
      const data = validate(AndFilterJson, json, 'and filter');
      return MongoAndExpr.of(data.exprs.map(deserializeFilterExpr));
    }
    case 'or': {
      const data = validate(OrFilterJson, json, 'or filter');
      return MongoOrExpr.of(data.exprs.map(deserializeFilterExpr));
    }
    case 'not': {
      const data = validate(NotFilterJson, json, 'not filter');
      return new MongoNotExpr(deserializeFilterExpr(data.expr));
    }
    case 'exists': {
      const data = validate(ExistsFilterJson, json, 'exists filter');
      return new MongoExistsExpr(data.field, data.exists);
    }
    default:
      throw mongoTargetError(
        'MIGRATION.INVALID_OPERATION_ENTRY',
        `Unknown filter expression kind: ${kind}`,
        { meta: { context: 'filter expression', kind } },
      );
  }
}

// ============================================================================
// Pipeline stage deserialization
// ============================================================================

export function deserializePipelineStage(json: unknown): MongoPipelineStage {
  const kind = recordKind(json, 'pipeline stage');
  switch (kind) {
    case 'match': {
      const data = validate(MatchStageJson, json, 'match stage');
      return new MongoMatchStage(deserializeFilterExpr(data.filter));
    }
    case 'limit': {
      const data = validate(LimitStageJson, json, 'limit stage');
      return new MongoLimitStage(data.limit);
    }
    case 'sort': {
      const data = validate(SortStageJson, json, 'sort stage');
      return new MongoSortStage(data.sort);
    }
    case 'project': {
      const data = validate(ProjectStageJson, json, 'project stage');
      return new MongoProjectStage(data.projection);
    }
    case 'addFields': {
      const data = validate(AddFieldsStageJson, json, 'addFields stage');
      return new MongoAddFieldsStage(
        blindCast<Record<string, never>, 'addFields stage carries expression records opaquely'>(
          data.fields,
        ),
      );
    }
    case 'lookup': {
      const data = validate(LookupStageJson, json, 'lookup stage');
      const opts: {
        from: string;
        as: string;
        localField?: string;
        foreignField?: string;
        pipeline?: ReadonlyArray<MongoPipelineStage>;
        let_?: Record<string, never>;
      } = {
        from: data.from,
        as: data.as,
      };
      if (data.localField !== undefined) opts.localField = data.localField;
      if (data.foreignField !== undefined) opts.foreignField = data.foreignField;
      if (data.pipeline !== undefined) opts.pipeline = data.pipeline.map(deserializePipelineStage);
      if (data.let_ !== undefined)
        opts.let_ = blindCast<
          Record<string, never>,
          'lookup let bindings carry expression records opaquely'
        >(data.let_);
      return new MongoLookupStage(opts);
    }
    case 'merge': {
      const whenMatched = recordValue(json, 'whenMatched', 'merge stage');
      const opts: {
        into: string | { db: string; coll: string };
        on?: string | ReadonlyArray<string>;
        whenMatched?: string | ReadonlyArray<MongoUpdatePipelineStage>;
        whenNotMatched?: string;
      } = {
        into: blindCast<
          string | { db: string; coll: string },
          'merge stage into is validated by MongoDB-compatible serialized operation authors'
        >(recordValue(json, 'into', 'merge stage')),
      };
      const on = recordValue(json, 'on', 'merge stage');
      if (on !== undefined)
        opts.on = blindCast<
          string | string[],
          'merge stage on is either a field name or field-name array'
        >(on);
      if (whenMatched !== undefined) {
        opts.whenMatched =
          typeof whenMatched === 'string'
            ? whenMatched
            : blindCast<
                MongoUpdatePipelineStage[],
                'merge stage whenMatched non-string branch is an update pipeline array'
              >(
                blindCast<
                  unknown[],
                  'merge stage whenMatched non-string branch is a serialized stage array'
                >(whenMatched).map(deserializePipelineStage),
              );
      }
      const whenNotMatched = recordValue(json, 'whenNotMatched', 'merge stage');
      if (whenNotMatched !== undefined)
        opts.whenNotMatched = blindCast<
          string,
          'merge stage whenNotMatched is a Mongo merge action token'
        >(whenNotMatched);
      return new MongoMergeStage(opts);
    }
    default:
      throw mongoTargetError(
        'MIGRATION.INVALID_OPERATION_ENTRY',
        `Unknown pipeline stage kind: ${kind}`,
        { meta: { context: 'pipeline stage', kind } },
      );
  }
}

// ============================================================================
// DML command deserialization
// ============================================================================

export function deserializeDmlCommand(json: unknown): AnyMongoCommand {
  const kind = recordKind(json, 'DML command');
  switch (kind) {
    case 'rawInsertOne': {
      const data = validate(RawInsertOneJson, json, 'rawInsertOne command');
      return new RawInsertOneCommand(data.collection, data.document);
    }
    case 'rawInsertMany': {
      const data = validate(RawInsertManyJson, json, 'rawInsertMany command');
      return new RawInsertManyCommand(data.collection, data.documents);
    }
    case 'rawUpdateOne': {
      const data = validate(RawUpdateOneJson, json, 'rawUpdateOne command');
      return new RawUpdateOneCommand(data.collection, data.filter, data.update);
    }
    case 'rawUpdateMany': {
      const data = validate(RawUpdateManyJson, json, 'rawUpdateMany command');
      return new RawUpdateManyCommand(data.collection, data.filter, data.update);
    }
    case 'rawDeleteOne': {
      const data = validate(RawDeleteOneJson, json, 'rawDeleteOne command');
      return new RawDeleteOneCommand(data.collection, data.filter);
    }
    case 'rawDeleteMany': {
      const data = validate(RawDeleteManyJson, json, 'rawDeleteMany command');
      return new RawDeleteManyCommand(data.collection, data.filter);
    }
    case 'rawAggregate': {
      const data = validate(RawAggregateJson, json, 'rawAggregate command');
      return new RawAggregateCommand(data.collection, data.pipeline);
    }
    case 'rawFindOneAndUpdate': {
      const data = validate(RawFindOneAndUpdateJson, json, 'rawFindOneAndUpdate command');
      return new RawFindOneAndUpdateCommand(data.collection, data.filter, data.update, data.upsert);
    }
    case 'rawFindOneAndDelete': {
      const data = validate(RawFindOneAndDeleteJson, json, 'rawFindOneAndDelete command');
      return new RawFindOneAndDeleteCommand(data.collection, data.filter);
    }
    case 'aggregate': {
      const data = validate(TypedAggregateJson, json, 'aggregate command');
      const pipeline = data.pipeline.map(deserializePipelineStage);
      return new AggregateCommand(data.collection, pipeline);
    }
    default:
      throw mongoTargetError(
        'MIGRATION.INVALID_OPERATION_ENTRY',
        `Unknown DML command kind: ${kind}`,
        { meta: { context: 'DML command', kind } },
      );
  }
}

// ============================================================================
// MongoQueryPlan deserialization
// ============================================================================

export function deserializeMongoQueryPlan(json: unknown): MongoQueryPlan {
  const data = validate(QueryPlanJson, json, 'Mongo query plan');
  const command = deserializeDmlCommand(data.command);
  const m = data.meta;
  const meta: PlanMeta = {
    target: m.target,
    storageHash: m.storageHash,
    lane: m.lane,
    ...ifDefined('targetFamily', m.targetFamily),
    ...ifDefined('profileHash', m.profileHash),
    ...ifDefined('annotations', m.annotations),
  };
  return { collection: data.collection, command, meta };
}

// ============================================================================
// DDL command deserialization
// ============================================================================

function deserializeDdlCommand(json: unknown): AnyMongoDdlCommand {
  const kind = recordKind(json, 'DDL command');
  switch (kind) {
    case 'createIndex': {
      const data = validate(CreateIndexJson, json, 'createIndex command');
      return new CreateIndexCommand(data.collection, data.keys, {
        ...ifDefined('unique', data.unique),
        ...ifDefined('sparse', data.sparse),
        ...ifDefined('expireAfterSeconds', data.expireAfterSeconds),
        ...ifDefined('partialFilterExpression', data.partialFilterExpression),
        ...ifDefined('name', data.name),
        ...ifDefined('wildcardProjection', data.wildcardProjection),
        ...ifDefined('collation', data.collation),
        ...ifDefined('weights', data.weights),
        ...ifDefined('default_language', data.default_language),
        ...ifDefined('language_override', data.language_override),
      });
    }
    case 'dropIndex': {
      const data = validate(DropIndexJson, json, 'dropIndex command');
      return new DropIndexCommand(data.collection, data.name);
    }
    case 'createCollection': {
      const data = validate(CreateCollectionJson, json, 'createCollection command');
      return new CreateCollectionCommand(data.collection, {
        ...ifDefined('validator', data.validator),
        ...ifDefined('validationLevel', data.validationLevel),
        ...ifDefined('validationAction', data.validationAction),
        ...ifDefined('capped', data.capped),
        ...ifDefined('size', data.size),
        ...ifDefined('max', data.max),
        ...ifDefined('timeseries', data.timeseries),
        ...ifDefined('collation', data.collation),
        ...ifDefined('changeStreamPreAndPostImages', data.changeStreamPreAndPostImages),
        ...ifDefined('clusteredIndex', data.clusteredIndex),
      });
    }
    case 'dropCollection': {
      const data = validate(DropCollectionJson, json, 'dropCollection command');
      return new DropCollectionCommand(data.collection);
    }
    case 'collMod': {
      const data = validate(CollModJson, json, 'collMod command');
      return new CollModCommand(data.collection, {
        ...ifDefined('validator', data.validator),
        ...ifDefined('validationLevel', data.validationLevel),
        ...ifDefined('validationAction', data.validationAction),
        ...ifDefined('changeStreamPreAndPostImages', data.changeStreamPreAndPostImages),
      });
    }
    default:
      throw mongoTargetError(
        'MIGRATION.INVALID_OPERATION_ENTRY',
        `Unknown DDL command kind: ${kind}`,
        { meta: { context: 'DDL command', kind } },
      );
  }
}

function deserializeInspectionCommand(json: unknown): AnyMongoInspectionCommand {
  const kind = recordKind(json, 'inspection command');
  switch (kind) {
    case 'listIndexes': {
      const data = validate(ListIndexesJson, json, 'listIndexes command');
      return new ListIndexesCommand(data.collection);
    }
    case 'listCollections': {
      validate(ListCollectionsJson, json, 'listCollections command');
      return new ListCollectionsCommand();
    }
    default:
      throw mongoTargetError(
        'MIGRATION.INVALID_OPERATION_ENTRY',
        `Unknown inspection command kind: ${kind}`,
        { meta: { context: 'inspection command', kind } },
      );
  }
}

function deserializeCheck(json: unknown): MongoMigrationCheck {
  const data = validate(CheckJson, json, 'migration check');
  return {
    description: data.description,
    source: deserializeInspectionCommand(data.source),
    filter: deserializeFilterExpr(data.filter),
    expect: data.expect,
  };
}

function deserializeStep(json: unknown): MongoMigrationStep {
  const data = validate(StepJson, json, 'migration step');
  return {
    description: data.description,
    command: deserializeDdlCommand(data.command),
  };
}

function isDataTransformJson(json: unknown): boolean {
  return recordValue(json, 'operationClass', 'migration operation') === 'data';
}

function deserializeDdlOp(json: unknown): MongoMigrationPlanOperation {
  const data = validate(DdlOperationJson, json, 'migration operation');
  return {
    id: data.id,
    label: data.label,
    operationClass: data.operationClass,
    precheck: data.precheck.map(deserializeCheck),
    execute: data.execute.map(deserializeStep),
    postcheck: data.postcheck.map(deserializeCheck),
  };
}

function deserializeDataTransformCheck(json: unknown): MongoDataTransformCheck {
  const data = validate(DataTransformCheckJson, json, 'data transform check');
  return {
    description: data.description,
    source: deserializeMongoQueryPlan(data.source),
    filter: deserializeFilterExpr(data.filter),
    expect: data.expect,
  };
}

function deserializeDataTransformOp(json: unknown): MongoDataTransformOperation {
  const data = validate(DataTransformOperationJson, json, 'data transform operation');
  return {
    id: data.id,
    label: data.label,
    operationClass: 'data',
    name: data.name,
    precheck: data.precheck.map(deserializeDataTransformCheck),
    run: data.run.map(deserializeMongoQueryPlan),
    postcheck: data.postcheck.map(deserializeDataTransformCheck),
  };
}

export function deserializeMongoOp(json: unknown): AnyMongoMigrationOperation {
  if (isDataTransformJson(json)) {
    return deserializeDataTransformOp(json);
  }
  return deserializeDdlOp(json);
}

export function deserializeMongoOps(json: readonly unknown[]): AnyMongoMigrationOperation[] {
  return json.map(deserializeMongoOp);
}

export function serializeMongoOps(ops: readonly AnyMongoMigrationOperation[]): string {
  return JSON.stringify(ops, null, 2);
}
