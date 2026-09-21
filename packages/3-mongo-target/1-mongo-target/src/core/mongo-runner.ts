import type { MarkerOperations, MongoRunnerDependencies } from '@internal/adapter-mongo/control';
import type { ContractMarkerRecord } from '@internal/contract/types';
import { errorRunnerFailed } from '@internal/errors/execution';
import { verifyMongoSchema } from '@internal/family-mongo/schema-verify';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  type MigrationPlan,
  type MigrationPlanOperation,
  type MigrationRunnerExecutionChecks,
  type MigrationRunnerFailure,
  type MigrationRunnerPerSpaceSuccessValue,
  type OperationContext,
  type VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import type { AggregateMigrationEdgeRef } from '@internal/migration-tools/aggregate';
import type { MongoContract } from '@internal/mongo-contract';
import type { MongoAdapter, MongoDriver } from '@internal/mongo-lowering';
import type {
  AnyMongoMigrationOperation,
  MongoDataTransformCheck,
  MongoDataTransformOperation,
  MongoInspectionCommandVisitor,
  MongoMigrationCheck,
  MongoMigrationPlanOperation,
} from '@internal/mongo-query-ast/control';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import { FilterEvaluator } from './filter-evaluator';
import { deserializeMongoOps } from './mongo-ops-serializer';

const READ_ONLY_CHECK_COMMAND_KINDS: ReadonlySet<string> = new Set(['aggregate', 'rawAggregate']);

export type { MarkerOperations, MongoRunnerDependencies };

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
}

export type MongoMigrationRunnerResult = Result<
  MigrationRunnerPerSpaceSuccessValue,
  MigrationRunnerFailure
>;

function runnerFailure(
  code: string,
  summary: string,
  opts?: { why?: string; meta?: Record<string, unknown> },
): MongoMigrationRunnerResult {
  return notOk<MigrationRunnerFailure>({
    code,
    summary,
    ...opts,
  });
}

export class MongoMigrationRunner {
  constructor(private readonly deps: MongoRunnerDependencies) {}

  async execute(options: MongoMigrationRunnerExecuteOptions): Promise<MongoMigrationRunnerResult> {
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
        if (operation.operationClass === 'data') {
          const result = await this.executeDataTransform(
            blindCast<
              MongoDataTransformOperation,
              'operationClass data discriminates Mongo data transform operations'
            >(operation),
            adapter,
            driver,
            filterEvaluator,
            runIdempotency,
            runPrechecks,
            runPostchecks,
          );
          if (result.failure) return result.failure;
          if (result.executed) {
            operationsExecuted += 1;
          }
          continue;
        }

        const ddlOp = blindCast<
          MongoMigrationPlanOperation,
          'non-data Mongo operations are DDL migration plan operations'
        >(operation);

        if (runPostchecks && runIdempotency) {
          const allSatisfied = await this.allChecksSatisfied(
            ddlOp.postcheck,
            inspectionExecutor,
            filterEvaluator,
          );
          if (allSatisfied) continue;
        }

        if (runPrechecks) {
          const precheckResult = await this.evaluateChecks(
            ddlOp.precheck,
            inspectionExecutor,
            filterEvaluator,
          );
          if (!precheckResult) {
            return runnerFailure(
              'MIGRATION.PRECHECK_FAILED',
              `Operation ${operation.id} failed during precheck`,
              { meta: { operationId: operation.id } },
            );
          }
        }

        for (const step of ddlOp.execute) {
          await executeDdl(step.command);
        }

        if (runPostchecks) {
          const postcheckResult = await this.evaluateChecks(
            ddlOp.postcheck,
            inspectionExecutor,
            filterEvaluator,
          );
          if (!postcheckResult) {
            return runnerFailure(
              'MIGRATION.POSTCHECK_FAILED',
              `Operation ${operation.id} failed during postcheck`,
              { meta: { operationId: operation.id } },
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
          why: 'The resulting database schema does not satisfy the destination contract.',
          meta: { issues: verifyResult.schema.issues },
        });
      }

      if (existingMarker) {
        const updated = await markerOps.updateMarker(space, existingMarker.storageHash, {
          storageHash: destination.storageHash,
          profileHash,
          invariants: incomingInvariants,
        });
        if (!updated) {
          return runnerFailure(
            'MIGRATION.MARKER_CAS_FAILURE',
            'Marker was modified by another process during migration execution.',
            {
              meta: {
                space,
                expectedStorageHash: existingMarker.storageHash,
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

  private async executeDataTransform(
    op: MongoDataTransformOperation,
    adapter: MongoAdapter,
    driver: MongoDriver,
    filterEvaluator: FilterEvaluator,
    runIdempotency: boolean,
    runPrechecks: boolean,
    runPostchecks: boolean,
  ): Promise<{ executed: boolean; failure?: MongoMigrationRunnerResult }> {
    if (runPostchecks && runIdempotency && op.postcheck.length > 0) {
      const allSatisfied = await this.evaluateDataTransformChecks(
        op.postcheck,
        adapter,
        driver,
        filterEvaluator,
      );
      if (allSatisfied) return { executed: false };
    }

    if (runPrechecks && op.precheck.length > 0) {
      const passed = await this.evaluateDataTransformChecks(
        op.precheck,
        adapter,
        driver,
        filterEvaluator,
      );
      if (!passed) {
        return {
          executed: false,
          failure: runnerFailure(
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
      for await (const _ of driver.execute(wireCommand)) {
        /* consume */
      }
    }

    if (runPostchecks && op.postcheck.length > 0) {
      const passed = await this.evaluateDataTransformChecks(
        op.postcheck,
        adapter,
        driver,
        filterEvaluator,
      );
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

  private async evaluateDataTransformChecks(
    checks: readonly MongoDataTransformCheck[],
    adapter: MongoAdapter,
    driver: MongoDriver,
    filterEvaluator: FilterEvaluator,
  ): Promise<boolean> {
    for (const check of checks) {
      const commandKind = check.source.command.kind;
      if (!READ_ONLY_CHECK_COMMAND_KINDS.has(commandKind)) {
        throw errorRunnerFailed(
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
    for (const check of checks) {
      const documents = await check.source.accept(inspectionExecutor);
      const matchFound = documents.some((doc) => filterEvaluator.evaluate(check.filter, doc));
      const passed = check.expect === 'exists' ? matchFound : !matchFound;
      if (!passed) return false;
    }
    return true;
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
