import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  MigrationOperationPolicy,
  SqlControlFamilyInstance,
  SqlMigrationPlanContractInfo,
  SqlMigrationPlanOperation,
  SqlMigrationPlanOperationStep,
  SqlMigrationRunner,
  SqlMigrationRunnerExecuteOptions,
  SqlMigrationRunnerFailure,
  SqlMigrationRunnerResult,
  SqlMigrationRunnerSuccessValue,
} from '@internal/family-sql/control';
import { runnerFailure, runnerSuccess } from '@internal/family-sql/control';
import type { MigrationRunnerResult } from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { SqlControlDriverInstance, SqlStorage } from '@internal/sql-contract/types';
import type { SqlExecuteRequest } from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import type { Result } from '@internal/utils/result';
import { notOk, ok, okVoid } from '@internal/utils/result';
import { MARKER_TABLE_NAME } from '../control-tables';
import { sqliteError } from '../errors';
import { verifySqliteDatabaseSchema } from './diff-database-schema';
import type { SqlitePlanTargetDetails } from './planner-target-details';

export function createSqliteMigrationRunner(
  family: SqlControlFamilyInstance,
): SqlMigrationRunner<SqlitePlanTargetDetails> {
  return new SqliteMigrationRunner(family);
}

class SqliteMigrationRunner implements SqlMigrationRunner<SqlitePlanTargetDetails> {
  constructor(private readonly family: SqlControlFamilyInstance) {}

  /**
   * Apply the plan against an already-open connection without managing
   * the transaction lifecycle. The caller ({@link SqliteMigrationRunner.execute})
   * owns BEGIN/COMMIT/ROLLBACK and any connection-level setup (FK pragma
   * toggle, FK integrity check).
   */
  async executeOnConnection(
    options: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>,
  ): Promise<SqlMigrationRunnerResult> {
    const driver = options.driver;
    if (options.space !== undefined && options.space !== options.plan.spaceId) {
      throw sqliteError(
        'MIGRATION.CONTRACT_SPACE_VIOLATION',
        `SqlMigrationRunner: options.space (${options.space}) does not match plan.spaceId (${options.plan.spaceId})`,
        { meta: { space: options.space, planSpaceId: options.plan.spaceId } },
      );
    }
    const space = options.plan.spaceId;

    // Materialize any async ops before running checks or executing.
    const planOps = blindCast<
      readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[],
      'ops were produced by the SQLite planner and are SqlMigrationPlanOperation<SqlitePlanTargetDetails>; MigrationPlan.operations uses the wider framework type to accommodate Promise covariance'
    >(await Promise.all(options.plan.operations));

    const destinationCheck = this.ensurePlanMatchesDestinationContract(
      options.plan.destination,
      options.destinationContract,
    );
    if (!destinationCheck.ok) return destinationCheck;

    const policyCheck = this.enforcePolicyCompatibility(options.policy, planOps);
    if (!policyCheck.ok) return policyCheck;

    const ensureResult = await this.ensureControlTables(driver, options.destinationContract);
    if (!ensureResult.ok) return ensureResult;
    const existingMarker = await this.family.readMarker({ driver, space });

    const markerCheck = this.ensureMarkerCompatibility(existingMarker, options.plan);
    if (!markerCheck.ok) return markerCheck;

    const markerAtDestination = this.markerMatchesDestination(existingMarker, options.plan);
    const isSelfEdge = options.plan.origin?.storageHash === options.plan.destination.storageHash;
    const skipOperations = markerAtDestination && options.plan.origin != null && !isSelfEdge;

    let operationsExecuted: number;
    let executedOperations: readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[];

    if (skipOperations) {
      operationsExecuted = 0;
      executedOperations = [];
    } else {
      const applyResult = await this.applyPlan(driver, options, planOps);
      if (!applyResult.ok) return applyResult;
      operationsExecuted = applyResult.value.operationsExecuted;
      executedOperations = applyResult.value.executedOperations;
    }

    if (space === APP_SPACE_ID) {
      const schemaNode = await this.family.introspect({
        driver,
        contract: options.destinationContract,
      });
      const schemaVerifyResult = verifySqliteDatabaseSchema({
        contract: options.destinationContract,
        actualSchema: schemaNode,
        strict: options.strictVerification ?? true,
        typeMetadataRegistry: this.family.typeMetadataRegistry,
        frameworkComponents: options.frameworkComponents,
      });
      if (!schemaVerifyResult.ok) {
        return runnerFailure('MIGRATION.SCHEMA_VERIFY_FAILED', schemaVerifyResult.summary, {
          why: 'The resulting database schema does not satisfy the destination contract.',
          meta: { issues: schemaVerifyResult.schema.issues },
        });
      }
    }

    // Self-edge no-op detection: see Postgres runner for the rationale
    // (kept symmetric across both targets).
    const incomingInvariants = options.plan.providedInvariants;
    const existingInvariants = new Set(existingMarker?.invariants ?? []);
    const incomingIsSubsetOfExisting = incomingInvariants.every((id) => existingInvariants.has(id));
    const isSelfEdgeNoOp = isSelfEdge && operationsExecuted === 0 && incomingIsSubsetOfExisting;

    if (!isSelfEdgeNoOp) {
      const markerResult = await this.upsertMarker(driver, options, existingMarker, space);
      if (!markerResult.ok) return markerResult;
      await this.recordLedgerEntries(driver, options, executedOperations);
    }

    return runnerSuccess({
      operationsPlanned: planOps.length,
      operationsExecuted,
    });
  }

