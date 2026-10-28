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
import {
  convertedColumnOf,
  type RequiredColumn,
  requiredColumnOf,
  requiredColumnsOfMigration,
  rowsHoldingValueOf,
  rowsHoldingValueSummary,
  rowsWithoutValueFailure,
  runnerFailure,
  runnerSuccess,
  unconvertedFieldOf,
} from '@internal/family-sql/control';
import type {
  BlockingObject,
  FailedTypeChange,
  MigrationRunnerResult,
  RowsHoldingValue,
} from '@internal/framework-components/control';
import {
  APP_SPACE_ID,
  failedPostcheckWhy,
  failedPrecheckWhy,
  schemaCheckWhy,
  withDatabaseUnchanged,
  withFailingSpace,
} from '@internal/framework-components/control';
import type { SqlControlDriverInstance, SqlStorage } from '@internal/sql-contract/types';
import { SqlConnectionError, SqlQueryError } from '@internal/sql-errors';
import type { SqlExecuteRequest } from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import type { Result } from '@internal/utils/result';
import { notOk, ok, okVoid } from '@internal/utils/result';
import { postgresError } from '../errors';
import { quoteIdentifier } from '../sql-utils';
import {
  DEPENDENT_OBJECTS_STILL_EXIST,
  dependentsOf,
  dependentsSummary,
} from './dependent-objects';
import { MARKER_LOCK_KEY, MARKER_LOCK_SQL } from './marker-lock';
import { qualifyTableName } from './planner-sql-checks';
import type { PostgresPlanTargetDetails } from './planner-target-details';
import { CHECK_VIOLATION, rowsFailingCheckOf } from './rows-failing-check';
import {
  SCHEMA_OBJECTS_SQL,
  schemaBlockingObjects,
  schemaContentsOf,
  schemaObjectsSummary,
} from './schema-contents';
import { keepRowsEdit } from './stored-value-calls';

interface ApplyPlanSuccessValue {
  readonly operationsExecuted: number;
  readonly executedOperations: readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
}

/**
 * Deep clones and freezes a record object to prevent mutation.
 * Recursively clones nested objects and arrays to ensure complete isolation.
 */
function cloneAndFreezeRecord<T extends Record<string, unknown>>(value: T): T {
  const cloned: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (val === null || val === undefined) {
      cloned[key] = val;
    } else if (Array.isArray(val)) {
      cloned[key] = Object.freeze([...val]);
    } else if (typeof val === 'object') {
      cloned[key] = cloneAndFreezeRecord(
        blindCast<
          Record<string, unknown>,
          'recursive clone only recurses into plain record-shaped values'
        >(val),
      );
    } else {
      cloned[key] = val;
    }
  }
  return blindCast<T, 'cloned record preserves the key/value shape of the input record'>(
    Object.freeze(cloned),
  );
}

/** Where a failed operation sits in its plan, and what the runner needs to name what blocked it. */
interface PlanPosition {
  readonly contract: Contract<SqlStorage>;
  readonly operationIndex: number;
  readonly operations: readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
  readonly edges: readonly { readonly operationCount: number }[];
}

/**
 * SQLSTATE classes of failures that come from the connection or the server, not from the SQL a step
 * runs: connection exceptions, transaction rollbacks, resources, operator intervention, system and
 * internal errors.
 */
const NOT_THE_STEPS_SQL = ['08', '40', '53', '57', '58', 'XX'];

/**
 * The type change a failed step carries out. For the database's cast, a data exception (class 22)
 * is a value it could not convert, and 42846 (`cannot_coerce`) a pair of types with no cast. For
 * the migration's own conversion, every error of the step's SQL is the conversion's: a data
 * exception is a value, an integrity violation (class 23) a value the new type cannot hold, and
 * anything else an error in its expression.
 */
function failedTypeChangeOf(
  step: SqlMigrationPlanOperationStep,
  sqlState: string | undefined,
  plan: { readonly contract: Contract<SqlStorage>; readonly operationIndex: number },
): FailedTypeChange | undefined {
  const converted = convertedColumnOf(step);
  const field = unconvertedFieldOf(step, plan.contract);
  if (converted === undefined || field === undefined || sqlState === undefined) return undefined;
  const { operationIndex } = plan;
  if (converted.by === 'conversion') {
    if (NOT_THE_STEPS_SQL.some((sqlClass) => sqlState.startsWith(sqlClass))) return undefined;
    const reason = sqlState.startsWith('22')
      ? 'value'
      : sqlState.startsWith('23')
        ? 'invalidResult'
        : 'expressionError';
    return { field, by: 'conversion', reason, operationIndex };
  }
  const reason = sqlState === '42846' ? 'noCast' : sqlState.startsWith('22') ? 'value' : undefined;
  return reason === undefined ? undefined : { field, by: 'cast', reason, operationIndex };
}

