import { asNamespaceId, type ContractMarkerRecord } from '@internal/contract/types';
import { fieldRewriteOf } from '@internal/family-mongo/control';
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
  type MongoContract,
  mongoModelsOf,
  ownStoredNamesOf,
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
import { castFieldOf } from './migration-factories';
import { deserializeMongoOps } from './mongo-ops-serializer';
import { collectionOf } from './mongo-statement-planning';

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

/** The fields a validator change makes required, and those whose accepted values it changes, read from the root shapes of the two validators. */
function fieldsTouched(
  before: unknown,
  after: unknown,
): { readonly requires: readonly string[]; readonly retypes: readonly string[] } {
  const shapes = (jsonSchema: unknown) => validatorRootShapesOf(jsonSchema);
  const required = (jsonSchema: unknown) =>
    new Set(shapes(jsonSchema).flatMap((root) => root.required));
  const properties = (jsonSchema: unknown) =>
    new Map(
      shapes(jsonSchema).flatMap((root) =>
        Object.entries(root.properties).map(
          ([field, schema]) => [field, canonicalize(schema)] as const,
        ),
      ),
    );
  const requiredBefore = required(before);
  const propertiesBefore = properties(before);
  return {
    requires: [...required(after)]
      .filter((field) => field !== '_id' && !requiredBefore.has(field))
      .sort(),
    retypes: [...properties(after)]
      .filter(
        ([field, schema]) => propertiesBefore.has(field) && propertiesBefore.get(field) !== schema,
      )
      .map(([field]) => field)
      .sort(),
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
  for (const namespaceId of Object.keys(contract.domain?.namespaces ?? {})) {
    const models = mongoModelsOf(contract.domain, asNamespaceId(namespaceId));
    for (const [model, definition] of Object.entries(models)) {
      const coordinate = { namespaceId: asNamespaceId(namespaceId), model };
      if (collectionOf(contract, coordinate) !== collection) continue;
      const field = Object.entries(ownStoredNamesOf(definition)).find(
        ([, stored]) => stored === storedName,
      )?.[0];
      if (field !== undefined) return { kind: 'field', ...coordinate, field };
    }
  }
  return { kind: 'storage', name: `${collection}.${storedName}` };
}

/**
 * The failure when a planner rewrite fails after MongoDB began it: documents it reached may already
 * be rewritten. A cast that meets a value `$convert` cannot cast names the field, which the advice
 * reads to offer `--convert`.
 */
function rewriteFailure(
  op: MongoDmlOperation,
  error: unknown,
  position: { readonly operationIndex: number; readonly contract: MongoContract },
): MongoMigrationRunnerResult | undefined {
  const rewrite = fieldRewriteOf(op);
  if (rewrite === undefined || typeof error !== 'object' || error === null) return undefined;
  const mongoCode: unknown = Reflect.get(error, 'code');
  if (typeof mongoCode !== 'number') return undefined;
  const reason = mongoErrorText(error);
  if (mongoCode !== MONGO_CONVERSION_FAILURE) {
    return runnerFailure('MIGRATION.EXECUTION_FAILED', `Operation ${op.id} failed: ${reason}`, {
      why: 'Documents the rewrite changed before the error stay changed, and a re-run rewrites the rest.',
      meta: { operationId: op.id, mongoCode },
    });
  }
  const field = fieldStoredAt(position.contract, rewrite.collection, rewrite.field);
  const named =
    field.kind === 'field' ? fieldStatementText(position.contract, field) : rewrite.field;
  const { operationIndex } = position;
  const cast = castFieldOf(op);
  if (op.operationClass === 'data' || cast === undefined) {
    return runnerFailure(
      'MIGRATION.EXECUTION_FAILED',
      `Operation ${op.id} failed: the conversion of field "${named}" met a value it cannot convert`,
      {
        why: `MongoDB stopped the conversion's update: ${reason}. Documents converted before that value stay converted, and a re-run converts the rest.`,
        meta: {
          operationId: op.id,
          mongoCode,
          failedTypeChange: { field, by: 'conversion', reason: 'value', operationIndex },
        },
      },
    );
  }
  return runnerFailure(
    'MIGRATION.EXECUTION_FAILED',
    `Operation ${op.id} failed: a value of field "${named}" in collection ${cast.collection} cannot be cast to ${cast.to}`,
    {
      why: `MongoDB's $convert met a value of field "${named}" it cannot cast to ${cast.to}: ${reason}. Documents cast before that value stay cast, and a re-run casts the rest.`,
      meta: {
        operationId: op.id,
        mongoCode,
        failedTypeChange: { field, by: 'cast', reason: 'value', operationIndex },
      },
    },
  );
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
            { operationIndex, contract: options.destinationContract },
          );
          if (result.failure) return result.failure;
          if (result.executed) {
            operationsExecuted += 1;
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
              (await this.documentsFailingValidatorRefusal(operation, failing)) ??
              runnerFailure(
                'MIGRATION.PRECHECK_FAILED',
                `Operation ${operation.id} failed during precheck: ${failing.description}`,
                { why: failedPrecheckWhy(failedCheck), meta: { failedCheck } },
              )
            );
          }
        }

        for (const step of operation.execute) {
          await executeDdl(step.command);
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
          failure: runnerFailure(
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
   * The failure when a validator change's before-check finds documents the new validator rejects:
   * how many, one `_id`, and the query that finds them all.
   */
  private async documentsFailingValidatorRefusal(
    op: MongoMigrationPlanOperation,
    failed: MongoMigrationCheck,
  ): Promise<MongoMigrationRunnerResult | undefined> {
    const collMod = validatorSetBy(op);
    if (collMod === undefined || isInspectionCheckSource(failed.source)) return undefined;
    const failing = { $nor: [collMod.validator] };
    const counted = await this.firstRow({
      ...failed.source,
      command: new RawAggregateCommand(collMod.collection, [
        { $match: failing },
        { $group: { _id: null, documents: { $sum: 1 }, documentId: { $first: '$_id' } } },
      ]),
    });
    const documents = Number(counted?.['documents'] ?? 0);
    if (documents === 0) return undefined;
    const documentId = mongoshValue(counted?.['documentId']);
    const query = `db.getCollection(${JSON.stringify(collMod.collection)}).find(${JSON.stringify(failing)})`;
    const [current] = (
      await this.deps.inspectionExecutor.listCollections(new ListCollectionsCommand())
    ).filter((info) => info['name'] === collMod.collection);
    const options: unknown = current?.['options'];
    const validatorBefore: unknown =
      typeof options === 'object' && options !== null
        ? Reflect.get(options, 'validator')
        : undefined;
    const touched = fieldsTouched(
      Reflect.get(validatorBefore ?? {}, '$jsonSchema'),
      Reflect.get(collMod.validator ?? {}, '$jsonSchema'),
    );
    return runnerFailure(
      'MIGRATION.PRECHECK_FAILED',
      `Operation ${op.id} stopped: ${documents} ${documents === 1 ? 'document' : 'documents'} in collection ${collMod.collection} ${documents === 1 ? 'does' : 'do'} not fit the new validator`,
      {
        why: `${touchedSentence(touched)}${documents === 1 ? 'It has' : 'One of them has'} _id ${documentId}. Find them all with ${query} in mongosh. Change them so they fit the new validator, or set checkDocuments to false on this operation in migration.ts to apply the validator over them. The validator was not changed. Once the documents are fixed, run the command again; operations that already ran are skipped.`,
        meta: {
          operationId: op.id,
          documentsFailingValidator: {
            collection: collMod.collection,
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
