import type { ContractMarkerRecord } from '@internal/contract/types';
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
  type MigrationOperationPolicy,
  type MigrationPlan,
  type MigrationPlanOperation,
  type MigrationRunnerExecutionChecks,
  type MigrationRunnerFailure,
  type MigrationRunnerFailureMeta,
  type MigrationRunnerPerSpaceSuccessValue,
  migrationRunnerFailure,
  type OperationContext,
  schemaCheckWhy,
  type VerifyDatabaseSchemaResult,
  withDatabaseUnchanged,
} from '@internal/framework-components/control';
import type { AggregateMigrationEdgeRef } from '@internal/migration-tools/aggregate';
import type { MongoContract } from '@internal/mongo-contract';
import type { MongoAdapter, MongoQueryable } from '@internal/mongo-lowering';
import type {
  AnyMongoMigrationOperation,
  MongoDmlCheck,
  MongoDmlOperation,
  MongoInspectionCommandVisitor,
  MongoMigrationCheck,
  MongoMigrationPlanOperation,
} from '@internal/mongo-query-ast/control';
import { isMongoDmlOperation, RenameCollectionCommand } from '@internal/mongo-query-ast/control';
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
import { deserializeMongoOps } from './mongo-ops-serializer';

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
      why: `Renaming or removing a field rewrites documents with bypassDocumentValidation, because the old validator requires the old field. MongoDB refused it with error ${MONGO_UNAUTHORIZED} (${String(codeName)}). Grant the user the bypassDocumentValidation action on the database, for example with the dbAdmin or restore role, then run the command again; operations that already ran are skipped.`,
      meta: {
        operationId: op.id,
        mongoCode: MONGO_UNAUTHORIZED,
        codeName,
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

    for (const operation of operations) {
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
  ): Promise<{ executed: boolean; failure?: MongoMigrationRunnerResult }> {
    if (runPostchecks && runIdempotency && op.postcheck.length > 0) {
      const allSatisfied = await this.evaluateDmlChecks(
        op.postcheck,
        adapter,
        driver,
        filterEvaluator,
      );
      if (allSatisfied) return { executed: false };
    }

    if (runPrechecks && op.precheck.length > 0) {
      const passed = await this.evaluateDmlChecks(op.precheck, adapter, driver, filterEvaluator);
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
        if (refusal === undefined) throw error;
        return { executed: false, failure: refusal };
      }
    }

    if (runPostchecks && op.postcheck.length > 0) {
      const passed = await this.evaluateDmlChecks(op.postcheck, adapter, driver, filterEvaluator);
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

  private async evaluateDmlChecks(
    checks: readonly MongoDmlCheck[],
    adapter: MongoAdapter,
    driver: MongoQueryable,
    filterEvaluator: FilterEvaluator,
  ): Promise<boolean> {
    for (const check of checks) {
      const commandKind = check.source.command.kind;
      if (!READ_ONLY_CHECK_COMMAND_KINDS.has(commandKind)) {
        throw mongoTargetError(
          'MIGRATION.DATA_TRANSFORM_CHECK_NOT_READ_ONLY',
          `Data-transform check rejected: command kind "${commandKind}" is not read-only`,
          {
            why: 'Data-transform checks must use aggregate or rawAggregate commands so the pre/postcheck path cannot mutate the database.',
            fix: 'Author the check.source as an aggregate pipeline (or rawAggregate) rather than a DML write command.',
            meta: {
              checkDescription: check.description,
              commandKind,
              collection: check.source.collection,
            },
          },
        );
      }
      const wireCommand = await adapter.lower(check.source, {});
      let matchFound = false;
      for await (const row of driver.execute<Record<string, unknown>>(wireCommand)) {
        if (filterEvaluator.evaluate(check.filter, row)) {
          matchFound = true;
          break;
        }
      }
      const passed = check.expect === 'exists' ? matchFound : !matchFound;
      if (!passed) return false;
    }
    return true;
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
      const documents = await check.source.accept(inspectionExecutor);
      const matchFound = documents.some((doc) => filterEvaluator.evaluate(check.filter, doc));
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