  async execute(options: {
    readonly driver: SqlControlDriverInstance<string>;
    readonly perSpaceOptions: ReadonlyArray<
      SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>
    >;
  }): Promise<MigrationRunnerResult> {
    const driver = options.driver;
    const perSpaceOptions = options.perSpaceOptions;

    if (perSpaceOptions.length === 0) {
      return ok({ perSpaceResults: [] });
    }

    // FK pragma toggle and the FK integrity check both span the outer
    // transaction: PRAGMA foreign_keys is a no-op inside a transaction, so the
    // toggle has to wrap BEGIN/COMMIT.
    const fkWasEnabled = await this.readForeignKeysEnabled(driver);
    if (fkWasEnabled) {
      await driver.query('PRAGMA foreign_keys = OFF');
    }

    try {
      await this.beginExclusiveTransaction(driver);
      let committed = false;
      try {
        const perSpaceResults: Array<{
          space: string;
          value: SqlMigrationRunnerSuccessValue;
        }> = [];
        let lastProcessedSpace: string | undefined;
        for (const spaceOptions of perSpaceOptions) {
          const space = spaceOptions.space ?? spaceOptions.plan.spaceId;
          const result = await this.executeOnConnection({ ...spaceOptions, driver, space });
          if (!result.ok) {
            return notOk({ ...result.failure, failingSpace: space });
          }
          perSpaceResults.push({ space, value: result.value });
          lastProcessedSpace = space;
        }

        if (fkWasEnabled) {
          const fkIntegrityCheck = await this.verifyForeignKeyIntegrity(driver);
          if (!fkIntegrityCheck.ok) {
            // Post-loop integrity violations cannot be attributed to a
            // single per-space step (the cumulative effect of all
            // applied plans was needed to reveal the broken
            // reference). Surface the last successfully-applied space
            // so operators can investigate from the most recent
            // migration first.
            return notOk({
              ...fkIntegrityCheck.failure,
              failingSpace: lastProcessedSpace ?? APP_SPACE_ID,
            });
          }
        }

        await this.commitTransaction(driver);
        committed = true;
        return ok({ perSpaceResults });
      } finally {
        if (!committed) {
          await this.rollbackTransaction(driver);
        }
      }
    } finally {
      if (fkWasEnabled) {
        await driver.query('PRAGMA foreign_keys = ON');
      }
    }
  }

  private async readForeignKeysEnabled(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
  ): Promise<boolean> {
    const result = await driver.query<{ foreign_keys: number }>('PRAGMA foreign_keys');
    const row = result.rows[0];
    return row?.foreign_keys === 1;
  }

  private async verifyForeignKeyIntegrity(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
    const result = await driver.query<Record<string, unknown>>('PRAGMA foreign_key_check');
    if (result.rows.length === 0) {
      return okVoid();
    }
    return runnerFailure(
      'MIGRATION.FOREIGN_KEY_VIOLATION',
      `Foreign key integrity check failed after migration: ${result.rows.length} violation(s).`,
      {
        why: 'PRAGMA foreign_key_check reported violations after applying recreate-table operations.',
        meta: { violations: result.rows },
      },
    );
  }