export function createPostgresMigrationRunner(
  family: SqlControlFamilyInstance,
): SqlMigrationRunner<PostgresPlanTargetDetails> {
  return new PostgresMigrationRunner(family);
}

class PostgresMigrationRunner implements SqlMigrationRunner<PostgresPlanTargetDetails> {
  constructor(private readonly family: SqlControlFamilyInstance) {}

  /**
   * Body of the migration runner without transaction management. The
   * caller ({@link PostgresMigrationRunner.execute}) owns the
   * `BEGIN`/`COMMIT`/`ROLLBACK` lifecycle.
   */
  async executeOnConnection(
    options: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>,
  ): Promise<SqlMigrationRunnerResult> {
    const driver = options.driver;
    if (options.space !== undefined && options.space !== options.plan.spaceId) {
      throw postgresError(
        'MIGRATION.CONTRACT_SPACE_VIOLATION',
        `SqlMigrationRunner: options.space (${options.space}) does not match plan.spaceId (${options.plan.spaceId})`,
        { meta: { space: options.space, planSpaceId: options.plan.spaceId } },
      );
    }
    const space = options.plan.spaceId;

    // Materialize any async ops before running checks or executing.
    const planOps = blindCast<
      readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[],
      'ops were produced by the PG planner and are SqlMigrationPlanOperation<PostgresPlanTargetDetails>; MigrationPlan.operations uses the wider framework type to accommodate Promise covariance'
    >(await Promise.all(options.plan.operations));

    // Static checks (idempotent — safe to run again when the caller is
    // `execute(...)` because the cost is a single object comparison).
    const destinationCheck = this.ensurePlanMatchesDestinationContract(
      options.plan.destination,
      options.destinationContract,
    );
    if (!destinationCheck.ok) return destinationCheck;

    const policyCheck = this.enforcePolicyCompatibility(options.policy, planOps);
    if (!policyCheck.ok) return policyCheck;

    await this.acquireLock(driver);
    const ensureResult = await this.ensureControlTables(driver, options.destinationContract);
    if (!ensureResult.ok) return ensureResult;
    const existingMarker = await this.family.readMarker({ driver, space });

    const markerCheck = this.ensureMarkerCompatibility(existingMarker, options.plan);
    if (!markerCheck.ok) return markerCheck;

    const markerAtDestination = this.markerMatchesDestination(existingMarker, options.plan);
    const isSelfEdge = options.plan.origin?.storageHash === options.plan.destination.storageHash;
    const skipOperations = markerAtDestination && options.plan.origin != null && !isSelfEdge;
    let applyValue: ApplyPlanSuccessValue;

    if (skipOperations) {
      applyValue = { operationsExecuted: 0, executedOperations: [] };
    } else {
      const applyResult = await this.applyPlan(driver, options, planOps);
      if (!applyResult.ok) return applyResult;
      applyValue = applyResult.value;
    }

    // Verify the schema on app-space only: extension spaces don't own
    // user-facing tables, so verifying the destination contract against the
    // database would flag every app-space table as "extra". Delegates to the
    // family `verifySchema` — the same comparison the CLI verify runs.
    if (space === APP_SPACE_ID) {
      const schemaNode = await this.family.introspect({
        driver,
        contract: options.destinationContract,
      });
      const schemaVerifyResult = this.family.verifySchema({
        contract: options.destinationContract,
        schema: schemaNode,
        strict: options.strictVerification ?? true,
        frameworkComponents: options.frameworkComponents,
      });
      if (!schemaVerifyResult.ok) {
        return runnerFailure('MIGRATION.SCHEMA_VERIFY_FAILED', schemaVerifyResult.summary, {
          why: schemaCheckWhy(schemaVerifyResult.schema.issues),
          meta: { schemaIssues: schemaVerifyResult.schema.issues },
        });
      }
    }

    const incomingInvariants = options.plan.providedInvariants ?? [];
    const existingInvariants = new Set(existingMarker?.invariants ?? []);
    const incomingIsSubsetOfExisting = incomingInvariants.every((id) => existingInvariants.has(id));
    const isSelfEdgeNoOp =
      isSelfEdge && applyValue.operationsExecuted === 0 && incomingIsSubsetOfExisting;

    if (!isSelfEdgeNoOp) {
      const markerResult = await this.upsertMarker(driver, options, existingMarker, space);
      if (!markerResult.ok) return markerResult;
      await this.recordLedgerEntries(
        driver,
        options,
        applyValue.executedOperations,
        planOps.length,
      );
    }

    return runnerSuccess({
      operationsPlanned: planOps.length,
      operationsExecuted: applyValue.operationsExecuted,
    });
  }

