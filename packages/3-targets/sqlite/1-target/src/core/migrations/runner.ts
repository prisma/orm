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
  fieldOfColumn,
  keepRowsEdit,
  requiredColumnsOfMigration,
  rowsHoldingValueFailure,
  rowsHoldingValueOf,
  rowsWithoutValueFailure,
  runnerFailure,
  runnerSuccess,
  unconvertedFieldOf,
} from '@internal/family-sql/control';
import type {
  FailedConversion,
  MigrationRunnerResult,
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
import { sqliteError } from '../errors';
import { quoteIdentifier } from '../sql-utils';
import { verifySqliteDatabaseSchema } from './diff-database-schema';
import { affinityStorageClasses, conversionCopyOf, rebuiltTableName } from './operations/tables';
import type { SqlitePlanTargetDetails } from './planner-target-details';
import { sqliteMarkedRemoval, sqliteStoredValueCallClasses } from './stored-value-calls';

const NOT_NULL_VIOLATION_SQLSTATE = '23502';

/** Where a failed operation sits in its plan, and what the runner needs to name what blocked it. */
interface PlanPosition {
  readonly contract: Contract<SqlStorage>;
  readonly operationIndex: number;
  readonly operations: readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[];
  readonly edges: readonly { readonly operationCount: number }[];
}

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
        frameworkComponents: options.frameworkComponents,
      });
      if (!schemaVerifyResult.ok) {
        return runnerFailure('MIGRATION.SCHEMA_VERIFY_FAILED', schemaVerifyResult.summary, {
          why: schemaCheckWhy(schemaVerifyResult.schema.issues),
          meta: { schemaIssues: schemaVerifyResult.schema.issues },
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

    let result: MigrationRunnerResult;
    try {
      result = await this.executeInTransaction(driver, perSpaceOptions, fkWasEnabled);
    } catch (error) {
      if (fkWasEnabled) await this.afterFailure(driver.query('PRAGMA foreign_keys = ON'));
      throw error;
    }
    if (fkWasEnabled) {
      const restore = driver.query('PRAGMA foreign_keys = ON');
      await (result.ok ? restore : this.afterFailure(restore));
    }
    return result;
  }

  private async executeInTransaction(
    driver: SqlControlDriverInstance<string>,
    perSpaceOptions: ReadonlyArray<SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>>,
    fkWasEnabled: boolean,
  ): Promise<MigrationRunnerResult> {
    await this.beginExclusiveTransaction(driver);
    let result: MigrationRunnerResult;
    try {
      result = await this.executeSpaces(driver, perSpaceOptions, fkWasEnabled);
    } catch (error) {
      await this.afterFailure(this.rollbackTransaction(driver));
      throw error;
    }
    if (!result.ok) {
      await this.afterFailure(this.rollbackTransaction(driver));
      return notOk(withDatabaseUnchanged(result.failure, true));
    }
    try {
      await this.commitTransaction(driver);
    } catch (error) {
      await this.afterFailure(this.rollbackTransaction(driver));
      throw error;
    }
    return result;
  }

  // Cleanup that runs only after a failure, which is what the caller reports: cleanup that also
  // fails, for example on a closed database, must not replace it.
  private async afterFailure(cleanup: Promise<unknown>): Promise<void> {
    await cleanup.catch(() => undefined);
  }

  private async executeSpaces(
    driver: SqlControlDriverInstance<string>,
    perSpaceOptions: ReadonlyArray<SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>>,
    fkWasEnabled: boolean,
  ): Promise<MigrationRunnerResult> {
    const perSpaceResults: Array<{
      space: string;
      value: SqlMigrationRunnerSuccessValue;
    }> = [];
    let lastProcessedSpace: string | undefined;
    for (const spaceOptions of perSpaceOptions) {
      const space = spaceOptions.space ?? spaceOptions.plan.spaceId;
      const result = await this.executeOnConnection({ ...spaceOptions, driver, space });
      if (!result.ok) {
        return notOk(withFailingSpace(result.failure, space));
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
        return notOk(
          withFailingSpace(fkIntegrityCheck.failure, lastProcessedSpace ?? APP_SPACE_ID),
        );
      }
    }
    return ok({ perSpaceResults });
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
            { contract: options.destinationContract, operationIndex: ops.indexOf(operation) },
          );
          if (!precheckResult.ok) {
            return precheckResult;
          }
        }

        const executeResult = await this.runExecuteSteps(driver, operation.execute, operation, {
          contract: options.destinationContract,
          operationIndex: ops.indexOf(operation),
          operations: ops,
          edges: options.migrationEdges,
        });
        if (!executeResult.ok) {
          return executeResult;
        }

        if (runPostchecks) {
          const postcheckResult = await this.runExpectationSteps(
            driver,
            operation.postcheck,
            operation,
            'postcheck',
            { contract: options.destinationContract, operationIndex: ops.indexOf(operation) },
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
    const lowererContext = { contract };
    for (const query of this.family.bootstrapControlTableQueries()) {
      await this.executeStatement(driver, await this.family.lowerAst(query, lowererContext));
    }
    return okVoid();
  }

  private async runExpectationSteps(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    steps: readonly SqlMigrationPlanOperationStep[],
    operation: SqlMigrationPlanOperation<SqlitePlanTargetDetails>,
    phase: 'precheck' | 'postcheck',
    plan?: { readonly contract: Contract<SqlStorage>; readonly operationIndex: number },
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
    for (const step of steps) {
      const result = await driver.query(step.sql, step.params ?? []);
      if (!this.stepResultIsTrue(result.rows)) {
        const code =
          phase === 'precheck' ? 'MIGRATION.PRECHECK_FAILED' : 'MIGRATION.POSTCHECK_FAILED';
        const field = plan === undefined ? undefined : unconvertedFieldOf(step, plan.contract);
        const converted = convertedColumnOf(step);
        const failedCheck = {
          operationId: operation.id,
          phase,
          description: step.description,
          ...ifDefined('expectation', step.expectation),
        };
        const holding =
          phase === 'precheck' && plan !== undefined
            ? await this.rowsHoldingValue(driver, step, operation, plan.operationIndex)
            : undefined;
        if (holding !== undefined) {
          return runnerFailure(code, holding.summary, {
            why: `Operation ${operation.id} failed during ${phase}: ${step.description}`,
            meta: { failedCheck, rowsHoldingValue: holding.report },
          });
        }
        const unconverted =
          converted === undefined ? undefined : await this.unconvertedValueText(driver, converted);
        return runnerFailure(
          code,
          `Operation ${operation.id} failed during ${phase}: ${step.description}`,
          {
            ...ifDefined(
              'why',
              unconverted ??
                (phase === 'precheck'
                  ? failedPrecheckWhy(failedCheck)
                  : failedPostcheckWhy(failedCheck)),
            ),
            meta: {
              failedCheck,
              ...ifDefined(
                'failedTypeChange',
                field === undefined || plan === undefined || converted === undefined
                  ? undefined
                  : converted.by === 'conversion'
                    ? {
                        field,
                        by: 'conversion' as const,
                        reason: 'invalidResult' as const,
                        operationIndex: plan.operationIndex,
                      }
                    : {
                        field,
                        by: 'cast' as const,
                        reason: 'value' as const,
                        operationIndex: plan.operationIndex,
                      },
              ),
            },
          },
        );
      }
    }
    return okVoid();
  }

  /**
   * Counts the rows that hold the stored value a removal check guards, as `rowsHoldingValueMeta`
   * marks the check. A count that fails leaves the failure without it.
   */
  private rowsHoldingValue(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    step: SqlMigrationPlanOperationStep,
    operation: SqlMigrationPlanOperation<SqlitePlanTargetDetails>,
    operationIndex: number,
  ): ReturnType<typeof rowsHoldingValueFailure> {
    const mark = rowsHoldingValueOf(step);
    if (mark === undefined) return Promise.resolve(undefined);
    return rowsHoldingValueFailure({
      failed: { operation, operationIndex, mark },
      count: async ({ mark: counted }) => {
        const rows = await driver.query<{ rows: number }>(
          `SELECT COUNT(*) AS rows FROM ${quoteIdentifier(counted.table)} WHERE ${quoteIdentifier(counted.column)} = ?`,
          [counted.storedValue],
        );
        return Number(rows.rows[0]?.rows ?? 0);
      },
      keepDataEdit: ({ mark: kept }) =>
        keepRowsEdit(sqliteMarkedRemoval(kept), kept, sqliteStoredValueCallClasses),
    });
  }

  /** Names the first value of a retyped column that kept a storage class its new type does not hold. */
  private async unconvertedValueText(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    cast: { readonly table: string; readonly column: string },
  ): Promise<string | undefined> {
    const declared = await driver.query<{ type: string }>(
      'SELECT type FROM pragma_table_info(?) WHERE name = ?',
      [cast.table, cast.column],
    );
    const typeSql = declared.rows[0]?.type;
    if (typeSql === undefined) return undefined;
    const column = quoteIdentifier(cast.column);
    const classes = ['null', ...affinityStorageClasses(typeSql)];
    const found = await driver.query<{ value: string; storageClass: string }>(
      `SELECT quote(${column}) AS value, typeof(${column}) AS storageClass FROM ${quoteIdentifier(cast.table)} WHERE typeof(${column}) NOT IN (${classes.map(() => '?').join(', ')}) LIMIT 1`,
      classes,
    );
    const row = found.rows[0];
    if (row === undefined) return undefined;
    const value = row.value.length > 40 ? `${row.value.slice(0, 40)}…` : row.value;
    return `The value ${value} of column "${cast.column}" on "${cast.table}" is still stored as ${row.storageClass}, which ${typeSql} cannot hold.`;
  }

  private async runExecuteSteps(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    steps: readonly SqlMigrationPlanOperationStep[],
    operation: SqlMigrationPlanOperation<SqlitePlanTargetDetails>,
    plan: PlanPosition,
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
    for (const step of steps) {
      try {
        await driver.query(step.sql, step.params ?? []);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const failed = `Operation ${operation.id} failed during execution: ${step.description}`;
        if (SqlConnectionError.is(error)) {
          // A transient connection error (a busy or locked database) leaves the connection open.
          return runnerFailure('MIGRATION.EXECUTION_FAILED', failed, {
            why: message,
            meta: {
              operationId: operation.id,
              stepDescription: step.description,
              sql: step.sql,
              connectionLost: error.transient === false,
              transient: error.transient,
            },
          });
        }
        const rowsWithoutValue = await this.rowsWithoutValue(driver, error, plan);
        const failedConversion =
          rowsWithoutValue === undefined
            ? await this.failedConversion(driver, step, error, plan)
            : undefined;
        return runnerFailure('MIGRATION.EXECUTION_FAILED', rowsWithoutValue?.summary ?? failed, {
          why: rowsWithoutValue === undefined ? message : `${failed}: ${message}`,
          meta: {
            operationId: operation.id,
            stepDescription: step.description,
            sql: step.sql,
            ...ifDefined('rowsWithoutValue', rowsWithoutValue?.reports),
            ...ifDefined('failedTypeChange', failedConversion),
          },
        });
      }
    }
    return okVoid();
  }

  /**
   * The conversion that failed, when the failed step is the copy of a rebuild that converts columns
   * and there is evidence for it: a copy expression that fails on its own has an error in its
   * expression, and a constraint of the new table that names a converted column was broken by a
   * value the conversion produced. Any other failure of the copy is not the conversion's.
   */
  private async failedConversion(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    step: SqlMigrationPlanOperationStep,
    error: unknown,
    plan: PlanPosition,
  ): Promise<FailedConversion | undefined> {
    const copy = conversionCopyOf(step);
    if (copy === undefined) return undefined;
    const columns = Object.keys(copy.expressions);
    const failed = async (column: string): Promise<boolean> => {
      try {
        await driver.query(
          `SELECT ${copy.expressions[column]} FROM ${quoteIdentifier(copy.table)}`,
        );
        return false;
      } catch {
        return true;
      }
    };
    for (const column of columns) {
      if (await failed(column)) {
        return this.conversionOf(plan, copy.table, column, 'expressionError');
      }
    }
    const constrainedList = SqlQueryError.is(error) ? error.constraint : undefined;
    if (constrainedList === undefined) return undefined;
    const constrained = new Set(constrainedList.split(', '));
    const column = columns.find((name) =>
      constrained.has(`${rebuiltTableName(copy.table)}.${name}`),
    );
    return column === undefined
      ? undefined
      : this.conversionOf(plan, copy.table, column, 'invalidResult');
  }

  private conversionOf(
    plan: PlanPosition,
    table: string,
    column: string,
    reason: FailedConversion['reason'],
  ): FailedConversion | undefined {
    const field = fieldOfColumn(plan.contract, table, column);
    return field === undefined
      ? undefined
      : { field, by: 'conversion', reason, operationIndex: plan.operationIndex };
  }

  /**
   * The rows a table rebuild found no value for, when its copy failed on a NOT NULL column of the
   * new table: the columns the rebuild's postchecks mark as becoming required are counted, the
   * rebuild's own first, then those of every other operation of its migration.
   */
  private rowsWithoutValue(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    error: unknown,
    plan: PlanPosition,
  ): ReturnType<typeof rowsWithoutValueFailure> {
    if (!(SqlQueryError.is(error) && error.sqlState === NOT_NULL_VIOLATION_SQLSTATE)) {
      return Promise.resolve(undefined);
    }
    const marks = requiredColumnsOfMigration(plan.operations, plan.edges, plan.operationIndex);
    return rowsWithoutValueFailure({
      failed: marks.filter((mark) => mark.operationIndex === plan.operationIndex),
      others: marks,
      count: async ({ required }) => {
        const where =
          required.reason !== 'newField'
            ? ` WHERE ${quoteIdentifier(required.column)} IS NULL`
            : '';
        const counted = await driver.query<{ rows: number }>(
          `SELECT COUNT(*) AS rows FROM ${quoteIdentifier(required.table)}${where}`,
        );
        return counted.rows[0]?.rows ?? 0;
      },
      contract: plan.contract,
    });
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