  private async applyPlan(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    options: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>,
    ops: readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[],
  ): Promise<
    Result<
      {
        readonly operationsExecuted: number;
        readonly executedOperations: readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[];
      },
      SqlMigrationRunnerFailure
    >
  > {
    const checks = options.executionChecks;
    const runPrechecks = checks?.prechecks !== false;
    const runPostchecks = checks?.postchecks !== false;
    const runIdempotency = checks?.idempotencyChecks !== false;

    let operationsExecuted = 0;
    const executedOperations: Array<SqlMigrationPlanOperation<SqlitePlanTargetDetails>> = [];

    for (const operation of ops) {
      options.callbacks?.onOperationStart?.(operation);
      try {
        if (runPostchecks && runIdempotency) {
          const postcheckAlreadySatisfied = await this.expectationsAreSatisfied(
            driver,
            operation.postcheck,
          );
          if (postcheckAlreadySatisfied) {
            executedOperations.push(this.createSkipRecord(operation));
            continue;
          }
        }

        if (runPrechecks) {
          const precheckResult = await this.runExpectationSteps(
            driver,
            operation.precheck,
            operation,
            'precheck',
          );
          if (!precheckResult.ok) {
            return precheckResult;
          }
        }

        const executeResult = await this.runExecuteSteps(driver, operation.execute, operation);
        if (!executeResult.ok) {
          return executeResult;
        }

        if (runPostchecks) {
          const postcheckResult = await this.runExpectationSteps(
            driver,
            operation.postcheck,
            operation,
            'postcheck',
          );
          if (!postcheckResult.ok) {
            return postcheckResult;
          }
        }

        executedOperations.push(operation);
        operationsExecuted += 1;
      } finally {
        options.callbacks?.onOperationComplete?.(operation);
      }
    }
    return ok({ operationsExecuted, executedOperations });
  }

  private async ensureControlTables(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    contract: Contract<SqlStorage>,
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
    const legacyDetection = await this.detectLegacyMarkerShape(driver);
    if (!legacyDetection.ok) {
      return legacyDetection;
    }
    const lowererContext = { contract };
    for (const query of this.family.bootstrapControlTableQueries()) {
      await this.executeStatement(driver, await this.family.lowerAst(query, lowererContext));
    }
    return okVoid();
  }

  private async detectLegacyMarkerShape(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
    const tableInfo = await driver.query<{ name: string }>(
      `PRAGMA table_info("${MARKER_TABLE_NAME}")`,
    );
    if (tableInfo.rows.length === 0) {
      return okVoid();
    }
    const columns = new Set(tableInfo.rows.map((row) => row.name));
    if (columns.has('space')) {
      return okVoid();
    }
    return runnerFailure(
      'MIGRATION.LEGACY_MARKER_SHAPE',
      `Legacy marker-table shape detected on ${MARKER_TABLE_NAME} (no \`space\` column). ` +
        'Prisma 8 is in pre-1.0; the previous transitional auto-migration to the per-space-row schema has been removed. ' +
        `Drop \`${MARKER_TABLE_NAME}\` and re-run \`dbInit\` to reinitialise from a clean baseline.`,
      {
        meta: {
          table: MARKER_TABLE_NAME,
          columns: [...columns].sort(),
        },
      },
    );
  }

  private async runExpectationSteps(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    steps: readonly SqlMigrationPlanOperationStep[],
    operation: SqlMigrationPlanOperation<SqlitePlanTargetDetails>,
    phase: 'precheck' | 'postcheck',
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
    for (const step of steps) {
      const result = await driver.query(step.sql, step.params ?? []);
      if (!this.stepResultIsTrue(result.rows)) {
        const code =
          phase === 'precheck' ? 'MIGRATION.PRECHECK_FAILED' : 'MIGRATION.POSTCHECK_FAILED';
        return runnerFailure(
          code,
          `Operation ${operation.id} failed during ${phase}: ${step.description}`,
          {
            meta: {
              operationId: operation.id,
              phase,
              stepDescription: step.description,
            },
          },
        );
      }
    }
    return okVoid();
  }