  async execute(options: {
    readonly driver: SqlControlDriverInstance<string>;
    readonly perSpaceOptions: ReadonlyArray<
      SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>
    >;
  }): Promise<MigrationRunnerResult> {
    const driver = options.driver;
    const perSpaceOptions = options.perSpaceOptions;

    if (perSpaceOptions.length === 0) {
      return ok({ perSpaceResults: [] });
    }

    await this.beginTransaction(driver);
    let result: MigrationRunnerResult;
    try {
      result = await this.executeSpaces(driver, perSpaceOptions);
    } catch (error) {
      await this.rollbackAfterFailure(driver);
      throw error;
    }
    if (!result.ok) {
      await this.rollbackAfterFailure(driver);
      return notOk(withDatabaseUnchanged(result.failure, true));
    }
    try {
      await this.commitTransaction(driver);
    } catch (error) {
      await this.rollbackAfterFailure(driver);
      throw error;
    }
    return result;
  }

  // Runs only after a failure, which is what the caller reports: a ROLLBACK that also fails, for
  // example on a lost connection, must not replace it.
  private async rollbackAfterFailure(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
  ): Promise<void> {
    await this.rollbackTransaction(driver).catch(() => undefined);
  }

  private async executeSpaces(
    driver: SqlControlDriverInstance<string>,
    perSpaceOptions: ReadonlyArray<SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>>,
  ): Promise<MigrationRunnerResult> {
    const perSpaceResults: Array<{
      space: string;
      value: SqlMigrationRunnerSuccessValue;
    }> = [];
    for (const spaceOptions of perSpaceOptions) {
      const space = spaceOptions.space ?? spaceOptions.plan.spaceId;
      const result = await this.executeOnConnection({ ...spaceOptions, driver, space });
      if (!result.ok) {
        return notOk(withFailingSpace(result.failure, space));
      }
      perSpaceResults.push({ space, value: result.value });
    }
    return ok({ perSpaceResults });
  }

