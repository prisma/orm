import { asNamespaceId, type ContractMarkerRecord } from '@internal/contract/types';
import { fieldRewriteOf, validatorCheckedBy } from '@internal/family-mongo/control';
import type {
  MarkerOperations,
  MongoRunnerDependencies,
} from '@internal/family-mongo/control-adapter';
import { verifyMongoSchema } from '@internal/family-mongo/schema-verify';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import {
  APP_SPACE_ID,
  expectAbsent,
  expectPresent,
  type FailedCheck,
  failedPostcheckWhy,
  failedPrecheckWhy,
  fieldStatementText,
  type MigrationOperationPolicy,
  type MigrationPlan,
  type MigrationPlanOperation,
  type MigrationRunnerExecutionChecks,
  type MigrationRunnerFailure,
  type MigrationRunnerFailureMeta,
  type MigrationRunnerPerSpaceSuccessValue,
  type MigrationSubject,
  migrationRunnerFailure,
  type OperationContext,
  schemaCheckWhy,
  type VerifyDatabaseSchemaResult,
  withDatabaseUnchanged,
} from '@internal/framework-components/control';
import type { AggregateMigrationEdgeRef } from '@internal/migration-tools/aggregate';
import {
  canonicalize,
  defaultMongoIndexName,
  type MongoContract,
  modelFieldStoredAs,
  propertyBsonTypesOf,
  type ValidatorDocumentShape,
  validatorDocumentShapesOf,
  variantFilterOf,
} from '@internal/mongo-contract';
import type { MongoAdapter, MongoQueryable } from '@internal/mongo-lowering';
import type {
  AnyMongoDdlCommand,
  AnyMongoMigrationOperation,
  MongoDmlCheck,
  MongoDmlOperation,
  MongoFilterExpr,
  MongoInspectionCommandVisitor,
  MongoMigrationCheck,
  MongoMigrationPlanOperation,
} from '@internal/mongo-query-ast/control';
import {
  CollModCommand,
  CreateIndexCommand,
  isInspectionCheckSource,
  isMongoDmlOperation,
  ListCollectionsCommand,
  RenameCollectionCommand,
} from '@internal/mongo-query-ast/control';
import {
  type MongoQueryPlan,
  RawAggregateCommand,
  RawUpdateManyCommand,
} from '@internal/mongo-query-ast/execution';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import { type MongoMigrationRunnerErrorCode, mongoTargetError } from '../mongo-target-errors';
import { FilterEvaluator } from './filter-evaluator';
import { unrewritableFieldNameReason } from './migration-factories';
import { deserializeMongoOps } from './mongo-ops-serializer';
import { type RewriteCollection, rewriteRefusals } from './mongo-rewrite-refusals';

const READ_ONLY_CHECK_COMMAND_KINDS: ReadonlySet<string> = new Set(['aggregate', 'rawAggregate']);

const CHANGED_DOCUMENT_COUNTS = [
  'insertedCount',
  'modifiedCount',
  'upsertedCount',
  'deletedCount',
] as const;

/** Whether a write command's result row says it changed no document: every count it carries is zero. */
function reportsNoChangedDocuments(row: unknown): boolean {
  if (typeof row !== 'object' || row === null) return false;
  const counts = CHANGED_DOCUMENT_COUNTS.map((field) => Reflect.get(row, field)).filter(
    (count) => count !== undefined,
  );
  return counts.length > 0 && counts.every((count) => count === 0);
}

function failedCheckOf(
  operationId: string,
  phase: FailedCheck['phase'],
  check: MongoMigrationCheck,
): FailedCheck {
  return {
    operationId,
    phase,
    description: check.description,
    ...ifDefined(
      'expectation',
      check.object === undefined
        ? undefined
        : check.expect === 'exists'
          ? expectPresent(check.object)
          : expectAbsent(check.object),
    ),
  };
}

export interface MongoMigrationRunnerExecuteOptions {
  readonly plan: MigrationPlan;
  readonly destinationContract: MongoContract;
  readonly policy: MigrationOperationPolicy;
  readonly callbacks?: {
    onOperationStart?(op: MigrationPlanOperation): void;
    onOperationComplete?(op: MigrationPlanOperation): void;
  };
  readonly executionChecks?: MigrationRunnerExecutionChecks;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', 'mongo'>>;
  readonly strictVerification?: boolean;
  readonly context?: OperationContext;
  /**
   * Per-space verify-result scope. When set, the runner verifies the
   * destination contract against the **full** introspected schema, then
   * applies this to scope the result to the space the contract claims —
   * dropping the `extra` findings for collections a sibling space owns.
   *
   * The target descriptor's `execute` injects this callback, derived from
   * the sibling spaces in the aggregate. Callers that don't scope leave it
   * unset and verify against the whole introspected schema.
   */
  readonly scopeVerifyResult?: (result: VerifyDatabaseSchemaResult) => VerifyDatabaseSchemaResult;
  /** Per-edge breakdown from graph-walk planning; drives per-edge ledger writes. */
  readonly migrationEdges: readonly AggregateMigrationEdgeRef[];
  /** Whether an earlier space of the same apply already changed the database. */
  readonly databaseChangedBefore?: boolean;
}

/** A failure of the Mongo runner: one of the codes it returns. */
export interface MongoMigrationRunnerFailure extends MigrationRunnerFailure {
  readonly code: MongoMigrationRunnerErrorCode;
}

/** A space's apply: what the framework reports, and whether it changed the database, its marker and ledger included. */
export interface MongoSpaceSuccessValue extends MigrationRunnerPerSpaceSuccessValue {
  readonly changedDatabase: boolean;
}

export type MongoMigrationRunnerResult = Result<
  MongoSpaceSuccessValue,
  MongoMigrationRunnerFailure
>;

function runnerFailure(
  code: MongoMigrationRunnerErrorCode,
  summary: string,
  options?: { readonly why?: string; readonly meta?: MigrationRunnerFailureMeta },
): MongoMigrationRunnerResult {
  return notOk(migrationRunnerFailure(code, summary, options));
}

/**
 * The failure when a field rename's before-check finds documents that already hold the new name,
 * which `$rename` would overwrite: what to look for and fix, and that the plan resumes.
 */