  private async runExecuteSteps(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    steps: readonly SqlMigrationPlanOperationStep[],
    operation: SqlMigrationPlanOperation<SqlitePlanTargetDetails>,
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
    for (const step of steps) {
      try {
        await driver.query(step.sql, step.params ?? []);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return runnerFailure(
          'MIGRATION.EXECUTION_FAILED',
          `Operation ${operation.id} failed during execution: ${step.description}`,
          {
            why: message,
            meta: {
              operationId: operation.id,
              stepDescription: step.description,
              sql: step.sql,
            },
          },
        );
      }
    }
    return okVoid();
  }

  private stepResultIsTrue(rows: readonly Record<string, unknown>[]): boolean {
    if (!rows || rows.length === 0) {
      return false;
    }
    const firstRow = rows[0];
    const firstValue = firstRow ? Object.values(firstRow)[0] : undefined;
    if (typeof firstValue === 'number') {
      return firstValue !== 0;
    }
    if (typeof firstValue === 'boolean') {
      return firstValue;
    }
    if (typeof firstValue === 'string') {
      const lower = firstValue.toLowerCase();
      if (lower === 'true' || lower === '1') return true;
      if (lower === 'false' || lower === '0') return false;
      return firstValue.length > 0;
    }
    return Boolean(firstValue);
  }

  private async expectationsAreSatisfied(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    steps: readonly SqlMigrationPlanOperationStep[],
  ): Promise<boolean> {
    if (steps.length === 0) {
      return false;
    }
    for (const step of steps) {
      const result = await driver.query(step.sql, step.params ?? []);
      if (!this.stepResultIsTrue(result.rows)) {
        return false;
      }
    }
    return true;
  }

  private createSkipRecord(
    operation: SqlMigrationPlanOperation<SqlitePlanTargetDetails>,
  ): SqlMigrationPlanOperation<SqlitePlanTargetDetails> {
    return Object.freeze({
      id: operation.id,
      label: operation.label,
      ...ifDefined('summary', operation.summary),
      operationClass: operation.operationClass,
      target: operation.target,
      precheck: Object.freeze([]),
      execute: Object.freeze([]),
      postcheck: Object.freeze([...operation.postcheck]),
      meta: Object.freeze({
        ...(operation.meta ?? {}),
        runner: Object.freeze({ skipped: true, reason: 'postcheck_pre_satisfied' }),
      }),
    });
  }

  private markerMatchesDestination(
    marker: ContractMarkerRecord | null,
    plan: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['plan'],
  ): boolean {
    if (!marker) return false;
    if (marker.storageHash !== plan.destination.storageHash) return false;
    if (plan.destination.profileHash && marker.profileHash !== plan.destination.profileHash) {
      return false;
    }
    return true;
  }

  private enforcePolicyCompatibility(
    policy: MigrationOperationPolicy,
    operations: readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[],
  ): Result<void, SqlMigrationRunnerFailure> {
    const allowedClasses = new Set(policy.allowedOperationClasses);
    for (const operation of operations) {
      if (!allowedClasses.has(operation.operationClass)) {
        return runnerFailure(
          'MIGRATION.POLICY_VIOLATION',
          `Operation ${operation.id} has class "${operation.operationClass}" which is not allowed by policy.`,
          {
            why: `Policy only allows: ${policy.allowedOperationClasses.join(', ')}.`,
            meta: {
              operationId: operation.id,
              operationClass: operation.operationClass,
              allowedClasses: policy.allowedOperationClasses,
            },
          },
        );
      }
    }
    return okVoid();
  }