  private async applyPlan(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    options: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>,
    ops: readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[],
  ): Promise<Result<ApplyPlanSuccessValue, SqlMigrationRunnerFailure>> {
    const checks = options.executionChecks;
    const runPrechecks = checks?.prechecks !== false; // Default true
    const runPostchecks = checks?.postchecks !== false; // Default true
    const runIdempotency = checks?.idempotencyChecks !== false; // Default true

    let operationsExecuted = 0;
    const executedOperations: Array<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> = [];
    for (const operation of ops) {
      options.callbacks?.onOperationStart?.(operation);
      try {
        // Idempotency probe: only run if both postchecks and idempotency checks are enabled
        if (runPostchecks && runIdempotency) {
          const postcheckAlreadySatisfied = await this.expectationsAreSatisfied(
            driver,
            operation.postcheck,
          );
          if (postcheckAlreadySatisfied) {
            executedOperations.push(this.createPostcheckPreSatisfiedSkipRecord(operation));
            continue;
          }
        }

        const position: PlanPosition = {
          contract: options.destinationContract,
          operationIndex: ops.indexOf(operation),
          operations: ops,
          edges: options.migrationEdges,
        };

        // Prechecks: only run if enabled
        if (runPrechecks) {
          const precheckResult = await this.runExpectationSteps(
            driver,
            operation.precheck,
            operation,
            'precheck',
            position,
          );
          if (!precheckResult.ok) {
            return precheckResult;
          }
        }

        const executeResult = await this.runExecuteSteps(driver, operation, position);
        if (!executeResult.ok) {
          return executeResult;
        }

        // Postchecks: only run if enabled
        if (runPostchecks) {
          const postcheckResult = await this.runExpectationSteps(
            driver,
            operation.postcheck,
            operation,
            'postcheck',
            position,
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
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    contract: Contract<SqlStorage>,
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
    const lowererContext = { contract };
    const bootstrapQueries = this.family.bootstrapControlTableQueries();
    const [schemaQuery, ...tableQueries] = bootstrapQueries;
    if (schemaQuery === undefined) {
      throw new InternalError('Postgres control-table bootstrap must include CREATE SCHEMA');
    }
    await this.executeStatement(driver, await this.family.lowerAst(schemaQuery, lowererContext));
    for (const query of tableQueries) {
      await this.executeStatement(driver, await this.family.lowerAst(query, lowererContext));
    }
    return okVoid();
  }

  private async runExpectationSteps(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    steps: readonly SqlMigrationPlanOperationStep[],
    operation: SqlMigrationPlanOperation<PostgresPlanTargetDetails>,
    phase: 'precheck' | 'postcheck',
    plan: PlanPosition,
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
    for (const step of steps) {
      const result = await driver.query(step.sql, step.params ?? []);
      if (!this.stepResultIsTrue(result.rows)) {
        const code =
          phase === 'precheck' ? 'MIGRATION.PRECHECK_FAILED' : 'MIGRATION.POSTCHECK_FAILED';
        const failed = `Operation ${operation.id} failed during ${phase}: ${step.description}`;
        const blockedSchema = schemaContentsOf(step);
        const objects =
          blockedSchema === undefined
            ? undefined
            : await driver.query<BlockingObject>(SCHEMA_OBJECTS_SQL, [blockedSchema]);
        if (blockedSchema !== undefined && objects !== undefined && objects.rows.length > 0) {
          const blockingObjects = schemaBlockingObjects(blockedSchema, objects.rows);
          return runnerFailure(code, schemaObjectsSummary(blockedSchema, blockingObjects), {
            why: failed,
            meta: {
              failedCheck: { operationId: operation.id, phase, description: step.description },
              blockingObjects,
            },
          });
        }
        const required = requiredColumnOf(step);
        const rowsWithoutValue =
          required === undefined
            ? undefined
            : await this.rowsWithoutValue(driver, operation, required, plan);
        const failedCheck = {
          operationId: operation.id,
          phase,
          description: step.description,
          ...ifDefined('expectation', step.expectation),
        };
        const holding =
          phase === 'precheck'
            ? await this.rowsHoldingValue(driver, step, operation, plan.operationIndex)
            : undefined;
        if (holding !== undefined) {
          return runnerFailure(code, holding.summary, {
            why: failed,
            meta: { failedCheck, rowsHoldingValue: holding.report },
          });
        }
        return runnerFailure(code, rowsWithoutValue?.summary ?? failed, {
          ...ifDefined(
            'why',
            rowsWithoutValue !== undefined
              ? failed
              : phase === 'precheck'
                ? failedPrecheckWhy(failedCheck)
                : failedPostcheckWhy(failedCheck),
          ),
          meta: {
            failedCheck,
            ...ifDefined('rowsWithoutValue', rowsWithoutValue?.reports),
          },
        });
      }
    }
    return okVoid();
  }

  /**
   * Counts the rows that hold the stored value a removal check guards, as `rowsHoldingValueMeta`
   * marks the check. A count that fails leaves the failure without it.
   */
  private async rowsHoldingValue(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    step: SqlMigrationPlanOperationStep,
    operation: SqlMigrationPlanOperation<PostgresPlanTargetDetails>,
    operationIndex: number,
  ): Promise<{ readonly summary: string; readonly report: RowsHoldingValue } | undefined> {
    const mark = rowsHoldingValueOf(step);
    const details = operation.target.details;
    const stored = step.params?.[0];
    if (mark === undefined || details?.table === undefined) return undefined;
    if (typeof stored !== 'string' && typeof stored !== 'number') return undefined;
    const { table } = details;
    let rows: number;
    try {
      const counted = await driver.query<{ rows: number }>(
        `SELECT COUNT(*)::int AS rows FROM ${qualifyTableName(details.schema, table)} WHERE ${quoteIdentifier(details.name)} = $1`,
        [stored],
      );
      rows = counted.rows[0]?.rows ?? 0;
    } catch {
      return undefined;
    }
    return {
      summary: rowsHoldingValueSummary(table, details.name, stored, rows),
      report: {
        enumValue: mark.enumValue,
        value: stored,
        rows,
        operationIndex,
        keepDataEdit: keepRowsEdit({ ...details, table }, mark),
      },
    };
  }

  /**
   * Counts the rows the failed step's column has no value in, then those of every other column the
   * failed operation's migration makes required.
   */
  private rowsWithoutValue(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    operation: SqlMigrationPlanOperation<PostgresPlanTargetDetails>,
    required: RequiredColumn,
    plan: PlanPosition,
  ): ReturnType<typeof rowsWithoutValueFailure> {
    return rowsWithoutValueFailure({
      failed: [{ operation, operationIndex: plan.operationIndex, required }],
      others: requiredColumnsOfMigration(plan.operations, plan.edges, plan.operationIndex),
      count: async ({ operation: marked, required: column }) => {
        const schema = marked.target.details?.schema;
        if (schema === undefined) return 0;
        const where =
          column.reason !== 'newField' ? ` WHERE ${quoteIdentifier(column.column)} IS NULL` : '';
        const counted = await driver.query<{ rows: number }>(
          `SELECT COUNT(*)::int AS rows FROM ${qualifyTableName(schema, column.table)}${where}`,
        );
        return counted.rows[0]?.rows ?? 0;
      },
      contract: plan.contract,
    });
  }

  private async runExecuteSteps(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    operation: SqlMigrationPlanOperation<PostgresPlanTargetDetails>,
    plan: PlanPosition,
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
    for (const step of operation.execute) {
      try {
        await driver.query(step.sql, step.params ?? []);
      } catch (error: unknown) {
        if (SqlConnectionError.is(error)) {
          return runnerFailure(
            'MIGRATION.EXECUTION_FAILED',
            `Operation ${operation.id} failed during execution: ${step.description}`,
            {
              why: error.message,
              meta: {
                operationId: operation.id,
                stepDescription: step.description,
                sql: step.sql,
                sqlState: error.sqlState,
                connectionLost: true,
                transient: error.transient,
              },
            },
          );
        }
        if (SqlQueryError.is(error)) {
          const failingCheck =
            error.sqlState === CHECK_VIOLATION
              ? rowsFailingCheckOf({
                  operation,
                  constraint: error.constraint,
                  storage: plan.contract.storage,
                  operations: plan.operations,
                  operationIndex: plan.operationIndex,
                })
              : undefined;
          if (failingCheck !== undefined) {
            return runnerFailure('MIGRATION.EXECUTION_FAILED', failingCheck.summary, {
              why: failingCheck.why,
              meta: {
                rowsFailingCheck: failingCheck.fact,
                operationId: operation.id,
                stepDescription: step.description,
                sqlState: error.sqlState,
                constraint: error.constraint,
                table: error.table,
              },
            });
          }
          const dependents =
            error.sqlState === DEPENDENT_OBJECTS_STILL_EXIST ? dependentsOf(error.detail) : [];
          const details = operation.target.details;
          return runnerFailure(
            'MIGRATION.EXECUTION_FAILED',
            dependents.length > 0 && details !== undefined
              ? dependentsSummary(details, operation.label, dependents)
              : `Operation ${operation.id} failed during execution: ${step.description}`,
            {
              why: error.message,
              meta: {
                ...ifDefined('failedTypeChange', failedTypeChangeOf(step, error.sqlState, plan)),
                ...ifDefined('blockingObjects', dependents.length > 0 ? dependents : undefined),
                operationId: operation.id,
                stepDescription: step.description,
                sql: step.sql,
                sqlState: error.sqlState,
                constraint: error.constraint,
                table: error.table,
                column: error.column,
                detail: error.detail,
              },
            },
          );
        }
        throw error;
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
    if (typeof firstValue === 'boolean') {
      return firstValue;
    }
    if (typeof firstValue === 'number') {
      return firstValue !== 0;
    }
    if (typeof firstValue === 'string') {
      const lower = firstValue.toLowerCase();
      // PostgreSQL boolean representations: 't'/'f', 'true'/'false', '1'/'0'
      if (lower === 't' || lower === 'true' || lower === '1') {
        return true;
      }
      if (lower === 'f' || lower === 'false' || lower === '0') {
        return false;
      }
      // For other strings, non-empty is truthy (though this case shouldn't occur for boolean checks)
      return firstValue.length > 0;
    }
    return Boolean(firstValue);
  }

  private async expectationsAreSatisfied(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
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

  private createPostcheckPreSatisfiedSkipRecord(
    operation: SqlMigrationPlanOperation<PostgresPlanTargetDetails>,
  ): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
    // Clone and freeze existing meta if present
    const clonedMeta = operation.meta ? cloneAndFreezeRecord(operation.meta) : undefined;

    // Create frozen runner metadata
    const runnerMeta = Object.freeze({
      skipped: true,
      reason: 'postcheck_pre_satisfied',
    });

    // Merge and freeze the combined meta
    const mergedMeta = Object.freeze({
      ...(clonedMeta ?? {}),
      runner: runnerMeta,
    });

    // Clone and freeze arrays to prevent mutation
    const frozenPostcheck = Object.freeze([...operation.postcheck]);

    return Object.freeze({
      id: operation.id,
      label: operation.label,
      ...ifDefined('summary', operation.summary),
      operationClass: operation.operationClass,
      target: operation.target, // Already frozen from plan creation
      precheck: Object.freeze([]),
      execute: Object.freeze([]),
      postcheck: frozenPostcheck,
      ...ifDefined('meta', operation.meta || mergedMeta ? mergedMeta : undefined),
    });
  }

  private markerMatchesDestination(
    marker: ContractMarkerRecord | null,
    plan: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['plan'],
  ): boolean {
    if (!marker) {
      return false;
    }
    if (marker.storageHash !== plan.destination.storageHash) {
      return false;
    }
    if (plan.destination.profileHash && marker.profileHash !== plan.destination.profileHash) {
      return false;
    }
    return true;
  }

  private enforcePolicyCompatibility(
    policy: MigrationOperationPolicy,
    operations: readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[],
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
    plan: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['plan'],
  ): Result<void, SqlMigrationRunnerFailure> {
    const origin = plan.origin ?? null;
    if (!origin) {
      // No origin assertion on the plan — the caller does not want origin validation.
      // This is the case for `db update`, which introspects the live schema and does not
      // rely on marker continuity. `db init` handles its own marker checks before the runner.
      return okVoid();
    }

    if (!marker) {
      return runnerFailure(
        'MIGRATION.MARKER_ORIGIN_MISMATCH',
        `Missing contract marker: expected origin storage hash ${origin.storageHash}.`,
        {
          meta: {
            expectedOriginStorageHash: origin.storageHash,
          },
        },
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
    contract: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['destinationContract'],
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
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    options: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>,
    existingMarker: ContractMarkerRecord | null,
    space: string,
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
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
      const found = await this.family.readMarker({ driver, space });
      return runnerFailure(
        'MIGRATION.MARKER_CAS_FAILURE',
        'Marker was modified by another process during migration execution.',
        {
          meta: {
            space,
            expectedStorageHash: existingMarker.storageHash,
            foundStorageHash: found?.storageHash ?? null,
            destinationStorageHash: options.plan.destination.storageHash,
          },
        },
      );
    }
    return okVoid();
  }

  private async recordLedgerEntries(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    options: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>,
    executedOperations: readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[],
    planOpsLength: number,
  ): Promise<void> {
    const plan = options.plan;
    const space = plan.spaceId;
    const edges = options.migrationEdges;
    const totalEdgeOps = edges.reduce((sum, edge) => sum + edge.operationCount, 0);
    if (totalEdgeOps !== planOpsLength) {
      throw new InternalError(
        `Ledger write: plan.operations length (${planOpsLength}) does not match sum of migrationEdges operationCount (${totalEdgeOps})`,
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
          ...ifDefined('destinationContractJson', edge.destinationContractJson),
        },
      });
    }
  }

  private async acquireLock(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query(MARKER_LOCK_SQL, [MARKER_LOCK_KEY]);
  }

  private async beginTransaction(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('BEGIN');
  }

  private async commitTransaction(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('COMMIT');
  }

  private async rollbackTransaction(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('ROLLBACK');
  }

  private async executeStatement(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    statement: SqlExecuteRequest,
  ): Promise<void> {
    await driver.query(statement.sql, statement.params);
  }
}
