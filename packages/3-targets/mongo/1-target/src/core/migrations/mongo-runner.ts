import { asNamespaceId, type ContractMarkerRecord } from '@internal/contract/types';
import { errorMarkerPoliciesCorrupt } from '@internal/errors/execution';
import { fieldRewriteOf, markerSwapFailure } from '@internal/family-mongo/control';
import type {
  MarkerOperations,
  MongoRunnerDependencies,
} from '@internal/family-mongo/control-adapter';
import { verifyMongoSchema } from '@internal/family-mongo/schema-verify';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import {
  APP_SPACE_ID,
  compareMarkerDatabasePolicies,
  type DatabasePolicies,
  databasePoliciesMovedFailure,
  enumValueCoordinateFromJson,
  enumValueStatementText,
  expectAbsent,
  expectPresent,
  type FailedCheck,
  failedPostcheckWhy,
  failedPrecheckWhy,
  fieldStatementText,
  type KeepDataEdit,
  type MarkerDestination,
  type MigrationOperationPolicy,
  type MigrationPlan,
  type MigrationPlanOperation,
  type MigrationRunnerExecutionChecks,
  type MigrationRunnerFailure,
  type MigrationRunnerFailureMeta,
  type MigrationRunnerPerSpaceOptions,
  type MigrationRunnerPerSpaceSuccessValue,
  type MigrationSubject,
  migrationRunnerFailure,
  migrationSubjectKey,
  type OperationContext,
  type RowsWithoutValue,
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
  sameKindOfDocumentIn,
  selectedVariantOf,
  type ValidatorDiscriminator,
  type ValidatorDocumentShape,
  validatorDocumentShapesOf,
  validatorRootShapesOf,
} from '@internal/mongo-contract';
import type { MongoAdapter, MongoQueryable } from '@internal/mongo-lowering';
import type {
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
  CreateCollectionCommand,
  CreateIndexCommand,
  isInspectionCheckSource,
  isMongoDmlOperation,
  ListCollectionsCommand,
  MongoExistsExpr,
  RenameCollectionCommand,
} from '@internal/mongo-query-ast/control';
import {
  AggregateCommand,
  type MongoQueryPlan,
  RawAggregateCommand,
  RawUpdateManyCommand,
} from '@internal/mongo-query-ast/execution';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, okVoid, type Result } from '@internal/utils/result';
import { type MongoMigrationRunnerErrorCode, mongoTargetError } from '../mongo-target-errors';
import { FilterEvaluator } from './filter-evaluator';
import {
  type RemoveStoredValueOptions,
  unrewritableFieldNameReason,
  unrewritableKeyReason,
} from './migration-factories';
import { deserializeMongoOps } from './mongo-ops-serializer';
import { byHandRenamePlacement } from './mongo-plan-text';
import { type RewriteCollection, rewriteRefusals } from './mongo-rewrite-refusals';
import { storedKeyFieldAt } from './mongo-stored-key-fills';
import { callInSentence, RemoveStoredValueCall, ReplaceStoredValueCall } from './op-factory-call';
import {
  documentsWithObject,
  type JsonPathStep,
  jsonPathText,
  keysOf,
  lacksKey,
  storedKeyPath,
} from './stored-key-path';

const READ_ONLY_CHECK_COMMAND_KINDS: ReadonlySet<string> = new Set(['aggregate', 'rawAggregate']);

const WRITING_STAGES: readonly string[] = ['$out', '$merge'];

/** The stage of an aggregate's pipeline that writes, `$out` or `$merge`, if it has one. */
function writingStageOf(command: MongoQueryPlan['command']): string | undefined {
  if (command instanceof RawAggregateCommand) {
    return command.pipeline
      .flatMap((stage) => WRITING_STAGES.filter((name) => Object.hasOwn(stage, name)))
      .at(0);
  }
  if (command instanceof AggregateCommand) {
    return command.pipeline
      .map((stage) => `$${stage.kind}`)
      .find((name) => WRITING_STAGES.includes(name));
  }
  return undefined;
}

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