  private ensureMarkerCompatibility(
    marker: ContractMarkerRecord | null,
    plan: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['plan'],
  ): Result<void, SqlMigrationRunnerFailure> {
    const origin = plan.origin ?? null;
    if (!origin) {
      return okVoid();
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
    if (origin.profileHash && marker.profileHash !== origin.profileHash) {
      return runnerFailure(
        'MIGRATION.MARKER_ORIGIN_MISMATCH',
        `Existing contract marker profile hash (${marker.profileHash}) does not match plan origin profile hash (${origin.profileHash}).`,
        {
          meta: {
            markerProfileHash: marker.profileHash,
            expectedOriginProfileHash: origin.profileHash,
          },
        },
      );
    }
    return okVoid();
  }

  private ensurePlanMatchesDestinationContract(
    destination: SqlMigrationPlanContractInfo,
    contract: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['destinationContract'],
  ): Result<void, SqlMigrationRunnerFailure> {
    if (destination.storageHash !== contract.storage.storageHash) {
      return runnerFailure(
        'MIGRATION.DESTINATION_CONTRACT_MISMATCH',
        `Plan destination storage hash (${destination.storageHash}) does not match provided contract storage hash (${contract.storage.storageHash}).`,
        {
          meta: {
            planStorageHash: destination.storageHash,
            contractStorageHash: contract.storage.storageHash,
          },
        },
      );
    }
    if (
      destination.profileHash &&
      contract.profileHash &&
      destination.profileHash !== contract.profileHash
    ) {
      return runnerFailure(
        'MIGRATION.DESTINATION_CONTRACT_MISMATCH',
        `Plan destination profile hash (${destination.profileHash}) does not match provided contract profile hash (${contract.profileHash}).`,
        {
          meta: {
            planProfileHash: destination.profileHash,
            contractProfileHash: contract.profileHash,
          },
        },
      );
    }
    return okVoid();
  }

  private async upsertMarker(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    options: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>,
    existingMarker: ContractMarkerRecord | null,
    space: string,
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
    // Pass the plan's incoming invariants verbatim; `updateMarker` unions them
    // with the stored set (TS-side, dialect-uniform) under the runner's
    // BEGIN EXCLUSIVE — no client-side pre-merge here, so there is no
    // double-merge with the SPI's internal accumulate-dedupe.
    const destination = {
      storageHash: options.plan.destination.storageHash,
      profileHash:
        options.plan.destination.profileHash ??
        options.destinationContract.profileHash ??
        options.plan.destination.storageHash,
      invariants: options.plan.providedInvariants ?? [],
    };
    if (!existingMarker) {
      await this.family.initMarker({ driver, space, destination });
      return okVoid();
    }
    const updated = await this.family.updateMarker({
      driver,
      space,
      expectedFrom: existingMarker.storageHash,
      destination,
    });
    if (!updated) {
      return runnerFailure(
        'MIGRATION.MARKER_CAS_FAILURE',
        'Marker was modified by another process during migration execution.',
        {
          meta: {
            space,
            expectedStorageHash: existingMarker.storageHash,
            destinationStorageHash: options.plan.destination.storageHash,
          },
        },
      );
    }
    return okVoid();
  }

  private async recordLedgerEntries(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    options: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>,
    executedOperations: readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[],
  ): Promise<void> {
    const plan = options.plan;
    const space = plan.spaceId;
    const edges = options.migrationEdges;
    const totalEdgeOps = edges.reduce((sum, edge) => sum + edge.operationCount, 0);
    if (totalEdgeOps !== plan.operations.length) {
      throw new InternalError(
        `Ledger write: plan.operations length (${plan.operations.length}) does not match sum of migrationEdges operationCount (${totalEdgeOps})`,
      );
    }
    // The ledger records the operations as executed — idempotency-skipped ops
    // are substituted with skip records (empty `execute`) by `applyPlan`, so the
    // journal reflects what actually ran rather than the raw plan.
    let offset = 0;
    for (const edge of edges) {
      const edgeOps = executedOperations.slice(offset, offset + edge.operationCount);
      offset += edge.operationCount;
      await this.family.writeLedgerEntry({
        driver,
        space,
        entry: {
          edgeId: `${edge.from}->${edge.to}`,
          from: edge.from,
          to: edge.to,
          migrationName: edge.dirName,
          migrationHash: edge.migrationHash,
          operations: edgeOps,
        },
      });
    }
  }

  private async beginExclusiveTransaction(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('BEGIN EXCLUSIVE');
  }

  private async commitTransaction(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('COMMIT');
  }

  private async rollbackTransaction(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('ROLLBACK');
  }

  private async executeStatement(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    statement: SqlExecuteRequest,
  ): Promise<void> {
    await driver.query(statement.sql, statement.params);
  }
}