function renameOverwriteRefusal(op: MongoDmlOperation): MongoMigrationRunnerResult | undefined {
  const rewrite = fieldRewriteOf(op);
  if (rewrite === undefined) return undefined;
  const renames: unknown = Reflect.get(rewrite.command.update, '$rename');
  const to: unknown =
    typeof renames === 'object' && renames !== null
      ? Reflect.get(renames, rewrite.field)
      : undefined;
  if (typeof to !== 'string') return undefined;
  const [check] = op.precheck;
  const source = check?.source.command;
  const match: unknown =
    source instanceof RawAggregateCommand
      ? Reflect.get(source.pipeline[0] ?? {}, '$match')
      : undefined;
  const find = `db.getCollection(${JSON.stringify(rewrite.collection)}).find(${JSON.stringify(match ?? {})})`;
  return runnerFailure(
    'MIGRATION.PRECHECK_FAILED',
    `Operation ${op.id} stopped: some documents in collection ${rewrite.collection} already hold ${to} as well as ${rewrite.field}`,
    {
      why: `Renaming ${rewrite.field} to ${to} would overwrite their ${to}. Find them with ${find} in mongosh, and move or remove one of the two values in each. Nothing was renamed. Once the documents are fixed, run the command again; operations that already ran are skipped.`,
      meta: { operationId: op.id, name: op.name },
    },
  );
}

/**
 * The failure when a collection rename's before-check finds that the new collection already exists.
 */
function renameTargetExistsRefusal(
  op: MongoMigrationPlanOperation,
  failed: MongoMigrationCheck,
): MongoMigrationRunnerResult | undefined {
  const rename = op.execute.find(
    (step) => step.command instanceof RenameCollectionCommand,
  )?.command;
  if (!(rename instanceof RenameCollectionCommand) || failed.expect !== 'notExists') {
    return undefined;
  }
  const { collection: from, to } = rename;
  return runnerFailure(
    'MIGRATION.PRECHECK_FAILED',
    `Operation ${op.id} stopped: collection ${to} already exists, so collection ${from} cannot be renamed to it`,
    {
      why: `Nothing was renamed. If ${to} holds nothing you need, drop it, then run the command again; operations that already ran are skipped. If an earlier operation of the same migration created ${to}, as a createIndex on ${to} does, make renameCollection(${JSON.stringify(from)}, ${JSON.stringify(to)}) the first operation of its migration.ts, run node on that migration.ts, and then drop ${to} and run the command again.`,
      meta: { operationId: op.id },
    },
  );
}

function validatorSetBy(op: MongoMigrationPlanOperation): CollModCommand | undefined {
  const step = op.execute.find(({ command }) => command instanceof CollModCommand)?.command;
  return step instanceof CollModCommand && step.validator !== undefined ? step : undefined;
}

/** The BSON types a property schema's `bsonType` allows, or `undefined` when it names none. */
function allowedBsonTypes(schema: unknown): ReadonlySet<string> | undefined {
  const types = propertyBsonTypesOf(schema);
  return types.length === 0 ? undefined : new Set(types);
}

interface DocumentField {
  readonly type: string;
  readonly value: unknown;
}

/** The fields an object schema requires and declares, and whether it allows any other. */
type FieldsShape = Pick<ValidatorDocumentShape, 'required' | 'properties' | 'closed'>;

/** The shape of a property schema that describes an embedded document, such as a value object. */
function nestedShapeOf(schema: unknown): FieldsShape | undefined {
  if (typeof schema !== 'object' || schema === null) return undefined;
  const properties: unknown = Reflect.get(schema, 'properties');
  const required: unknown = Reflect.get(schema, 'required');
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    return undefined;
  }
  return {
    properties: { ...properties },
    required: Array.isArray(required)
      ? required.filter((name): name is string => typeof name === 'string')
      : [],
    closed: Reflect.get(schema, 'additionalProperties') === false,
  };
}

/** Why a document does not fit a validator, and whether it is a field the validator cannot check, which no change of the document fixes. */
interface DocumentProblem {
  readonly text: string;
  readonly uncheckable: boolean;
}

function problemsAgainst(
  fields: ReadonlyMap<string, DocumentField>,
  shape: FieldsShape,
  path: string,
): readonly DocumentProblem[] {
  const named = (field: string) => JSON.stringify(`${path}${field}`);
  const unreadable = (field: string) =>
    field === '_id' ? undefined : unrewritableFieldNameReason(field);
  const unchecked = [...fields.keys()].flatMap((field) => {
    const reason = unreadable(field);
    return reason === undefined
      ? []
      : [`has ${named(field)}, which the new validator cannot check: ${reason}`];
  });
  const missing = shape.required
    .filter((field) => !fields.has(field))
    .map((field) => `has no ${named(field)}`);
  const retyped = [...fields].flatMap(([field, { type }]) => {
    if (unreadable(field) !== undefined) return [];
    const allowed = allowedBsonTypes(shape.properties[field]);
    return allowed === undefined || allowed.has(type)
      ? []
      : [
          `holds a value of type ${type} in ${named(field)}, which the new validator does not allow there`,
        ];
  });
  const undeclared = shape.closed
    ? [...fields.keys()]
        .filter(
          (field) => !Object.hasOwn(shape.properties, field) && unreadable(field) === undefined,
        )
        .map((field) => `has ${named(field)}, a field the new validator does not name`)
    : [];
  return [
    ...unchecked.map((text) => ({ text, uncheckable: true })),
    ...[...missing, ...retyped, ...undeclared].map((text) => ({ text, uncheckable: false })),
  ];
}

/**
 * The root model or variant of a validator a document is read against: the variant whose
 * discriminator value the document holds, or else the one it fits best.
 */
function shapeOfDocument(
  fields: ReadonlyMap<string, DocumentField>,
  shapes: readonly ValidatorDocumentShape[],
): ValidatorDocumentShape | undefined {
  const selected = shapes.filter(
    ({ discriminator }) =>
      discriminator !== undefined &&
      canonicalize(fields.get(discriminator.field)?.value) === canonicalize(discriminator.value),
  );
  return (selected.length > 0 ? selected : shapes).reduce<ValidatorDocumentShape | undefined>(
    (best, shape) =>
      best === undefined ||
      problemsAgainst(fields, shape, '').length < problemsAgainst(fields, best, '').length
        ? shape
        : best,
    undefined,
  );
}