export interface MongoMigrationRunnerExecuteOptions
  extends Pick<MigrationRunnerPerSpaceOptions, 'databasePolicies'> {
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
  /** The policies the run checked; the application space's marker is written only while its policies read as these. */
  readonly checkedPolicies?: DatabasePolicies;
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

function storageHashMovedFailure(
  space: string,
  expectedFrom: string,
  found: ContractMarkerRecord | null,
  destination: MarkerDestination,
): MongoMigrationRunnerFailure & { readonly code: 'MIGRATION.MARKER_CAS_FAILURE' } {
  return migrationRunnerFailure(
    'MIGRATION.MARKER_CAS_FAILURE',
    'Marker was modified by another process during migration execution.',
    {
      meta: {
        reason: 'storageHash',
        space,
        expectedStorageHash: expectedFrom,
        foundStorageHash: found?.storageHash ?? null,
        destinationStorageHash: destination.storageHash,
      },
    },
  );
}

function markerChangedFailure(
  space: string,
  expectedFrom: string,
  destination: MarkerDestination,
): MongoMigrationRunnerFailure & { readonly code: 'MIGRATION.MARKER_CAS_FAILURE' } {
  return migrationRunnerFailure(
    'MIGRATION.MARKER_CAS_FAILURE',
    'Marker was modified by another process during migration execution.',
    {
      why: 'Another process changed the marker and changed it back while this run was writing it. Run the command again.',
      meta: {
        reason: 'markerChanged',
        space,
        expectedStorageHash: expectedFrom,
        destinationStorageHash: destination.storageHash,
      },
    },
  );
}

/** The mongosh query that finds the documents a DML operation's first precheck matches. */
function precheckFind(op: MongoDmlOperation, collection: string): string {
  const source = op.precheck[0]?.source.command;
  const match: unknown =
    source instanceof RawAggregateCommand
      ? Reflect.get(source.pipeline[0] ?? {}, '$match')
      : undefined;
  return `db.getCollection(${JSON.stringify(collection)}).find(${JSON.stringify(match ?? {})})`;
}

/**
 * The failure when a field rename's before-check finds documents that already hold the new name,
 * which `$rename` would overwrite: what to look for and fix, and that the plan resumes.
 */
function renameOverwriteRefusal(
  op: MongoDmlOperation,
  before: readonly AnyMongoMigrationOperation[],
): MongoMigrationRunnerResult | undefined {
  const rewrite = fieldRewriteOf(op);
  if (rewrite === undefined) return undefined;
  const renames: unknown = Reflect.get(rewrite.command.update, '$rename');
  const to: unknown =
    typeof renames === 'object' && renames !== null
      ? Reflect.get(renames, rewrite.field)
      : undefined;
  if (typeof to !== 'string') return undefined;
  const find = precheckFind(op, rewrite.collection);
  return runnerFailure(
    'MIGRATION.PRECHECK_FAILED',
    `Operation ${op.id} stopped: some documents in collection ${rewrite.collection} already hold ${to} as well as ${rewrite.field}`,
    {
      why: `Renaming ${rewrite.field} to ${to} would overwrite their ${to}. Find them with ${find} in mongosh, and move or remove one of the two values in each. ${rerunText('Once the documents are fixed, run the command again', before)}`,
      meta: { operationId: op.id, name: op.name },
    },
  );
}

/**
 * The failure when a key rename's before-check finds objects that already hold the new key, which
 * the rename would overwrite: how to find them, and that the plan resumes.
 */
function storedKeyRenameRefusal(
  op: MongoDmlOperation,
  before: readonly AnyMongoMigrationOperation[],
): MongoMigrationRunnerResult | undefined {
  const rewrite = op.meta?.rewrite;
  if (rewrite?.kind !== 'renameStoredKey') return undefined;
  const keyPath = storedKeyPath(rewrite.field, rewrite.path);
  if (!keyPath.ok) return undefined;
  const from = JSON.stringify(keyPath.value.key);
  const to = JSON.stringify(rewrite.to);
  return runnerFailure(
    'MIGRATION.PRECHECK_FAILED',
    `Operation ${op.id} stopped: some objects at path ${JSON.stringify(keyPath.value.objectsText)} in field ${rewrite.field} of collection ${rewrite.collection} already hold key ${to} as well as key ${from}`,
    {
      why: `Renaming key ${from} to ${to} would overwrite their ${to}. Find them with ${precheckFind(op, rewrite.collection)} in mongosh, and remove one of the two keys from each of those objects. ${rerunText('Once the documents are fixed, run the command again', before)}`,
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
  before: readonly AnyMongoMigrationOperation[],
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
      why: `${rerunText(`If ${to} holds nothing you need, drop it, then run the command again`, before)} If an earlier operation of the same migration created ${to}, as a createIndex on ${to} does, in its migration.ts ${byHandRenamePlacement(from, to)}, run node on that migration.ts, and then drop ${to} and run the command again. If ${to} is a temporary name that a refused rename suggested, you can instead delete this migration, give the model another temporary name that the database does not have, and plan again.`,
      meta: { operationId: op.id },
    },
  );
}

/**
 * The failure when a create's before-check finds a collection of that name, which the create's
 * after-check did not take as the one it makes: made another way, with other options.
 */
function createTargetExistsRefusal(
  op: MongoMigrationPlanOperation,
  failed: MongoMigrationCheck,
  before: readonly AnyMongoMigrationOperation[],
): MongoMigrationRunnerResult | undefined {
  const create = op.execute.find(
    (step) => step.command instanceof CreateCollectionCommand,
  )?.command;
  if (!(create instanceof CreateCollectionCommand) || failed.expect !== 'notExists') {
    return undefined;
  }
  const name = create.collection;
  return runnerFailure(
    'MIGRATION.PRECHECK_FAILED',
    `Operation ${op.id} stopped: collection ${name} already exists without the options this migration creates it with`,
    {
      why: `${rerunText(`If ${name} holds nothing you need, drop it, then run the command again`, before)} Otherwise give it the options the createCollection call of this migration's migration.ts sets, ${create.validator === undefined ? 'and no validator, since that call sets none' : 'its validator among them'}, and run the command again: the creation is then skipped.`,
      meta: { operationId: op.id },
    },
  );
}

/**
 * What a re-run of a data transform's update that stopped part way does with the documents it
 * already changed. An update whose filter is the `$match` of its check, as the transforms the
 * planner writes for `--convert` and `--backfill` are, runs again only over the documents that
 * filter still selects. Whether a changed document left the filter depends on the update, which the
 * user writes, so the text says what happens either way.
 */
function updateRerunText(op: MongoDmlOperation, plan: MongoQueryPlan): string {
  return runFilterIsCheckFilter(op, plan)
    ? 'When the command runs again, this update changes only the documents its filter still selects, the same documents its check finds. A document it already took out of that filter is not changed again. A document it changed but left inside that filter, as an update of only other fields does, is changed again.'
    : 'When the command runs again, this update runs again over every document its filter selects then. If that filter still selects documents it already changed, make the update give the same result when it runs twice, or restore those documents before you run the command again.';
}

function runFilterIsCheckFilter(op: MongoDmlOperation, plan: MongoQueryPlan): boolean {
  const run = plan.command;
  if (!(run instanceof RawUpdateManyCommand) || op.postcheck.length !== 1) return false;
  const [check] = op.postcheck;
  const source = check?.source.command;
  if (
    check?.expect !== 'notExists' ||
    !(
      check.filter instanceof MongoExistsExpr &&
      check.filter.field === '_id' &&
      check.filter.exists
    ) ||
    !(source instanceof RawAggregateCommand) ||
    source.collection !== run.collection
  ) {
    return false;
  }
  const [first, ...rest] = source.pipeline;
  return (
    first !== undefined &&
    canonicalize(Reflect.get(first, '$match')) === canonicalize(run.filter) &&
    rest.every((stage) => Object.keys(stage).length === 1 && Object.hasOwn(stage, '$limit'))
  );
}

/**
 * The sentence that says to run the command again, and what a re-run does with the operations
 * `before` the one that stopped: those whose check shows they ran are skipped, and one with no
 * check, such as a copy in a dataTransform, runs again.
 */
function rerunText(runAgain: string, before: readonly AnyMongoMigrationOperation[]): string {
  return before.some((operation) => operation.postcheck.length === 0)
    ? `${runAgain}. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again.`
    : `${runAgain}; operations that already ran are skipped.`;
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
  const outsideEnum = [...fields].flatMap(([field, { value }]) => {
    const allowed: unknown = Reflect.get(Object(shape.properties[field]), 'enum');
    return !Array.isArray(allowed) ||
      allowed.some((member) => canonicalize(member) === canonicalize(value))
      ? []
      : [
          `holds ${mongoshValue(value)} in ${named(field)}, a value the new validator does not allow there`,
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
    ...[...missing, ...retyped, ...outsideEnum, ...undeclared].map((text) => ({
      text,
      uncheckable: false,
    })),
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
 * required, one for each field the planner would accept the statement for, as its rewrite refusals
 * and stored name rules say; and each such field as `rowsWithoutValue`, from which the caller gives
 * the steps that plan the change with them. A field only new variants require gets its value in
 * the update of the discriminator's backfill, or later by its own.
 */
function backfillAdvice(
  contract: MongoContract,
  lacking: { readonly collection: string; readonly documents: ReadonlyMap<string, number> },
  touched: TouchedFields,
  rewriteCollection: RewriteCollection,
  position: { readonly operationIndex: number; readonly renamed: ReadonlySet<string> },
): {
  readonly sentences: readonly string[];
  readonly rowsWithoutValue: readonly RowsWithoutValue[];
} {
  const lackingFields = [...lacking.documents.keys()].filter(
    (field) => !position.renamed.has(field),
  );
  const accepted = backfillStatements(
    contract,
    lacking.collection,
    lackingFields.filter((field) => !touched.ofNewVariants.has(field)),
    touched.keys,
    rewriteCollection,
  );
  if (accepted.length === 0) return { sentences: [], rowsWithoutValue: [] };
  const statements = [...new Set(accepted.map(({ statement }) => `--backfill ${statement}`))];
  const subjects = new Map(
    accepted.map(({ stored, subject }) => [
      migrationSubjectKey(subject),
      { subject, documents: lacking.documents.get(stored) ?? 0 },
    ]),
  );
  return {
    sentences: [
      `To give ${quotedList(accepted.map(({ stored }) => stored))} values you choose, plan the change with ${statements.join(' ')}, as the steps to take describe.`,
      ...newVariantFieldsAdvice(
        contract,
        lacking.collection,
        lackingFields.flatMap((field) => {
          const discriminator = touched.ofNewVariants.get(field);
          return discriminator === undefined ? [] : [{ field, discriminator }];
        }),
        accepted,
      ),
    ],
    rowsWithoutValue: [...subjects.values()].map(({ subject, documents }) => ({
      field: subject,
      reason: 'newField',
      rows: documents,
      operationIndex: position.operationIndex,
    })),
  };
}

/**
 * How fields that only new variants require get values: the update of the discriminator's
 * `--backfill` sets them where it gives a variant's value, or they stay optional until a later
 * change, when their variant has documents, makes them required with their own `--backfill`.
 */
function newVariantFieldsAdvice(
  contract: MongoContract,
  collection: string,
  fields: readonly { readonly field: string; readonly discriminator: ValidatorDiscriminator }[],
  accepted: readonly { readonly stored: string; readonly statement: string }[],
): readonly string[] {
  const [first] = fields;
  const discriminatorBackfill =
    first === undefined
      ? undefined
      : accepted.find(({ stored }) => stored === first.discriminator.field);
  if (first === undefined || discriminatorBackfill === undefined) return [];
  const values = [...new Set(fields.map(({ discriminator }) => discriminator.value))];
  const where = values.map((value) => {
    const named = fields.filter(({ discriminator }) => discriminator.value === value);
    return `${quotedList(named.map(({ field }) => field))} in the documents it gives value ${JSON.stringify(value)}`;
  });
  const example = fields
    .filter(({ discriminator }) => discriminator.value === first.discriminator.value)
    .map(({ field }) => `${field}: <value>`);
  const later = fields.flatMap(({ field }) => {
    const subject = fieldStoredAt(contract, collection, field);
    return subject.kind === 'field' ? [`--backfill ${fieldStatementText(contract, subject)}`] : [];
  });
  const them = fields.length === 1 ? 'it' : 'them';
  return [
    `The update you write for --backfill ${discriminatorBackfill.statement} can also set ${joinedList(where)}, such as { $set: { ${first.discriminator.field}: ${JSON.stringify(first.discriminator.value)}, ${example.join(', ')} } }.`,
    `Or keep ${quotedList(fields.map(({ field }) => field))} optional until a later change, which can make ${them} required${later.length === 0 ? '' : ` with ${later.join(' ')}`}.`,
  ];
}

/**
 * The fields and nested keys, by their dotted stored paths such as `home.line1`, to which a rename
 * of the plan gives its new name in `collection`. Such a field was required under its old name, so
 * a document without it lacked the old one too: it needs fixing, not a `--backfill`.
 */
function renamedInto(
  operations: readonly AnyMongoMigrationOperation[],
  collection: string,
): ReadonlySet<string> {
  return new Set(
    operations.flatMap((operation): readonly string[] => {
      if (!isMongoDmlOperation(operation)) return [];
      const rewrite = operation.meta?.rewrite;
      if (rewrite?.kind === 'renameStoredKey') {
        if (rewrite.collection !== collection) return [];
        const parsed = storedKeyPath(rewrite.field, rewrite.path);
        if (!parsed.ok) return [];
        return [[rewrite.field, ...keysOf(parsed.value).slice(0, -1), rewrite.to].join('.')];
      }
      const renamed = fieldRewriteOf(operation);
      if (renamed === undefined || renamed.collection !== collection) return [];
      const names: unknown = Reflect.get(renamed.command.update, '$rename');
      return isRecord(names)
        ? Object.values(names).filter((name): name is string => typeof name === 'string')
        : [];
    }),
  );
}

/** The `--backfill` statement of a nested key, by the field of a value object or an embedded model stored there, and that field, when the planner would accept it. */
function nestedBackfillStatement(
  contract: MongoContract,
  collection: string,
  key: RequiredKey,
  rewriteCollection: RewriteCollection,
): { readonly statement: string; readonly subject: MigrationSubject } | undefined {
  const parsed = storedKeyPath(key.field, key.path);
  if (!parsed.ok) return undefined;
  const names = [
    key.field,
    ...parsed.value.path.steps.flatMap((step) => (step.kind === 'member' ? [step.name] : [])),
  ];
  if (names.some((name) => unrewritableKeyReason(name) !== undefined)) return undefined;
  const found = storedKeyFieldAt(contract, { collection, ...key });
  if (found === undefined) return undefined;
  const refusals = rewriteRefusals(
    {
      kind: 'fillStoredKey',
      collection,
      field: key.field,
      variant: found.place.variant,
      model: found.place.model,
      storedKey: { key: found.text, together: [] },
      keepAdvice: undefined,
      renameStatement: undefined,
    },
    contract,
    rewriteCollection,
    undefined,
  );
  return refusals.length === 0 ? { statement: found.text, subject: found.subject } : undefined;
}

/** The `--backfill` statement of each of `fields` the planner would accept it for, with the field's stored name. */
function backfillStatements(
  contract: MongoContract,
  collection: string,
  fields: readonly string[],
  keys: ReadonlyMap<string, RequiredKey>,
  rewriteCollection: RewriteCollection,
): readonly {
  readonly stored: string;
  readonly statement: string;
  readonly subject: MigrationSubject;
}[] {
  return fields.flatMap((stored) => {
    const key = keys.get(stored);
    if (key !== undefined) {
      const found = nestedBackfillStatement(contract, collection, key, rewriteCollection);
      return found === undefined ? [] : [{ stored, ...found }];
    }
    if (unrewritableFieldNameReason(stored) !== undefined) return [];
    const field = fieldStoredAt(contract, collection, stored);
    if (field.kind !== 'field') return [];
    const model = { namespaceId: field.namespaceId, model: field.model };
    const refusals = rewriteRefusals(
      {
        kind: 'backfill',
        collection,
        field: stored,
        variant: selectedVariantOf(contract.domain, model),
        model,
        storedKey: undefined,
        keepAdvice: undefined,
        renameStatement: undefined,
      },
      contract,
      rewriteCollection,
      undefined,
    );
    return refusals.length === 0
      ? [{ stored, statement: fieldStatementText(contract, field), subject: field }]
      : [];
  });
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

const ANY_VALUE = canonicalize({});

/** A key inside a root field's value that a validator change makes required: the root field, and the JSONPath from its value to the key. */
interface RequiredKey {
  readonly field: string;
  readonly path: string;
  readonly steps: readonly JsonPathStep[];
}

/** What a validator change touches: the fields and nested keys it makes required, each by its dotted stored path such as `home.seen`, and the fields whose accepted values it changes. */
interface TouchedFields {
  readonly requires: readonly string[];
  readonly retypes: readonly string[];
  /** Each nested key of `requires`, by its dotted path. */
  readonly keys: ReadonlyMap<string, RequiredKey>;
  /**
   * Each field of `requires` that only variants new to the collection require, with the
   * discriminator of the first such variant. Its documents become that variant only when they get
   * its discriminator value, so no `--backfill` of the field has documents to fill yet.
   */
  readonly ofNewVariants: ReadonlyMap<string, ValidatorDiscriminator>;
  /** The fields whose list elements the new validator accepts only as objects. */
  readonly objectLists: ReadonlySet<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The object schemas a property schema accepts: itself, or the branches of its `oneOf` or `anyOf`. */
function objectSchemasOf(schema: unknown): readonly Record<string, unknown>[] {
  if (!isRecord(schema)) return [];
  if (isRecord(schema['properties'])) return [schema];
  return [schema['oneOf'], schema['anyOf']]
    .flatMap((branches) => (Array.isArray(branches) ? branches : []))
    .flatMap(objectSchemasOf);
}

/** The element schema a property schema gives a list, itself or through its `oneOf` or `anyOf` branches. */
function itemsOf(schema: unknown): unknown {
  if (!isRecord(schema)) return undefined;
  if (schema['items'] !== undefined) return schema['items'];
  return [schema['oneOf'], schema['anyOf']]
    .flatMap((branches) => (Array.isArray(branches) ? branches : []))
    .map(itemsOf)
    .find((items) => items !== undefined);
}

function requiredOf(schema: Record<string, unknown>): ReadonlySet<string> {
  const required = schema['required'];
  return new Set(Array.isArray(required) ? required.filter((key) => typeof key === 'string') : []);
}

/** The keys below a property that the new schema requires and the old one, which also describes the objects there, did not. A union of object schemas is not compared. */
function nestedRequiredKeys(
  before: unknown,
  after: unknown,
  steps: readonly JsonPathStep[],
): readonly (readonly JsonPathStep[])[] {
  const [objectBefore, ...otherBefore] = objectSchemasOf(before);
  const [objectAfter, ...otherAfter] = objectSchemasOf(after);
  const inObjects =
    objectBefore === undefined ||
    objectAfter === undefined ||
    otherBefore.length > 0 ||
    otherAfter.length > 0
      ? []
      : [
          ...[...requiredOf(objectAfter)]
            .filter((key) => !requiredOf(objectBefore).has(key))
            .map((key): readonly JsonPathStep[] => [...steps, { kind: 'member', name: key }]),
          ...Object.entries(isRecord(objectAfter['properties']) ? objectAfter['properties'] : {})
            .filter(
              ([key]) =>
                isRecord(objectBefore['properties']) &&
                Object.hasOwn(objectBefore['properties'], key),
            )
            .flatMap(([key, schema]) =>
              nestedRequiredKeys(Reflect.get(objectBefore['properties'] ?? {}, key), schema, [
                ...steps,
                { kind: 'member', name: key },
              ]),
            ),
        ];
  const itemsBefore = itemsOf(before);
  const itemsAfter = itemsOf(after);
  return [
    ...inObjects,
    ...(itemsBefore === undefined || itemsAfter === undefined
      ? []
      : nestedRequiredKeys(itemsBefore, itemsAfter, [...steps, { kind: 'wildcard' }])),
  ];
}

/**
 * The fields a validator change makes required, and those whose accepted values it changes, each
 * kind of document compared with the same kind under the validator the collection has. Inside a field both validators describe, a
 * key of its objects or list elements that the change makes required is named by its dotted path. A kind the collection's validator does not describe is not
 * compared; with no validator, every field it requires is new.
 */
function fieldsTouched(before: unknown, after: unknown): TouchedFields {
  const shapesBefore = validatorDocumentShapesOf(before);
  const requires = new Set<string>();
  const retypes = new Set<string>();
  const keys = new Map<string, RequiredKey>();
  const ofOldKinds = new Set<string>();
  const ofNewVariants = new Map<string, ValidatorDiscriminator>();
  const objectLists = new Set<string>();
  const rootsAfter = validatorRootShapesOf(after);
  for (const shape of validatorDocumentShapesOf(after)) {
    const same = shapesBefore.length === 0 ? undefined : sameKindOfDocumentIn(shapesBefore, shape);
    if (shapesBefore.length > 0 && same === undefined) continue;
    const previous: Pick<ValidatorDocumentShape, 'required' | 'properties'> = same?.shape ?? {
      required: [],
      properties: {},
    };
    const ownedByRoot = new Set([
      ...(rootsAfter[shape.rootIndex]?.required ?? []),
      ...(shape.discriminator === undefined ? [] : [shape.discriminator.field]),
    ]);
    for (const field of shape.required) {
      if (field === '_id' || previous.required.includes(field)) continue;
      requires.add(field);
      if (
        same?.matchedBy === 'root' &&
        shape.discriminator !== undefined &&
        !ownedByRoot.has(field)
      ) {
        if (!ofNewVariants.has(field)) ofNewVariants.set(field, shape.discriminator);
      } else {
        ofOldKinds.add(field);
      }
    }
    for (const [field, schema] of Object.entries(shape.properties)) {
      const items = itemsOf(schema);
      if (isRecord(items) && isRecord(items['properties'])) objectLists.add(field);
      if (!Object.hasOwn(previous.properties, field)) continue;
      const schemaBefore = previous.properties[field];
      const canonical = canonicalize(schema);
      if (canonicalize(schemaBefore) !== canonical && canonical !== ANY_VALUE) retypes.add(field);
      for (const steps of nestedRequiredKeys(schemaBefore, schema, [])) {
        const names = steps.flatMap((step) => (step.kind === 'member' ? [step.name] : []));
        const dotted = [field, ...names].join('.');
        requires.add(dotted);
        keys.set(dotted, { field, path: jsonPathText(steps), steps });
      }
    }
  }
  return {
    requires: [...requires].sort(),
    retypes: [...retypes].filter((field) => !requires.has(field)).sort(),
    keys,
    ofNewVariants: new Map([...ofNewVariants].filter(([field]) => !ofOldKinds.has(field))),
    objectLists,
  };
}

function quotedList(fields: readonly string[]): string {
  const quoted = fields.map((field) => JSON.stringify(field));
  return quoted.length <= 1
    ? quoted.join('')
    : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
}

/** What a document holds at the objects a required key's steps lead to: an object without the key, or a list element that is not an object. */
function keyFindingsOf(
  value: unknown,
  steps: readonly JsonPathStep[],
): ReadonlySet<'lacks' | 'notObject'> {
  const [step, ...rest] = steps;
  if (step === undefined) return new Set();
  if (step.kind === 'wildcard') {
    if (!Array.isArray(value)) return new Set();
    return new Set(
      value.flatMap((element): ('lacks' | 'notObject')[] =>
        rest[0]?.kind === 'member' && !isRecord(element)
          ? ['notObject']
          : [...keyFindingsOf(element, rest)],
      ),
    );
  }
  if (!isRecord(value)) return new Set();
  if (!Object.hasOwn(value, step.name)) return new Set(rest.length === 0 ? ['lacks'] : []);
  return keyFindingsOf(value[step.name], rest);
}

/**
 * Of the nested keys a validator change makes required, those the document shown lacks, and the
 * fields whose list elements must be objects, or hold keys the change requires, that hold an
 * element that is not an object.
 */
function nestedFindings(
  touched: TouchedFields,
  shown: ReadonlyMap<string, DocumentField>,
): { readonly lacking: readonly string[]; readonly notObjects: readonly string[] } {
  const lacking: string[] = [];
  const notObjects = new Set<string>();
  for (const [dotted, key] of touched.keys) {
    const findings = keyFindingsOf(shown.get(key.field)?.value, key.steps);
    if (findings.has('lacks')) lacking.push(dotted);
    if (findings.has('notObject')) notObjects.add(key.field);
  }
  for (const field of touched.objectLists) {
    const value = shown.get(field)?.value;
    if (Array.isArray(value) && value.some((element) => !isRecord(element))) notObjects.add(field);
  }
  return { lacking, notObjects: [...notObjects].sort() };
}

/**
 * What a validator change touches, in words: `This validator change makes "plan" required.` Only
 * what the document shown breaks is named: the fields and nested keys it lacks, and the fields it
 * holds whose accepted values change.
 */
function touchedSentence(
  touched: TouchedFields,
  shown: ReadonlyMap<string, DocumentField>,
): string {
  const lackingNested = new Set(nestedFindings(touched, shown).lacking);
  const lacking = touched.requires.filter((field) =>
    touched.keys.has(field) ? lackingNested.has(field) : !shown.has(field),
  );
  const retypes = touched.retypes.filter((field) => shown.has(field));
  const parts = [
    ...(lacking.length === 0 ? [] : [`makes ${quotedList(lacking)} required`]),
    ...(retypes.length === 0
      ? []
      : [`changes what ${quotedList(retypes)} ${retypes.length === 1 ? 'accepts' : 'accept'}`]),
  ];
  return parts.length === 0 ? '' : `This validator change ${parts.join(' and ')}. `;
}

const MONGO_UNAUTHORIZED = 13;

/**
 * The failure for a rewrite or a copy that skips validation when the database user lacks the
 * `bypassDocumentValidation` action, as a `readWrite` user on a hosted cluster does.
 */
function bypassValidationRefusal(
  op: MongoDmlOperation,
  plan: MongoQueryPlan,
  error: unknown,
  before: readonly AnyMongoMigrationOperation[],
): MongoMigrationRunnerResult | undefined {
  const skipsValidation =
    (plan.command instanceof RawUpdateManyCommand || plan.command instanceof RawAggregateCommand) &&
    plan.command.bypassDocumentValidation === true;
  if (!skipsValidation) return undefined;
  if (typeof error !== 'object' || error === null) return undefined;
  if (Reflect.get(error, 'code') !== MONGO_UNAUTHORIZED) return undefined;
  const codeName: unknown = Reflect.get(error, 'codeName');
  return runnerFailure(
    'MIGRATION.EXECUTION_FAILED',
    `Operation ${op.id} failed: the database user may not skip document validation`,
    {
      why: `Rewriting or copying documents to fit the new schema skips document validation, because the old validator rejects the new shape. MongoDB refused it with error ${MONGO_UNAUTHORIZED} (${String(codeName)}). Grant the user the bypassDocumentValidation action on the database, for example with the dbAdmin or restore role. ${rerunText('Then run the command again', before)}`,
      meta: {
        operationId: op.id,
        mongoCode: MONGO_UNAUTHORIZED,
        codeName,
      },
    },
  );
}

/**
 * Compares the policies a caller checked with the application space's marker, before the run's
 * first operation. The application space's marker is later written only while they still hold.
 */
export async function checkDatabasePolicies(
  markerOps: MarkerOperations,
  checked: DatabasePolicies,
): Promise<Result<void, MongoMigrationRunnerFailure>> {
  const comparison = compareMarkerDatabasePolicies(
    await markerOps.readMarker(APP_SPACE_ID),
    checked,
  );
  switch (comparison.kind) {
    case 'held':
      return okVoid();
    case 'moved':
      return notOk(
        withDatabaseUnchanged(databasePoliciesMovedFailure(checked, comparison.found), true),
      );
    case 'unreadable':
      throw markerPoliciesCorrupt(markerOps, comparison.why);
  }
}

function markerPoliciesCorrupt(markerOps: MarkerOperations, why: string) {
  return errorMarkerPoliciesCorrupt({
    why,
    space: APP_SPACE_ID,
    markerLocation: markerOps.markerLocation,
  });
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
function rewriteErrorFix(
  mongoCode: number,
  reason: string,
  before: readonly AnyMongoMigrationOperation[],
): string | undefined {
  if (mongoCode !== MONGO_DUPLICATE_KEY) return undefined;
  const index = /index: (\S+)/.exec(reason)?.[1];
  const named = index === undefined ? 'a unique index' : `unique index ${JSON.stringify(index)}`;
  return `The rewrite would give two documents the same value under ${named}. ${rerunText('Change or remove the documents that would collide, then run the command again', before)}`;
}

/**
 * The failure when MongoDB cannot build a unique index because two documents hold the same value
 * of its keys, as documents without the field all hold `null`. The build changes nothing.
 */
/** The fields of a duplicate key MongoDB reports, when every one of them is `null` or missing. */
function nullKeyFields(error: object): readonly string[] {
  const keyValue: unknown = Reflect.get(error, 'keyValue');
  if (typeof keyValue !== 'object' || keyValue === null) return [];
  const entries = Object.entries(keyValue);
  return entries.length > 0 && entries.every(([, value]) => value === null)
    ? entries.map(([field]) => field)
    : [];
}

function isDuplicateKeyError(error: unknown): error is object {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === MONGO_DUPLICATE_KEY
  );
}

function indexBuildFailure(
  op: MongoMigrationPlanOperation,
  command: CreateIndexCommand,
  error: object,
  backfill: (fields: readonly string[]) => readonly string[],
  before: readonly AnyMongoMigrationOperation[],
): MongoMigrationRunnerResult {
  const reason = mongoErrorText(error);
  const duplicate = /dup key: (\{.*\})/.exec(reason)?.[1];
  const index = command.name ?? defaultMongoIndexName(command.keys);
  const lacking = nullKeyFields(error);
  const statements = backfill(lacking);
  const why = [
    lacking.length === 0
      ? 'A document without the field counts as holding null.'
      : `The documents that collide lack ${quotedList(lacking)} or hold null in ${lacking.length === 1 ? 'it' : 'them'}, and a document without the field counts as holding null.`,
    rerunText(
      'Give each document its own value of the indexed fields, or remove the duplicates, then run the command again',
      before,
    ),
    ...(statements.length === 0
      ? []
      : [
          `Under migration plan, ${statements.join(' ')} writes a slot to give each document its own value.`,
        ]),
  ].join(' ');
  return runnerFailure(
    'MIGRATION.EXECUTION_FAILED',
    `Operation ${op.id} failed: the unique index ${index} cannot be built, because two documents in collection ${command.collection} hold the same value${duplicate === undefined ? '' : ` ${duplicate}`}`,
    {
      why,
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

const MONGO_DOCUMENT_VALIDATION = 121;

/** Where a data operation runs: its index in the migration's operations, the destination contract, and those operations. */
interface DmlPosition {
  readonly operationIndex: number;
  readonly contract: MongoContract;
  readonly plan: readonly AnyMongoMigrationOperation[];
}

/** The collection a raw aggregate's `$merge` or `$out` stage writes into, with its database when the stage names one. */
interface CopyTarget {
  readonly stage: '$merge' | '$out';
  readonly collection: string;
  readonly database: string | undefined;
}

function namespaceTarget(stage: CopyTarget['stage'], into: unknown): CopyTarget | undefined {
  if (typeof into === 'string') return { stage, collection: into, database: undefined };
  if (typeof into !== 'object' || into === null) return undefined;
  const coll: unknown = Reflect.get(into, 'coll');
  const db: unknown = Reflect.get(into, 'db');
  return typeof coll === 'string'
    ? { stage, collection: coll, database: typeof db === 'string' ? db : undefined }
    : undefined;
}

function copyTargetOf(plan: MongoQueryPlan): CopyTarget | undefined {
  if (!(plan.command instanceof RawAggregateCommand)) return undefined;
  for (const stage of plan.command.pipeline) {
    const merge: unknown = Reflect.get(stage, '$merge');
    if (merge !== undefined) {
      return namespaceTarget(
        '$merge',
        typeof merge === 'object' && merge !== null && Object.hasOwn(merge, 'into')
          ? Reflect.get(merge, 'into')
          : merge,
      );
    }
    const out: unknown = Reflect.get(stage, '$out');
    if (out !== undefined) return namespaceTarget('$out', out);
  }
  return undefined;
}

/** What a later operation of the migration does to the validator of the collection a copy writes into, and the name the collection has by then. */
type LaterValidator =
  | { readonly kind: 'replaced' | 'unchecked' | 'removed'; readonly collection: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'unknown' };

/**
 * What a later operation of the migration does to the validator of the collection a copy writes
 * into, following the renames of that collection: unknown for a collection in another database,
 * whose validator the migration's operations do not touch, so the runner cannot tell.
 */
function laterValidator(
  target: CopyTarget,
  later: readonly AnyMongoMigrationOperation[],
): LaterValidator {
  if (target.database !== undefined) return { kind: 'unknown' };
  let collection = target.collection;
  for (const operation of later) {
    if (isMongoDmlOperation(operation)) continue;
    for (const { command } of operation.execute) {
      if (command instanceof RenameCollectionCommand && command.collection === collection) {
        collection = command.to;
      }
      if (
        command instanceof CollModCommand &&
        command.collection === collection &&
        command.validator !== undefined
      ) {
        if (Object.keys(command.validator).length === 0) return { kind: 'removed', collection };
        return {
          kind: checksDocumentsOf(operation, collection, command.validator)
            ? 'replaced'
            : 'unchecked',
          collection,
        };
      }
    }
  }
  return { kind: 'none' };
}

/** Whether `operation` checks, before it runs, that no document of `collection` fails `validator`: a precheck that finds no document matching `{ $nor: [validator] }`. */
function checksDocumentsOf(
  operation: MongoMigrationPlanOperation,
  collection: string,
  validator: Readonly<Record<string, unknown>>,
): boolean {
  const rejected = canonicalize({ $nor: [validator] });
  return operation.precheck.some((check) => {
    const { source } = check;
    if (
      check.expect !== 'notExists' ||
      !('command' in source) ||
      !(source.command instanceof RawAggregateCommand) ||
      source.command.collection !== collection
    ) {
      return false;
    }
    const [first, ...rest] = source.command.pipeline;
    return (
      first !== undefined &&
      canonicalize(Reflect.get(first, '$match')) === rejected &&
      rest.every((stage) => Object.keys(stage).length === 1 && Object.hasOwn(stage, '$limit'))
    );
  });
}

/** The document the validator rejected, as MongoDB's error names it, and where it is in the copy's source. */
function rejectedDocumentText(error: object, source: string): string {
  const info: unknown = Reflect.get(error, 'errInfo');
  const id: unknown =
    typeof info === 'object' && info !== null ? Reflect.get(info, 'failingDocumentId') : undefined;
  if (id === undefined) return '';
  const value = mongoshValue(id);
  return ` The rejected document has _id ${value}: find it with db.getCollection(${JSON.stringify(source)}).find({ _id: ${value} }) in mongosh.`;
}

/** Why a copy failed when the validator of its target rejected a document it wrote, and the one change that fits the migration. */
function copyRejectedWhy(
  target: CopyTarget,
  failure: { readonly mongoError: string; readonly reason: string; readonly document: string },
  later: LaterValidator,
): string {
  const name =
    target.database === undefined ? target.collection : `${target.database}.${target.collection}`;
  const written =
    target.stage === '$merge'
      ? `Documents the copy wrote before the error stay in collection ${name}, and the copy runs again on a re-run.`
      : `Collection ${name} is as it was: an $out stage replaces it only when the whole pipeline succeeds.`;
  const bypass = `add { bypassDocumentValidation: true } as the last argument of the copy's rawAggregate call`;
  const node = 'run the file with node, then run the command again';
  const pipeline = `change the pipeline in the migration's migration.ts so the documents it writes fit the validator, ${node}`;
  const renamed = (collection: string) =>
    collection === target.collection ? '' : `, as collection ${collection}`;
  const orPipeline =
    failure.document === ''
      ? pipeline
      : `fix that document in its source and run the command again, or ${pipeline}`;
  const advice = (() => {
    switch (later.kind) {
      case 'replaced':
        return `A later operation of this migration updates the validator of collection ${name}${renamed(later.collection)}: ${bypass}, so that update checks the moved documents. Run the file with node, then run the command again.`;
      case 'unchecked':
        return `A later operation of this migration updates the validator of collection ${name}${renamed(later.collection)} without checking the documents already in it. Move the copy to after that update in the migration's migration.ts, so the documents it writes have to fit only the new validator: ${node}. Or ${orPipeline}.`;
      case 'removed':
        return `A later operation of this migration removes the validator of collection ${name}${renamed(later.collection)}: ${bypass}, so the copy does not have to fit the validator that is then removed. Run the file with node, then run the command again.`;
      case 'none':
        return `No later operation of this migration updates the validator of collection ${name}, so ${orPipeline}.`;
      case 'unknown':
        return `If a later validator update checks the documents of collection ${name} against a new validator, ${bypass}, so that update checks the moved documents, and ${node}. Otherwise ${orPipeline}.`;
    }
  })();
  return `MongoDB error ${failure.mongoError}: ${failure.reason}.${failure.document} ${written} ${advice}`;
}

/**
 * The failure when a rewrite fails after MongoDB began it: documents it reached may already be
 * rewritten. A planner cast that meets a value `$convert` cannot cast names the field, which the
 * advice reads to offer `--convert`. A data transform's update is the user's own, so its failure
 * never names a type change.
 */
function rewriteFailure(
  op: MongoDmlOperation,
  plan: MongoQueryPlan,
  error: unknown,
  position: DmlPosition,
): MongoMigrationRunnerResult | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const mongoCode: unknown = Reflect.get(error, 'code');
  if (typeof mongoCode !== 'number') return undefined;
  const codeName: unknown = Reflect.get(error, 'codeName');
  const mongoError = typeof codeName === 'string' ? `${mongoCode} (${codeName})` : `${mongoCode}`;
  const reason = mongoErrorText(error);
  if (op.operationClass === 'data') {
    const target = mongoCode === MONGO_DOCUMENT_VALIDATION ? copyTargetOf(plan) : undefined;
    if (target !== undefined) {
      const name =
        target.database === undefined
          ? target.collection
          : `${target.database}.${target.collection}`;
      return runnerFailure(
        'MIGRATION.EXECUTION_FAILED',
        `Operation ${op.id} failed: the validator of collection ${name} rejected a document ${target.stage === '$merge' ? 'the copy' : 'the $out stage'} wrote`,
        {
          why: copyRejectedWhy(
            target,
            {
              mongoError,
              reason,
              document:
                plan.command instanceof RawAggregateCommand
                  ? rejectedDocumentText(error, plan.command.collection)
                  : '',
            },
            laterValidator(target, position.plan.slice(position.operationIndex + 1)),
          ),
          meta: {
            operationId: op.id,
            mongoCode,
            ...(typeof codeName === 'string' ? { codeName } : {}),
            collection: name,
          },
        },
      );
    }
    return mongoCode === MONGO_CONVERSION_FAILURE
      ? runnerFailure(
          'MIGRATION.EXECUTION_FAILED',
          `Operation ${op.id} failed: its update met a value MongoDB cannot convert`,
          {
            why: `MongoDB stopped the data transform's update: ${reason}. Documents it updated before that value stay updated. Until a re-run finishes, a document the update already changed may no longer fit the collection's current validator, so updates to it fail. ${updateRerunText(op, plan)} ${rerunText("Fix the update in the migration's migration.ts, run the file with node, then run the command again", position.plan.slice(0, position.operationIndex + 1))}`,
            meta: { operationId: op.id, mongoCode },
          },
        )
      : runnerFailure(
          'MIGRATION.EXECUTION_FAILED',
          `Operation ${op.id} failed: MongoDB error ${mongoError}: ${reason}`,
          {
            why: `Documents the update changed before the error stay changed. Until a re-run finishes, a document the update already changed may no longer fit the collection's current validator, so updates to it fail. ${updateRerunText(op, plan)} Fix what MongoDB names; when it comes from the update, change it in the migration's migration.ts and run the file with node. ${rerunText('Then run the command again', position.plan.slice(0, position.operationIndex + 1))}`,
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
    const fix = rewriteErrorFix(mongoCode, reason, position.plan.slice(0, position.operationIndex));
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

/** The edit that keeps the documents a failed removal found: the removal, replaced by a replacement whose new value is the placeholder `"<stored value>"`. */
function keepRemovedValueEdit(options: RemoveStoredValueOptions): KeepDataEdit {
  const { value, required: _required, enumValue: _enumValue, ...at } = options;
  return {
    remove: callInSentence(new RemoveStoredValueCall(options)),
    replaceWith: callInSentence(
      new ReplaceStoredValueCall({ ...at, from: value, to: '<stored value>' }),
    ),
  };
}

export class MongoMigrationRunner {
  constructor(private readonly deps: MongoRunnerDependencies) {}

  async execute(options: MongoMigrationRunnerExecuteOptions): Promise<MongoMigrationRunnerResult> {
    let changedDatabase = false;
    const result = await this.apply(options, () => {
      changedDatabase = true;
    });
    return result.ok
      ? ok({ ...result.value, changedDatabase })
      : notOk(
          withDatabaseUnchanged(
            result.failure,
            options.databaseChangedBefore !== true && !changedDatabase,
          ),
        );
  }

  /** Applies the plan, calling `wrote` after each command that changes the database. */
  private async apply(
    options: MongoMigrationRunnerExecuteOptions,
    wrote: () => void,
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
            { operationIndex, contract: options.destinationContract, plan: operations },
          );
          if (result.failure) return result.failure;
          if (result.executed) operationsExecuted += 1;
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
              renameTargetExistsRefusal(operation, failing, operations.slice(0, operationIndex)) ??
              createTargetExistsRefusal(operation, failing, operations.slice(0, operationIndex)) ??
              (await this.documentsFailingValidatorRefusal(
                operation,
                failing,
                options.destinationContract,
                { operationIndex, plan: operations },
              )) ??
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
            const { command } = step;
            if (!(command instanceof CreateIndexCommand) || !isDuplicateKeyError(error)) {
              throw error;
            }
            const inPlace = await this.collectionInPlace(command.collection);
            return indexBuildFailure(
              operation,
              command,
              error,
              (fields) =>
                backfillStatements(
                  options.destinationContract,
                  command.collection,
                  fields,
                  new Map(),
                  inPlace.rewrite,
                ).map(({ statement }) => `--backfill ${statement}`),
              operations.slice(0, operationIndex),
            );
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

    if (!isNoOp || options.databasePolicies !== undefined) {
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
        const swapFailure = await this.updateMarker(
          markerOps,
          space,
          existingMarker.storageHash,
          {
            storageHash: destination.storageHash,
            profileHash,
            invariants: incomingInvariants,
            ...ifDefined('databasePolicies', options.databasePolicies),
          },
          options.checkedPolicies,
        );
        if (swapFailure !== undefined) return notOk(swapFailure);
      } else {
        await markerOps.initMarker(space, {
          storageHash: destination.storageHash,
          profileHash,
          invariants: incomingInvariants,
          ...ifDefined('databasePolicies', options.databasePolicies),
        });
      }
      wrote();

      if (!isNoOp) await this.recordLedgerEntries(markerOps, space, options);
    }

    return ok({ operationsPlanned: operations.length, operationsExecuted });
  }

  /**
   * Writes the marker while it still holds `expectedFrom` and, for the application space, while its
   * policies read as those the run checked.
   */
  private async updateMarker(
    markerOps: MarkerOperations,
    space: string,
    expectedFrom: string,
    destination: MarkerDestination,
    checkedPolicies: DatabasePolicies | undefined,
  ): Promise<MongoMigrationRunnerFailure | undefined> {
    if (await markerOps.updateMarker(space, expectedFrom, destination, checkedPolicies)) {
      return undefined;
    }
    const found = await markerOps.readMarker(space);
    const failure = markerSwapFailure(found, expectedFrom, checkedPolicies);
    if (failure.kind === 'policiesUnreadable') throw markerPoliciesCorrupt(markerOps, failure.why);
    if (failure.kind === 'policiesMoved' && checkedPolicies !== undefined) {
      return databasePoliciesMovedFailure(checkedPolicies, failure.found);
    }
    if (failure.kind === 'markerChanged') {
      return markerChangedFailure(space, expectedFrom, destination);
    }
    return storageHashMovedFailure(space, expectedFrom, found, destination);
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
    position: DmlPosition,
  ): Promise<{ executed: boolean; failure?: MongoMigrationRunnerResult }> {
    if (runPostchecks && runIdempotency && op.postcheck.length > 0) {
      const allSatisfied = await this.evaluateDmlChecks(op.postcheck, filterEvaluator);
      if (allSatisfied) return { executed: false };
    }

    const before = position.plan.slice(0, position.operationIndex);
    if (runPrechecks && op.precheck.length > 0) {
      const passed = await this.evaluateDmlChecks(op.precheck, filterEvaluator);
      if (!passed) {
        return {
          executed: false,
          failure:
            renameOverwriteRefusal(op, before) ??
            storedKeyRenameRefusal(op, before) ??
            (await this.documentsHoldingRemovedValueRefusal(op, position)) ??
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
        const refusal = bypassValidationRefusal(op, plan, error, before);
        if (refusal !== undefined) return { executed: false, failure: refusal };
        const failure = rewriteFailure(op, plan, error, position);
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
            (await this.documentsStillMatchingFailure(op, before)) ??
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
   * The failure when a stored value removal's precheck finds documents whose required field or key
   * holds the value: how many, one `_id`, the query that finds them all, and how to keep them.
   */
  private async documentsHoldingRemovedValueRefusal(
    op: MongoDmlOperation,
    position: DmlPosition,
  ): Promise<MongoMigrationRunnerResult | undefined> {
    const rewrite = op.meta?.rewrite;
    const [check] = op.precheck;
    if (rewrite?.kind !== 'removeStoredValue' || check === undefined) return undefined;
    const { command } = check.source;
    if (!(command instanceof RawAggregateCommand)) return undefined;
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
    const { collection, field, path, value, enumValue, required, filter } = rewrite;
    const place =
      path === undefined
        ? `in field ${field}`
        : `at path ${JSON.stringify(path)} in field ${field}`;
    const query = `db.getCollection(${JSON.stringify(collection)}).find(${JSON.stringify(match)})`;
    const coordinate =
      enumValue === undefined
        ? undefined
        : {
            ...ifDefined(
              'namespaceId',
              enumValue.namespaceId === undefined
                ? undefined
                : asNamespaceId(enumValue.namespaceId),
            ),
            enum: enumValue.enum,
            member: enumValue.member,
          };
    const named =
      coordinate === undefined
        ? 'the enum value'
        : `enum value "${enumValueStatementText(position.contract, enumValueCoordinateFromJson(coordinate))}"`;
    return runnerFailure(
      'MIGRATION.PRECHECK_FAILED',
      `Operation ${op.id} stopped: ${documents} ${one ? 'document' : 'documents'} in collection ${collection} ${one ? 'holds' : 'hold'} value ${JSON.stringify(value)} ${place}, which is required`,
      {
        why: [
          `${one ? 'It has' : 'One of them has'} _id ${mongoshValue(counted?.['documentId'])}. Find them all with ${query} in mongosh.`,
          `To keep them, add a new member to the enum and rename ${named} to it instead of removing it, or change those documents to another value first.`,
          rerunText(
            'Once the documents are fixed, run the command again',
            position.plan.slice(0, position.operationIndex),
          ),
        ].join(' '),
        meta: {
          operationId: op.id,
          name: op.name,
          ...(coordinate === undefined || typeof value === 'boolean'
            ? {}
            : {
                rowsHoldingValue: [
                  {
                    enumValue: coordinate,
                    value,
                    rows: documents,
                    operationIndex: position.operationIndex,
                    keepDataEdit: keepRemovedValueEdit({
                      collection,
                      field,
                      ...ifDefined('path', path),
                      ...ifDefined('filter', filter),
                      value,
                      ...ifDefined('required', required),
                      ...ifDefined('enumValue', enumValue),
                    }),
                  },
                ],
              }),
        },
      },
    );
  }

  /**
   * The failure when a validator change's precheck finds documents the new validator rejects: how
   * many, one `_id`, and the query that finds them all.
   */
  private async documentsFailingValidatorRefusal(
    op: MongoMigrationPlanOperation,
    failed: MongoMigrationCheck,
    contract: MongoContract,
    position: {
      readonly operationIndex: number;
      readonly plan: readonly AnyMongoMigrationOperation[];
    },
  ): Promise<MongoMigrationRunnerResult | undefined> {
    const { operationIndex, plan } = position;
    if (isInspectionCheckSource(failed.source)) return undefined;
    const collMod = validatorSetBy(op);
    if (collMod?.validator === undefined) return undefined;
    const { collection, validator } = collMod;
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
    const inPlace = await this.collectionInPlace(collection);
    const validatorBefore = inPlace.validator;
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
    const nested = nestedFindings(touched, fields);
    const shownProblems = [
      ...problems,
      ...[
        ...nested.lacking.map((key) => `has no ${JSON.stringify(key)}`),
        ...nested.notObjects.map(
          (field) => `holds an element in ${JSON.stringify(field)} that is not an object`,
        ),
      ]
        .filter((text) => !problems.some((problem) => problem.text === text))
        .map((text) => ({ text, uncheckable: false })),
    ];
    const hadValidator = typeof validatorBefore === 'object' && validatorBefore !== null;
    const found = [
      `${touchedSentence(touched, fields)}${one ? 'It has' : 'One of them has'} _id ${documentId}.`,
      ...(shownProblems.length === 0
        ? []
        : [`That document ${joinedList(shownProblems.map(({ text }) => text))}.`]),
      `Find them all with ${query} in mongosh.`,
    ];
    const uncheckable = problems.length > 0 && problems.every((problem) => problem.uncheckable);
    const backfills =
      uncheckable || !hadValidator
        ? { sentences: [], rowsWithoutValue: [] }
        : backfillAdvice(
            contract,
            {
              collection,
              documents: await this.documentsLacking(failed.source, collection, failing, touched),
            },
            touched,
            inPlace.rewrite,
            { operationIndex, renamed: renamedInto(plan, collection) },
          );
    const advice = uncheckable
      ? [
          'A document that holds such a field can never fit the validator, so changing the documents does not help: store the field under a name without "." that does not start with "$".',
        ]
      : hadValidator
        ? [...backfills.sentences, byHandAdvice(collection)]
        : ['Change them with a dataTransform in migration.ts, or with an update in mongosh.'];
    const why = [
      ...found,
      ...advice,
      `Under db migrate you can instead apply the validator over them: set checkDocuments to false on this operation in that migration.ts, run the file with node, and run db migrate again. db update writes no migration.ts, so there ${uncheckable ? 'store the field under another name' : 'fix the documents'} first.`,
      'This operation did not change the validator.',
      rerunText(
        uncheckable
          ? 'Then run the command again'
          : 'Once the documents are fixed, run the command again',
        plan.slice(0, operationIndex),
      ),
    ].join(' ');
    return runnerFailure(
      'MIGRATION.PRECHECK_FAILED',
      `Operation ${op.id} stopped: ${documents} ${one ? 'document' : 'documents'} in collection ${collection} ${one ? 'does' : 'do'} not fit the new validator`,
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
          ...(backfills.rowsWithoutValue.length === 0
            ? {}
            : { rowsWithoutValue: backfills.rowsWithoutValue }),
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
    before: readonly AnyMongoMigrationOperation[],
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
            ? rerunText(
                "Change the update in the migration's migration.ts so it changes them too, run the file with node, then run the command again",
                before,
              )
            : `The update this operation runs did not change them: another client may have written them during the apply, or the value it writes does not pass its own check. ${rerunText('Run the command again', before)} If they are still found, change them by hand.`,
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
   * The collection as the database has it now: its validator, and what a rewrite's refusals read of
   * it, whether it is a time-series collection and its validator's `$jsonSchema`.
   */
  private async collectionInPlace(
    collection: string,
  ): Promise<{ readonly validator: unknown; readonly rewrite: RewriteCollection }> {
    const [current] = (
      await this.deps.inspectionExecutor.listCollections(new ListCollectionsCommand())
    ).filter((info) => info['name'] === collection);
    const options: unknown = current?.['options'];
    const readable = typeof options === 'object' && options !== null;
    const validator: unknown = readable ? Reflect.get(options, 'validator') : undefined;
    return {
      validator,
      rewrite: {
        timeSeries: readable && Reflect.get(options, 'timeseries') !== undefined,
        validator: Reflect.get(validator ?? {}, '$jsonSchema'),
      },
    };
  }

  /** Each field or nested key the change makes required that documents matching `failing` lack or hold as `null`, with how many do; a nested key counts only in an object that the document holds. */
  private async documentsLacking(
    source: MongoQueryPlan,
    collection: string,
    failing: Readonly<Record<string, unknown>>,
    touched: TouchedFields,
  ): Promise<ReadonlyMap<string, number>> {
    const lackingFilter = (field: string): Record<string, unknown> | undefined => {
      const key = touched.keys.get(field);
      if (key === undefined) {
        return unrewritableFieldNameReason(field) === undefined ? { [field]: null } : undefined;
      }
      const parsed = storedKeyPath(key.field, key.path);
      return parsed.ok
        ? documentsWithObject(parsed.value, (object) => lacksKey(object, parsed.value.key))
        : undefined;
    };
    const lacking = await Promise.all(
      touched.requires.map(async (field): Promise<readonly (readonly [string, number])[]> => {
        const filter = lackingFilter(field);
        if (filter === undefined) return [];
        const counted = await this.firstRow({
          ...source,
          command: new RawAggregateCommand(collection, [
            { $match: { $and: [failing, filter] } },
            { $count: 'documents' },
          ]),
        });
        const documents = Number(counted?.['documents'] ?? 0);
        return documents === 0 ? [] : [[field, documents]];
      }),
    );
    return new Map(lacking.flat());
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
    const stage = writingStageOf(source.command);
    if (stage !== undefined) {
      throw mongoTargetError(
        'MIGRATION.DATA_TRANSFORM_CHECK_NOT_READ_ONLY',
        `Migration check rejected: stage "${stage}" is not read-only`,
        {
          why: `A migration check must only read, so that running it cannot change the database; the ${stage} stage of its pipeline writes its results to a collection.`,
          fix: `Remove the ${stage} stage from the check's pipeline.`,
          meta: { checkDescription: check.description, stage, collection: source.collection },
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