function joinedList(items: readonly string[]): string {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

/**
 * The `--backfill` statements that let the user choose values for the fields a change makes
 * required: one for each field the planner would accept the statement for, as its rewrite refusals
 * and stored name rules say.
 */
function backfillAdvice(
  contract: MongoContract,
  collection: string,
  requires: readonly string[],
  rewriteCollection: RewriteCollection,
): readonly string[] {
  const accepted = requires.flatMap((stored) => {
    if (unrewritableFieldNameReason(stored) !== undefined) return [];
    const field = fieldStoredAt(contract, collection, stored);
    if (field.kind !== 'field') return [];
    const model = { namespaceId: field.namespaceId, model: field.model };
    const refusals = rewriteRefusals(
      {
        kind: 'backfill',
        collection,
        field: stored,
        filter: variantFilterOf(contract.domain, model),
        model,
      },
      contract,
      rewriteCollection,
    );
    return refusals.length === 0
      ? [{ stored, statement: fieldStatementText(contract, field) }]
      : [];
  });
  if (accepted.length === 0) return [];
  return [
    `To give ${quotedList(accepted.map(({ stored }) => stored))} values you choose, plan the change with migration plan ${accepted.map(({ statement }) => `--backfill ${statement}`).join(' ')}.`,
  ];
}

/** How to change documents by hand while the old validator, which may reject their new shape, is in place. */
function byHandAdvice(collection: string): string {
  return `The old validator may reject a document changed to the new shape, so the update that fixes one can skip document validation: change them with a dataTransform in migration.ts, or in mongosh with an update command that sets bypassDocumentValidation: true, such as db.runCommand({ update: ${JSON.stringify(collection)}, updates: [{ q: { _id: <id> }, u: { $set: { <field>: <value> } } }], bypassDocumentValidation: true }).`;
}

function bsonTypeOf(value: object): unknown {
  return Reflect.get(value, '_bsontype');
}

function uuidText(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/** A value as `mongosh` writes it: `ObjectId("…")`, `ISODate("…")`, `UUID("…")`, anything else as JSON. */
function mongoshValue(value: unknown): string {
  if (value instanceof Date) return `ISODate(${JSON.stringify(value.toISOString())})`;
  if (typeof value === 'object' && value !== null) {
    if (bsonTypeOf(value) === 'ObjectId') return `ObjectId(${JSON.stringify(String(value))})`;
    const bytes: unknown = Reflect.get(value, 'buffer');
    if (
      bsonTypeOf(value) === 'Binary' &&
      Reflect.get(value, 'sub_type') === 4 &&
      bytes instanceof Uint8Array &&
      bytes.length === 16
    ) {
      return `UUID(${JSON.stringify(uuidText(bytes))})`;
    }
  }
  return JSON.stringify(value) ?? String(value);
}

/** The required fields and the property schemas, in canonical form, of one kind of document a validator describes. */
interface DocumentShape {
  readonly key: string;
  readonly required: ReadonlySet<string>;
  readonly properties: ReadonlyMap<string, string>;
}

function documentShapes(jsonSchema: unknown): readonly DocumentShape[] {
  return validatorDocumentShapesOf(jsonSchema).map((shape) => ({
    key: shape.key,
    required: new Set(shape.required),
    properties: new Map(
      Object.entries(shape.properties).map(
        ([field, schema]) => [field, canonicalize(schema)] as const,
      ),
    ),
  }));
}

const ANY_VALUE = canonicalize({});

const NO_SHAPE: DocumentShape = { key: '', required: new Set(), properties: new Map() };

/**
 * The fields a validator change makes required, and those whose accepted values it changes, each
 * kind of document compared with the same kind under the validator the collection has. A kind the
 * collection's validator does not describe is not compared; with no validator, every field it
 * requires is new.
 */
function fieldsTouched(
  before: unknown,
  after: unknown,
): { readonly requires: readonly string[]; readonly retypes: readonly string[] } {
  const shapesBefore = documentShapes(before);
  const requires = new Set<string>();
  const retypes = new Set<string>();
  for (const shape of documentShapes(after)) {
    const previous =
      shapesBefore.length === 0 ? NO_SHAPE : shapesBefore.find(({ key }) => key === shape.key);
    if (previous === undefined) continue;
    for (const field of shape.required) {
      if (field !== '_id' && !previous.required.has(field)) requires.add(field);
    }
    for (const [field, schema] of shape.properties) {
      const schemaBefore = previous.properties.get(field);
      if (schemaBefore !== undefined && schemaBefore !== schema && schema !== ANY_VALUE) {
        retypes.add(field);
      }
    }
  }
  return {
    requires: [...requires].sort(),
    retypes: [...retypes].filter((field) => !requires.has(field)).sort(),
  };
}

function quotedList(fields: readonly string[]): string {
  const quoted = fields.map((field) => JSON.stringify(field));
  return quoted.length <= 1
    ? quoted.join('')
    : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
}

/** What a validator change touches, in words: `This validator change makes "plan" required.` */
function touchedSentence(touched: ReturnType<typeof fieldsTouched>): string {
  const parts = [
    ...(touched.requires.length === 0 ? [] : [`makes ${quotedList(touched.requires)} required`]),
    ...(touched.retypes.length === 0
      ? []
      : [
          `changes what ${quotedList(touched.retypes)} ${touched.retypes.length === 1 ? 'accepts' : 'accept'}`,
        ]),
  ];
  return parts.length === 0 ? '' : `This validator change ${parts.join(' and ')}. `;
}

const MONGO_UNAUTHORIZED = 13;

/**
 * The failure for a rewrite that skips validation when the database user lacks the
 * `bypassDocumentValidation` action, as a `readWrite` user on a hosted cluster does.
 */
function bypassValidationRefusal(
  op: MongoDmlOperation,
  plan: MongoQueryPlan,
  error: unknown,
): MongoMigrationRunnerResult | undefined {
  if (!(plan.command instanceof RawUpdateManyCommand) || !plan.command.bypassDocumentValidation) {
    return undefined;
  }
  if (typeof error !== 'object' || error === null) return undefined;
  if (Reflect.get(error, 'code') !== MONGO_UNAUTHORIZED) return undefined;
  const codeName: unknown = Reflect.get(error, 'codeName');
  return runnerFailure(
    'MIGRATION.EXECUTION_FAILED',
    `Operation ${op.id} failed: the database user may not skip document validation`,
    {
      why: `Rewriting documents to fit the new schema skips document validation, because the old validator rejects the new shape. MongoDB refused it with error ${MONGO_UNAUTHORIZED} (${String(codeName)}). Grant the user the bypassDocumentValidation action on the database, for example with the dbAdmin or restore role, then run the command again; operations that already ran are skipped.`,
      meta: {
        operationId: op.id,
        mongoCode: MONGO_UNAUTHORIZED,
        codeName,
      },
    },
  );
}

const MONGO_CONVERSION_FAILURE = 241;

/** The innermost cause MongoDB gives in an error's message, without its closing period. */
function mongoErrorText(error: object): string {
  const message = String(Reflect.get(error, 'message'));
  return (message.split(' :: caused by :: ').at(-1) ?? message).replace(/\.+$/, '');
}

/** The field of the destination contract a collection stores under `storedName`, or the storage name when no model declares it. */
function fieldStoredAt(
  contract: MongoContract,
  collection: string,
  storedName: string,
): MigrationSubject {
  const field = modelFieldStoredAs(contract.domain, collection, storedName);
  return field === undefined
    ? { kind: 'storage', name: `${collection}.${storedName}` }
    : { kind: 'field', ...field, namespaceId: asNamespaceId(field.namespaceId) };
}

const MONGO_DUPLICATE_KEY = 11000;

/** What a user can do about a MongoDB error that stopped a rewrite, when the error says. */
function rewriteErrorFix(mongoCode: number, reason: string): string | undefined {
  if (mongoCode !== MONGO_DUPLICATE_KEY) return undefined;
  const index = /index: (\S+)/.exec(reason)?.[1];
  const named = index === undefined ? 'a unique index' : `unique index ${JSON.stringify(index)}`;
  return `The rewrite would give two documents the same value under ${named}. Change or remove the documents that would collide, then run the command again; operations that already ran are skipped.`;
}

/**
 * The failure when MongoDB cannot build a unique index because two documents hold the same value
 * of its keys, as documents without the field all hold `null`. The build changes nothing.
 */
function indexBuildFailure(
  op: MongoMigrationPlanOperation,
  command: AnyMongoDdlCommand,
  error: unknown,
): MongoMigrationRunnerResult | undefined {
  if (!(command instanceof CreateIndexCommand) || typeof error !== 'object' || error === null) {
    return undefined;
  }
  if (Reflect.get(error, 'code') !== MONGO_DUPLICATE_KEY) return undefined;
  const reason = mongoErrorText(error);
  const duplicate = /dup key: (\{.*\})/.exec(reason)?.[1];
  const index = command.name ?? defaultMongoIndexName(command.keys);
  return runnerFailure(
    'MIGRATION.EXECUTION_FAILED',
    `Operation ${op.id} failed: the unique index ${index} cannot be built, because two documents in collection ${command.collection} hold the same value${duplicate === undefined ? '' : ` ${duplicate}`}`,
    {
      why: 'A document without the field counts as holding null. Give each document its own value of the indexed fields, or remove the duplicates, then run the command again; operations that already ran are skipped.',
      meta: {
        operationId: op.id,
        mongoCode: MONGO_DUPLICATE_KEY,
        index,
        collection: command.collection,
        ...(duplicate === undefined ? {} : { duplicateKey: duplicate }),
      },
    },
  );
}

/**
 * The failure when a rewrite fails after MongoDB began it: documents it reached may already be
 * rewritten. A planner cast that meets a value `$convert` cannot cast names the field, which the
 * advice reads to offer `--convert`. A data transform's update is the user's own, so its failure
 * never names a type change.
 */
function rewriteFailure(
  op: MongoDmlOperation,
  error: unknown,
  position: { readonly operationIndex: number; readonly contract: MongoContract },
): MongoMigrationRunnerResult | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const mongoCode: unknown = Reflect.get(error, 'code');
  if (typeof mongoCode !== 'number') return undefined;
  const codeName: unknown = Reflect.get(error, 'codeName');
  const mongoError = typeof codeName === 'string' ? `${mongoCode} (${codeName})` : `${mongoCode}`;
  const reason = mongoErrorText(error);
  if (op.operationClass === 'data') {
    return mongoCode === MONGO_CONVERSION_FAILURE
      ? runnerFailure(
          'MIGRATION.EXECUTION_FAILED',
          `Operation ${op.id} failed: its update met a value MongoDB cannot convert`,
          {
            why: `MongoDB stopped the data transform's update: ${reason}. Documents it updated before that value stay updated. Until a re-run finishes, a document the update already changed may no longer fit the collection's current validator, so updates to it fail. Fix the update in the migration's migration.ts, run the file with node, then run the command again.`,
            meta: { operationId: op.id, mongoCode },
          },
        )
      : runnerFailure(
          'MIGRATION.EXECUTION_FAILED',
          `Operation ${op.id} failed: MongoDB error ${mongoError}: ${reason}`,
          {
            why: "Documents the update changed before the error stay changed. Until a re-run finishes, a document the update already changed may no longer fit the collection's current validator, so updates to it fail. Fix what MongoDB names; when it comes from the update, change the update in the migration's migration.ts so its filter and update work on a re-run, and run the file with node. Then run the command again.",
            meta: {
              operationId: op.id,
              mongoCode,
              ...(typeof codeName === 'string' ? { codeName } : {}),
            },
          },
        );
  }
  const rewrite = fieldRewriteOf(op);
  if (rewrite === undefined) return undefined;
  const cast = op.meta?.rewrite?.kind === 'cast' ? op.meta.rewrite : undefined;
  if (mongoCode !== MONGO_CONVERSION_FAILURE || cast === undefined) {
    const fix = rewriteErrorFix(mongoCode, reason);
    return runnerFailure(
      'MIGRATION.EXECUTION_FAILED',
      `Operation ${op.id} failed: MongoDB error ${mongoError}: ${reason}`,
      {
        why: [
          'Documents the rewrite changed before the error stay changed.',
          ...(fix === undefined ? [] : [fix]),
        ].join(' '),
        meta: {
          operationId: op.id,
          mongoCode,
          ...(typeof codeName === 'string' ? { codeName } : {}),
        },
      },
    );
  }
  const field = fieldStoredAt(position.contract, rewrite.collection, rewrite.field);
  const named =
    field.kind === 'field' ? fieldStatementText(position.contract, field) : rewrite.field;
  return runnerFailure(
    'MIGRATION.EXECUTION_FAILED',
    `Operation ${op.id} failed: a value of field "${named}" in collection ${cast.collection} cannot be cast to ${cast.to}`,
    {
      why: `MongoDB's $convert met a value of field "${named}" it cannot cast to ${cast.to}: ${reason}. Documents cast before that value stay cast, and a re-run casts the rest. Until it does, a document already cast holds a type the collection's current validator does not allow, so updates to it fail.`,
      meta: {
        operationId: op.id,
        mongoCode,
        failedTypeChange: {
          field,
          by: 'cast',
          reason: 'value',
          operationIndex: position.operationIndex,
        },
      },
    },
  );
}

/**
 * The failure, saying which collections a rewrite of this apply changed while their validator change
 * has not run: their documents may no longer fit the validator still in place.
 */
function withRewrittenBeforeValidator(
  failure: MongoMigrationRunnerFailure,
  collections: ReadonlySet<string>,
): MongoMigrationRunnerFailure {
  if (collections.size === 0) return failure;
  const named = [...collections].map((collection) => `collection ${collection}`).join(', ');
  const sentence = `Documents this apply already rewrote in ${named} may no longer fit the collection's current validator, so updates to them fail until the migration finishes.`;
  const why =
    failure.why === undefined ? sentence : `${failure.why.replace(/\.?$/, '.')} ${sentence}`;
  const attributed = migrationRunnerFailure(failure.code, failure.message, {
    why,
    meta: failure.meta,
    ...ifDefined('cause', failure.cause),
  });
  if (failure.stack !== undefined) attributed.stack = failure.stack;
  return attributed;
}

export class MongoMigrationRunner {
  constructor(private readonly deps: MongoRunnerDependencies) {}

  async execute(options: MongoMigrationRunnerExecuteOptions): Promise<MongoMigrationRunnerResult> {
    let changedDatabase = false;
    const rewrittenBeforeValidator = new Set<string>();
    const result = await this.apply(
      options,
      () => {
        changedDatabase = true;
      },
      rewrittenBeforeValidator,
    );
    return result.ok
      ? ok({ ...result.value, changedDatabase })
      : notOk(
          withDatabaseUnchanged(
            withRewrittenBeforeValidator(result.failure, rewrittenBeforeValidator),
            options.databaseChangedBefore !== true && !changedDatabase,
          ),
        );
  }

  /**
   * Applies the plan, calling `wrote` after each command that changes the database, and keeping in
   * `rewrittenBeforeValidator` each collection a rewrite changed whose validator change has not run
   * since.
   */
  private async apply(
    options: MongoMigrationRunnerExecuteOptions,
    wrote: () => void,
    rewrittenBeforeValidator: Set<string>,
  ): Promise<Result<MigrationRunnerPerSpaceSuccessValue, MongoMigrationRunnerFailure>> {
    const { inspectionExecutor, adapter, driver, executeDdl, markerOps } = this.deps;
    const operations = deserializeMongoOps(
      blindCast<
        readonly unknown[],
        'framework migration plans serialize operations as a readonly JSON entry array'
      >(options.plan.operations),
    );
    // Plans produced by the contract-space-aware planner stamp `spaceId`
    // onto the plan; plans without one fall through to the application's
    // well-known space.
    const space = options.plan.spaceId ?? APP_SPACE_ID;

    const policyCheck = this.enforcePolicyCompatibility(options.policy, operations);
    if (policyCheck) return policyCheck;

    const existingMarker = await markerOps.readMarker(space);

    const markerCheck = this.ensureMarkerCompatibility(existingMarker, options.plan);
    if (markerCheck) return markerCheck;

    const checks = options.executionChecks;
    const runPrechecks = checks?.prechecks !== false;
    const runPostchecks = checks?.postchecks !== false;
    const runIdempotency = checks?.idempotencyChecks !== false;

    const filterEvaluator = new FilterEvaluator();

    let operationsExecuted = 0;
    const rewritesRan = new Map<string, string[]>();
    const ranOn = (collection: string): readonly string[] => rewritesRan.get(collection) ?? [];

    for (const [operationIndex, operation] of operations.entries()) {
      options.callbacks?.onOperationStart?.(operation);
      try {
        if (isMongoDmlOperation(operation)) {
          const result = await this.executeDmlOperation(
            operation,
            adapter,
            driver,
            filterEvaluator,
            runIdempotency,
            runPrechecks,
            runPostchecks,
            wrote,
            { operationIndex, contract: options.destinationContract },
          );
          if (result.failure) return result.failure;
          if (result.executed) {
            operationsExecuted += 1;
            const collection = operation.run[0]?.collection;
            if (collection !== undefined) {
              rewritesRan.set(collection, [...ranOn(collection), operation.label]);
              rewrittenBeforeValidator.add(collection);
            }
          }
          continue;
        }

        if (runPostchecks && runIdempotency) {
          const allSatisfied = await this.allChecksSatisfied(
            operation.postcheck,
            inspectionExecutor,
            filterEvaluator,
          );
          if (allSatisfied) continue;
        }

        if (runPrechecks) {
          const failing = await this.firstFailingCheck(
            operation.precheck,
            inspectionExecutor,
            filterEvaluator,
          );
          if (failing !== undefined) {
            const failedCheck = failedCheckOf(operation.id, 'precheck', failing);
            return (
              renameTargetExistsRefusal(operation, failing) ??
              (await this.documentsFailingValidatorRefusal(operation, failing, {
                ranOn,
                contract: options.destinationContract,
              })) ??
              runnerFailure(
                'MIGRATION.PRECHECK_FAILED',
                `Operation ${operation.id} failed during precheck: ${failing.description}`,
                { why: failedPrecheckWhy(failedCheck), meta: { failedCheck } },
              )
            );
          }
        }

        for (const step of operation.execute) {
          try {
            await executeDdl(step.command);
          } catch (error) {
            const failure = indexBuildFailure(operation, step.command, error);
            if (failure === undefined) throw error;
            return failure;
          }
          wrote();
        }

        if (runPostchecks) {
          const failing = await this.firstFailingCheck(
            operation.postcheck,
            inspectionExecutor,
            filterEvaluator,
          );
          if (failing !== undefined) {
            const failedCheck = failedCheckOf(operation.id, 'postcheck', failing);
            return runnerFailure(
              'MIGRATION.POSTCHECK_FAILED',
              `Operation ${operation.id} failed during postcheck: ${failing.description}`,
              {
                why: failedPostcheckWhy(failedCheck),
                meta: { operationId: operation.id, failedCheck },
              },
            );
          }
        }

        operationsExecuted += 1;
        const validated = validatorSetBy(operation)?.collection;
        if (validated !== undefined) rewrittenBeforeValidator.delete(validated);
      } finally {
        options.callbacks?.onOperationComplete?.(operation);
      }
    }

    const destination = options.plan.destination;
    const profileHash = options.destinationContract.profileHash ?? destination.storageHash;

    const incomingInvariants = options.plan.providedInvariants ?? [];
    const existingInvariantSet = new Set(existingMarker?.invariants ?? []);
    const incomingIsSubsetOfExisting = incomingInvariants.every((id) =>
      existingInvariantSet.has(id),
    );
    const markerAlreadyAtDestination =
      existingMarker !== null &&
      existingMarker.storageHash === destination.storageHash &&
      existingMarker.profileHash === profileHash;

    // Skip marker/ledger writes (and schema verification) only when the apply
    // is a true no-op: no operations executed, marker already at destination,
    // and every incoming invariant is already in the stored set.
    //
    // Divergence from the SQL runners (postgres/sqlite): those runners gate
    // the no-op skip on `isSelfEdge` (origin === destination) only, so a
    // non-self-edge `db update` that introspects-as-no-op still writes a
    // ledger entry. Mongo skips even those because the runner has no
    // structural distinction between self-edge and re-apply — invariant-
    // aware routing here does not yet differentiate between the two
    // ledger semantics. If the SQL audit-trail behavior should hold for
    // Mongo too, gate this `isNoOp` on a self-edge check (or, conversely,
    // align the SQL runners to skip non-self-edge no-ops uniformly).
    const isNoOp =
      operationsExecuted === 0 && markerAlreadyAtDestination && incomingIsSubsetOfExisting;

    if (!isNoOp) {
      const liveSchema = await this.deps.introspectSchema();
      // When an aggregate spans more than one space the live database holds
      // collections owned by sibling spaces; verify against the full schema,
      // then let the target descriptor's `execute`-injected `scopeVerifyResult`
      // drop the `extra` findings for the collections those siblings own.
      // Callers that don't scope leave the result unchanged.
      const rawVerifyResult = verifyMongoSchema({
        contract: options.destinationContract,
        schema: liveSchema,
        strict: options.strictVerification ?? true,
        frameworkComponents: options.frameworkComponents,
        ...(options.context ? { context: options.context } : {}),
      });
      const verifyResult = options.scopeVerifyResult
        ? options.scopeVerifyResult(rawVerifyResult)
        : rawVerifyResult;
      if (!verifyResult.ok) {
        return runnerFailure('MIGRATION.SCHEMA_VERIFY_FAILED', verifyResult.summary, {
          why: schemaCheckWhy(verifyResult.schema.issues),
          meta: { schemaIssues: verifyResult.schema.issues },
        });
      }

      if (existingMarker) {
        const updated = await markerOps.updateMarker(space, existingMarker.storageHash, {
          storageHash: destination.storageHash,
          profileHash,
          invariants: incomingInvariants,
        });
        if (!updated) {
          const found = await markerOps.readMarker(space);
          return runnerFailure(
            'MIGRATION.MARKER_CAS_FAILURE',
            'Marker was modified by another process during migration execution.',
            {
              meta: {
                space,
                expectedStorageHash: existingMarker.storageHash,
                foundStorageHash: found?.storageHash ?? null,
                destinationStorageHash: destination.storageHash,
              },
            },
          );
        }
      } else {
        await markerOps.initMarker(space, {
          storageHash: destination.storageHash,
          profileHash,
          invariants: incomingInvariants,
        });
      }
      wrote();

      await this.recordLedgerEntries(markerOps, space, options);
    }

    return ok({ operationsPlanned: operations.length, operationsExecuted });
  }

  private async recordLedgerEntries(
    markerOps: MarkerOperations,
    space: string,
    options: MongoMigrationRunnerExecuteOptions,
  ): Promise<void> {
    const plan = options.plan;
    const edges = options.migrationEdges;
    const totalEdgeOps = edges.reduce((sum, edge) => sum + edge.operationCount, 0);
    if (totalEdgeOps !== plan.operations.length) {
      throw new InternalError(
        `Ledger write: plan.operations length (${plan.operations.length}) does not match sum of migrationEdges operationCount (${totalEdgeOps})`,
      );
    }
    let offset = 0;
    for (const edge of edges) {
      const edgeOps = plan.operations.slice(offset, offset + edge.operationCount);
      offset += edge.operationCount;
      await markerOps.writeLedgerEntry(space, {
        edgeId: `${edge.from}->${edge.to}`,
        from: edge.from,
        to: edge.to,
        migrationName: edge.dirName,
        migrationHash: edge.migrationHash,
        operations: edgeOps,
      });
    }
  }

  private async executeDmlOperation(
    op: MongoDmlOperation,
    adapter: MongoAdapter,
    driver: MongoQueryable,
    filterEvaluator: FilterEvaluator,
    runIdempotency: boolean,
    runPrechecks: boolean,
    runPostchecks: boolean,
    wrote: () => void,
    position: { readonly operationIndex: number; readonly contract: MongoContract },
  ): Promise<{ executed: boolean; failure?: MongoMigrationRunnerResult }> {
    if (runPostchecks && runIdempotency && op.postcheck.length > 0) {
      const allSatisfied = await this.evaluateDmlChecks(op.postcheck, filterEvaluator);
      if (allSatisfied) return { executed: false };
    }

    if (runPrechecks && op.precheck.length > 0) {
      const passed = await this.evaluateDmlChecks(op.precheck, filterEvaluator);
      if (!passed) {
        return {
          executed: false,
          failure:
            renameOverwriteRefusal(op) ??
            runnerFailure(
              'MIGRATION.PRECHECK_FAILED',
              `Operation ${op.id} failed during precheck`,
              {
                meta: { operationId: op.id, name: op.name },
              },
            ),
        };
      }
    }

    for (const plan of op.run) {
      const wireCommand = await adapter.lower(plan, {});
      try {
        let reportedNoChange = false;
        let reportedChange = false;
        for await (const row of driver.execute<unknown>(wireCommand)) {
          if (reportsNoChangedDocuments(row)) reportedNoChange = true;
          else reportedChange = true;
        }
        if (reportedChange || !reportedNoChange) wrote();
      } catch (error) {
        const refusal = bypassValidationRefusal(op, plan, error);
        if (refusal !== undefined) return { executed: false, failure: refusal };
        const failure = rewriteFailure(op, error, position);
        if (failure === undefined) throw error;
        wrote();
        return { executed: false, failure };
      }
    }

    if (runPostchecks && op.postcheck.length > 0) {
      const passed = await this.evaluateDmlChecks(op.postcheck, filterEvaluator);
      if (!passed) {
        return {
          executed: false,
          failure:
            (await this.documentsStillMatchingFailure(op)) ??
            runnerFailure(
              'MIGRATION.POSTCHECK_FAILED',
              `Operation ${op.id} failed during postcheck`,
              {
                meta: { operationId: op.id, name: op.name },
              },
            ),
        };
      }
    }

    return { executed: true };
  }

  /**
   * The failure when a validator change's before-check, or the check before a collection's first
   * rewrite, finds documents the new validator rejects: how many, one `_id`, and the query that finds
   * them all.
   */
  private async documentsFailingValidatorRefusal(
    op: MongoMigrationPlanOperation,
    failed: MongoMigrationCheck,
    apply: {
      readonly ranOn: (collection: string) => readonly string[];
      readonly contract: MongoContract;
    },
  ): Promise<MongoMigrationRunnerResult | undefined> {
    if (isInspectionCheckSource(failed.source)) return undefined;
    const collMod = validatorSetBy(op);
    const earlyValidator = validatorCheckedBy(failed.source);
    const checked =
      op.meta?.checkDocuments !== undefined && earlyValidator !== undefined
        ? {
            collection: op.meta.checkDocuments.collection,
            validator: earlyValidator,
            beforeRewrites: true,
          }
        : collMod?.validator !== undefined
          ? { collection: collMod.collection, validator: collMod.validator, beforeRewrites: false }
          : undefined;
    if (checked === undefined) return undefined;
    const { collection, validator, beforeRewrites } = checked;
    const failing = { $nor: [validator] };
    const counted = await this.firstRow({
      ...failed.source,
      command: new RawAggregateCommand(collection, [
        { $match: failing },
        { $group: { _id: null, documents: { $sum: 1 }, documentId: { $first: '$_id' } } },
      ]),
    });
    const documents = Number(counted?.['documents'] ?? 0);
    if (documents === 0) return undefined;
    const documentId = mongoshValue(counted?.['documentId']);
    const query = `db.getCollection(${JSON.stringify(collection)}).find(${JSON.stringify(failing)})`;
    const [current] = (
      await this.deps.inspectionExecutor.listCollections(new ListCollectionsCommand())
    ).filter((info) => info['name'] === collection);
    const options: unknown = current?.['options'];
    const validatorBefore: unknown =
      typeof options === 'object' && options !== null
        ? Reflect.get(options, 'validator')
        : undefined;
    const touched = fieldsTouched(
      Reflect.get(validatorBefore ?? {}, '$jsonSchema'),
      Reflect.get(validator, '$jsonSchema'),
    );
    const one = documents === 1;
    const documentObjectId = counted?.['documentId'];
    const fields = await this.fieldsOfDocument(
      failed.source,
      collection,
      documentObjectId,
      '$$ROOT',
    );
    const shape =
      fields.size === 0
        ? undefined
        : shapeOfDocument(fields, validatorDocumentShapesOf(Reflect.get(validator, '$jsonSchema')));
    const problems =
      shape === undefined
        ? []
        : await this.documentProblems(
            { source: failed.source, collection, id: documentObjectId },
            fields,
            shape,
            '',
          );
    const hadValidator = typeof validatorBefore === 'object' && validatorBefore !== null;
    const found = [
      `${touchedSentence(touched)}${one ? 'It has' : 'One of them has'} _id ${documentId}.`,
      ...(problems.length === 0
        ? []
        : [`That document ${joinedList(problems.map(({ text }) => text))}.`]),
      `Find them all with ${query} in mongosh.`,
    ];
    const uncheckable = problems.length > 0 && problems.every((problem) => problem.uncheckable);
    const advice = uncheckable
      ? [
          'A document that holds such a field can never fit the validator, so changing the documents does not help: store the field under a name without "." that does not start with "$".',
        ]
      : hadValidator
        ? [
            ...backfillAdvice(apply.contract, collection, touched.requires, {
              timeSeries:
                typeof options === 'object' &&
                options !== null &&
                Reflect.get(options, 'timeseries') !== undefined,
              validator: Reflect.get(validatorBefore ?? {}, '$jsonSchema'),
            }),
            byHandAdvice(collection),
          ]
        : ['Change them with a dataTransform in migration.ts, or with an update in mongosh.'];
    const ran = apply.ranOn(collection);
    const why = beforeRewrites
      ? [
          ...found,
          `No rewrite of this plan changes what makes ${one ? 'it' : 'them'} fail, so nothing was rewritten.`,
          ...advice,
          `Under db migrate you can instead apply the validator over them: remove this checkDocuments call from that migration.ts, set checkDocuments to false on the validator change, run the file with node, and run db migrate again. db update writes no migration.ts, so there ${uncheckable ? 'store the field under another name' : 'fix the documents'} first.`,
          uncheckable
            ? 'Then run the command again.'
            : 'Once the documents are fixed, run the command again.',
        ].join(' ')
      : [
          ...found,
          ...advice,
          `Under db migrate you can instead apply the validator over them: set checkDocuments to false on this operation in that migration.ts, remove the checkDocuments call before the rewrites if the file has one, run the file with node, and run db migrate again. db update writes no migration.ts, so there ${uncheckable ? 'store the field under another name' : 'fix the documents'} first.`,
          'The validator was not changed.',
          ...(ran.length === 0
            ? []
            : [
                `These operations of this apply already changed collection ${collection} and stay applied: ${ran.join('; ')}.`,
              ]),
          `${uncheckable ? 'Then run the command again' : 'Once the documents are fixed, run the command again'}; operations that already ran are skipped.`,
        ].join(' ');
    return runnerFailure(
      'MIGRATION.PRECHECK_FAILED',
      `Operation ${op.id} stopped: ${documents} ${one ? 'document' : 'documents'} in collection ${collection} ${one ? 'does' : 'do'} not fit the new validator${beforeRewrites ? `, and no rewrite of this plan makes ${one ? 'it' : 'them'} fit` : ''}`,
      {
        why,
        meta: {
          operationId: op.id,
          documentsFailingValidator: {
            collection,
            documents,
            documentId,
            query,
            requires: touched.requires,
            retypes: touched.retypes,
          },
        },
      },
    );
  }

  /**
   * The failure when a rewrite's check still finds documents after its update: how many, one `_id`,
   * and the query that finds them all. Only a data transform's update is the user's to change.
   */
  private async documentsStillMatchingFailure(
    op: MongoDmlOperation,
  ): Promise<MongoMigrationRunnerResult | undefined> {
    const [check] = op.postcheck;
    const command = check?.source.command;
    if (check?.expect !== 'notExists' || !(command instanceof RawAggregateCommand))
      return undefined;
    const match: unknown = Reflect.get(command.pipeline[0] ?? {}, '$match');
    if (typeof match !== 'object' || match === null) return undefined;
    const counted = await this.firstRow({
      ...check.source,
      command: new RawAggregateCommand(command.collection, [
        { $match: match },
        { $group: { _id: null, documents: { $sum: 1 }, documentId: { $first: '$_id' } } },
      ]),
    });
    const documents = Number(counted?.['documents'] ?? 0);
    if (documents === 0) return undefined;
    const one = documents === 1;
    const documentId = mongoshValue(counted?.['documentId']);
    const query = `db.getCollection(${JSON.stringify(command.collection)}).find(${JSON.stringify(match)})`;
    return runnerFailure(
      'MIGRATION.POSTCHECK_FAILED',
      `Operation ${op.id} failed: after its update, ${documents} ${one ? 'document' : 'documents'} in collection ${command.collection} still ${one ? 'matches' : 'match'} its check`,
      {
        why: [
          `${one ? 'It has' : 'One of them has'} _id ${documentId}. Find them all with ${query} in mongosh.`,
          op.operationClass === 'data'
            ? "Change the update in the migration's migration.ts so it changes them too, run the file with node, then run the command again; operations that already ran are skipped."
            : 'The update this operation runs did not change them: another client may have written them during the apply, or the value it writes does not pass its own check. Run the command again; operations that already ran are skipped. If they are still found, change them by hand.',
        ].join(' '),
        meta: {
          operationId: op.id,
          name: op.name,
          documentsStillMatching: { collection: command.collection, documents, documentId, query },
        },
      },
    );
  }

  /**
   * Why a document does not fit a validator, against `shape`: the required fields it lacks, the
   * fields whose type the validator does not allow, the fields a closed validator does not name, and
   * the same inside each embedded document the validator describes, such as a value object.
   */
  private async documentProblems(
    document: {
      readonly source: MongoQueryPlan;
      readonly collection: string;
      readonly id: unknown;
    },
    fields: ReadonlyMap<string, DocumentField>,
    shape: FieldsShape,
    path: string,
  ): Promise<readonly DocumentProblem[]> {
    const nested = await Promise.all(
      [...fields].map(async ([field, { type }]) => {
        const nestedShape = type === 'object' ? nestedShapeOf(shape.properties[field]) : undefined;
        if (nestedShape === undefined) return [];
        const nestedPath = `${path}${field}`;
        const nestedFields = await this.fieldsOfDocument(
          document.source,
          document.collection,
          document.id,
          `$${nestedPath}`,
        );
        return this.documentProblems(document, nestedFields, nestedShape, `${nestedPath}.`);
      }),
    );
    return [...problemsAgainst(fields, shape, path), ...nested.flat()];
  }

  /**
   * Each field of the document with `_id`, at `input`, `$$ROOT` or the path of an embedded document:
   * its BSON type, read with `$type`, and its value.
   */
  private async fieldsOfDocument(
    source: MongoQueryPlan,
    collection: string,
    id: unknown,
    input: string,
  ): Promise<ReadonlyMap<string, DocumentField>> {
    const row = await this.firstRow({
      ...source,
      command: new RawAggregateCommand(collection, [
        { $match: { _id: id } },
        { $limit: 1 },
        {
          $project: {
            _id: 0,
            fields: {
              $map: {
                input: { $objectToArray: input },
                in: ['$$this.k', { $type: '$$this.v' }, '$$this.v'],
              },
            },
          },
        },
      ]),
    });
    const fields: unknown = row?.['fields'];
    return new Map(
      (Array.isArray(fields) ? fields : []).flatMap((entry): [string, DocumentField][] =>
        Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string'
          ? [[entry[0], { type: entry[1], value: entry[2] }]]
          : [],
      ),
    );
  }

  private async firstRow(plan: MongoQueryPlan): Promise<Record<string, unknown> | undefined> {
    const wireCommand = await this.deps.adapter.lower(plan, {});
    for await (const row of this.deps.driver.execute<Record<string, unknown>>(wireCommand)) {
      return row;
    }
    return undefined;
  }

  private async evaluateDmlChecks(
    checks: readonly MongoDmlCheck[],
    filterEvaluator: FilterEvaluator,
  ): Promise<boolean> {
    for (const check of checks) {
      const matchFound = await this.documentsMatch(check, check.source, filterEvaluator);
      const passed = check.expect === 'exists' ? matchFound : !matchFound;
      if (!passed) return false;
    }
    return true;
  }

  private async documentsMatch(
    check: { readonly description: string; readonly filter: MongoFilterExpr },
    source: MongoQueryPlan,
    filterEvaluator: FilterEvaluator,
  ): Promise<boolean> {
    const commandKind = source.command.kind;
    if (!READ_ONLY_CHECK_COMMAND_KINDS.has(commandKind)) {
      throw mongoTargetError(
        'MIGRATION.DATA_TRANSFORM_CHECK_NOT_READ_ONLY',
        `Migration check rejected: command kind "${commandKind}" is not read-only`,
        {
          why: 'A migration check must read with an aggregate or rawAggregate command, so that running it cannot change the database.',
          fix: "Write the check's source as an aggregate or rawAggregate pipeline, not a command that writes.",
          meta: {
            checkDescription: check.description,
            commandKind,
            collection: source.collection,
          },
        },
      );
    }
    const wireCommand = await this.deps.adapter.lower(source, {});
    for await (const row of this.deps.driver.execute<Record<string, unknown>>(wireCommand)) {
      if (filterEvaluator.evaluate(check.filter, row)) return true;
    }
    return false;
  }

  private async evaluateChecks(
    checks: readonly MongoMigrationCheck[],
    inspectionExecutor: MongoInspectionCommandVisitor<Promise<Record<string, unknown>[]>>,
    filterEvaluator: FilterEvaluator,
  ): Promise<boolean> {
    return (
      (await this.firstFailingCheck(checks, inspectionExecutor, filterEvaluator)) === undefined
    );
  }

  private async firstFailingCheck(
    checks: readonly MongoMigrationCheck[],
    inspectionExecutor: MongoInspectionCommandVisitor<Promise<Record<string, unknown>[]>>,
    filterEvaluator: FilterEvaluator,
  ): Promise<MongoMigrationCheck | undefined> {
    for (const check of checks) {
      const matchFound = isInspectionCheckSource(check.source)
        ? (await check.source.accept(inspectionExecutor)).some((doc) =>
            filterEvaluator.evaluate(check.filter, doc),
          )
        : await this.documentsMatch(check, check.source, filterEvaluator);
      const passed = check.expect === 'exists' ? matchFound : !matchFound;
      if (!passed) return check;
    }
    return undefined;
  }

  private async allChecksSatisfied(
    checks: readonly MongoMigrationCheck[],
    inspectionExecutor: MongoInspectionCommandVisitor<Promise<Record<string, unknown>[]>>,
    filterEvaluator: FilterEvaluator,
  ): Promise<boolean> {
    if (checks.length === 0) return false;
    return this.evaluateChecks(checks, inspectionExecutor, filterEvaluator);
  }

  private enforcePolicyCompatibility(
    policy: MigrationOperationPolicy,
    operations: readonly AnyMongoMigrationOperation[],
  ): MongoMigrationRunnerResult | undefined {
    const allowedClasses = new Set(policy.allowedOperationClasses);
    for (const operation of operations) {
      if (!allowedClasses.has(operation.operationClass)) {
        return runnerFailure(
          'MIGRATION.POLICY_VIOLATION',
          `Operation ${operation.id} has class "${operation.operationClass}" which is not allowed by policy.`,
          {
            why: `Policy only allows: ${[...allowedClasses].join(', ')}.`,
            meta: {
              operationId: operation.id,
              operationClass: operation.operationClass,
            },
          },
        );
      }
    }
    return undefined;
  }

  private ensureMarkerCompatibility(
    marker: ContractMarkerRecord | null,
    plan: MigrationPlan,
  ): MongoMigrationRunnerResult | undefined {
    const origin = plan.origin ?? null;
    if (!origin) {
      // No origin assertion on the plan — the caller has done its own
      // correctness check (typically `db update` via live-schema
      // introspection) and does not rely on marker continuity.
      return undefined;
    }

    if (!marker) {
      return runnerFailure(
        'MIGRATION.MARKER_ORIGIN_MISMATCH',
        `Missing contract marker: expected origin storage hash ${origin.storageHash}.`,
        { meta: { expectedOriginStorageHash: origin.storageHash } },
      );
    }

    if (marker.storageHash !== origin.storageHash) {
      return runnerFailure(
        'MIGRATION.MARKER_ORIGIN_MISMATCH',
        `Existing contract marker (${marker.storageHash}) does not match plan origin (${origin.storageHash}).`,
        {
          meta: {
            markerStorageHash: marker.storageHash,
            expectedOriginStorageHash: origin.storageHash,
          },
        },
      );
    }

    return undefined;
  }
}
