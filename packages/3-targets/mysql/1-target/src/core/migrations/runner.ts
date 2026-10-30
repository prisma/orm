import type { ContractMarkerRecord } from '@internal/contract/types';
import {
  type MigrationOperationPolicy,
  runnerFailure,
  runnerSuccess,
  type SqlControlFamilyInstance,
  type SqlMigrationPlanContractInfo,
  type SqlMigrationPlanOperationStep,
  type SqlMigrationRunner,
  type SqlMigrationRunnerExecuteOptions,
  type SqlMigrationRunnerFailure,
  type SqlMigrationRunnerResult,
  type SqlMigrationRunnerSuccessValue,
} from '@internal/family-sql/control';
import {
  failedPostcheckWhy,
  failedPrecheckWhy,
  type MigrationRunnerFailure,
  type MigrationRunnerResult,
  migrationRunnerFailure,
  schemaCheckWhy,
  withDatabaseUnchanged,
  withFailingSpace,
} from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError, isInternalError } from '@internal/utils/internal-error';
import { notOk, ok, okVoid, type Result } from '@internal/utils/result';
import { isStructuredError, type StructuredError } from '@internal/utils/structured-error';
import { mysqlError } from '../errors';
import { withMarkerLock } from '../marker-lock';
import type { Op } from './operations';
import type { MysqlPlanTargetDetails } from './planner-target-details';

type Options = SqlMigrationRunnerExecuteOptions<MysqlPlanTargetDetails>;
type Driver = SqlControlDriverInstance<string>;
type Checked = Result<void, SqlMigrationRunnerFailure>;

interface AppliedOperations {
  readonly result: Checked;
  readonly executed: readonly Op[];
  readonly executedCount: number;
}

/** Whether a space's apply has changed the database so far; it stays set however the apply ends, a thrown error included. */
interface SpaceProgress {
  changedDatabase: boolean;
}

/** An error without a structured code, such as a driver's socket error, thrown while a space applied: reported as `MIGRATION.EXECUTION_FAILED`, with its own code, when it has one, in `errorCode`. */
function failureFromThrown(error: unknown): MigrationRunnerFailure {
  const errorCode: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
  return migrationRunnerFailure(
    'MIGRATION.EXECUTION_FAILED',
    error instanceof Error ? error.message : String(error),
    { meta: typeof errorCode === 'string' ? { errorCode } : {}, cause: error },
  );
}

/** The structured error thrown while a space applied, keeping its code, advice and docs link, with the space and whether the database changed added to its facts. */
function withSpaceFacts<T extends StructuredError>(
  error: T,
  failingSpace: string,
  databaseUnchanged: boolean,
): T {
  return Object.assign(error, { meta: { ...(error.meta ?? {}), failingSpace, databaseUnchanged } });
}

function stepHolds(rows: readonly Record<string, unknown>[]): boolean {
  const value = rows[0] === undefined ? undefined : Object.values(rows[0])[0];
  if (typeof value === 'string') return value !== '0' && value.length > 0;
  return Boolean(value);
}

function skipRecord(operation: Op): Op {
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

/**
 * The MySQL migration runner. MySQL commits every DDL statement as it runs, so no transaction can undo an apply: the runner applies one space at a time, checks each operation before and after it runs, verifies the space's schema with the caller's strictness (every space, not only the app space), and only then writes the space's marker and ledger entries, in one transaction. A failure leaves the spaces before it applied, and running the apply again skips what already holds. The whole apply holds the marker lock, which MySQL keeps for the session, so it is released on the same connection when the apply ends.
 */
class MysqlMigrationRunner implements SqlMigrationRunner<MysqlPlanTargetDetails> {
  constructor(private readonly family: SqlControlFamilyInstance) {}

  async execute(options: {
    readonly driver: Driver;
    readonly perSpaceOptions: ReadonlyArray<Options>;
  }): Promise<MigrationRunnerResult> {
    const { driver, perSpaceOptions } = options;
    if (perSpaceOptions.length === 0) return ok({ perSpaceResults: [] });
    return withMarkerLock(
      driver,
      () => this.#applySpaces(driver, perSpaceOptions),
      (result) => result.ok,
    );
  }

  async executeOnConnection(options: Options): Promise<SqlMigrationRunnerResult> {
    return this.#applySpace(options, { changedDatabase: false });
  }

  async #applySpaces(
    driver: Driver,
    perSpaceOptions: ReadonlyArray<Options>,
  ): Promise<MigrationRunnerResult> {
    const perSpaceResults: { space: string; value: SqlMigrationRunnerSuccessValue }[] = [];
    let changedBefore = false;
    for (const spaceOptions of perSpaceOptions) {
      const space = spaceOptions.space ?? spaceOptions.plan.spaceId;
      const progress: SpaceProgress = { changedDatabase: false };
      let result: Result<SqlMigrationRunnerSuccessValue, MigrationRunnerFailure>;
      try {
        result = await this.#applySpace({ ...spaceOptions, driver, space }, progress);
      } catch (error) {
        if (isInternalError(error)) throw error;
        const databaseUnchanged = !changedBefore && !progress.changedDatabase;
        if (isStructuredError(error)) throw withSpaceFacts(error, space, databaseUnchanged);
        result = notOk(failureFromThrown(error));
      }
      if (!result.ok) {
        return notOk(
          withFailingSpace(
            withDatabaseUnchanged(result.failure, !changedBefore && !progress.changedDatabase),
            space,
          ),
        );
      }
      changedBefore ||= progress.changedDatabase;
      perSpaceResults.push({ space, value: result.value });
    }
    return ok({ perSpaceResults });
  }

  async #applySpace(options: Options, progress: SpaceProgress): Promise<SqlMigrationRunnerResult> {
    const { driver } = options;
    if (options.space !== undefined && options.space !== options.plan.spaceId) {
      throw mysqlError(
        'MIGRATION.CONTRACT_SPACE_VIOLATION',
        `SqlMigrationRunner: options.space (${options.space}) does not match plan.spaceId (${options.plan.spaceId})`,
        { meta: { space: options.space, planSpaceId: options.plan.spaceId } },
      );
    }
    const space = options.plan.spaceId;
    const operations = blindCast<
      readonly Op[],
      'the MySQL planner and migration class produce MySQL operations; MigrationPlan.operations uses the wider framework type to admit promises'
    >(await Promise.all(options.plan.operations));

    const destinationCheck = this.#checkDestination(
      options.plan.destination,
      options.destinationContract,
    );
    if (!destinationCheck.ok) return destinationCheck;
    const policyCheck = this.#checkPolicy(options.policy, operations);
    if (!policyCheck.ok) return policyCheck;

    await this.#ensureControlTables(driver, options);
    const existingMarker = await this.family.readMarker({ driver, space });
    const originCheck = this.#checkOrigin(existingMarker, options.plan.origin ?? null);
    if (!originCheck.ok) return originCheck;

    const isSelfEdge = options.plan.origin?.storageHash === options.plan.destination.storageHash;
    const atDestination =
      existingMarker !== null &&
      existingMarker.storageHash === options.plan.destination.storageHash &&
      (options.plan.destination.profileHash === undefined ||
        existingMarker.profileHash === options.plan.destination.profileHash);
    const skipOperations = atDestination && options.plan.origin != null && !isSelfEdge;

    const applied: AppliedOperations = skipOperations
      ? { result: okVoid(), executed: [], executedCount: 0 }
      : await this.#applyOperations(driver, options, operations, progress);
    if (!applied.result.ok) return applied.result;

    const schema = await this.family.introspect({ driver, contract: options.destinationContract });
    const verified = this.family.verifySchema({
      contract: options.destinationContract,
      schema,
      strict: options.strictVerification ?? true,
      frameworkComponents: options.frameworkComponents,
    });
    if (!verified.ok) {
      return runnerFailure('MIGRATION.SCHEMA_VERIFY_FAILED', verified.summary, {
        why: schemaCheckWhy(verified.schema.issues),
        meta: { schemaIssues: verified.schema.issues },
      });
    }

    const existingInvariants = new Set(existingMarker?.invariants ?? []);
    const isSelfEdgeNoOp =
      isSelfEdge &&
      applied.executedCount === 0 &&
      options.plan.providedInvariants.every((id) => existingInvariants.has(id)) &&
      options.databasePolicies === undefined;
    if (!isSelfEdgeNoOp) {
      const written = await this.#writeMarkerAndLedger(
        driver,
        options,
        existingMarker,
        applied.executed,
        progress,
      );
      if (!written.ok) return written;
    }
    return runnerSuccess({
      operationsPlanned: operations.length,
      operationsExecuted: applied.executedCount,
    });
  }

  async #ensureControlTables(driver: Driver, options: Options): Promise<void> {
    for (const query of this.family.bootstrapControlTableQueries()) {
      const statement = await this.family.lowerAst(query, {
        contract: options.destinationContract,
      });
      await driver.query(statement.sql, statement.params);
    }
  }

  async #applyOperations(
    driver: Driver,
    options: Options,
    operations: readonly Op[],
    progress: SpaceProgress,
  ): Promise<AppliedOperations> {
    const checks = options.executionChecks;
    const runPrechecks = checks?.prechecks !== false;
    const runPostchecks = checks?.postchecks !== false;
    const runIdempotency = checks?.idempotencyChecks !== false;
    const executed: Op[] = [];
    let executedCount = 0;
    const stop = (result: Checked): AppliedOperations => ({ result, executed, executedCount });
    for (const operation of operations) {
      options.callbacks?.onOperationStart?.(operation);
      try {
        if (runPostchecks && runIdempotency && (await this.#allHold(driver, operation.postcheck))) {
          executed.push(skipRecord(operation));
          continue;
        }
        if (runPrechecks) {
          const precheck = await this.#runChecks(driver, operation, 'precheck');
          if (!precheck.ok) return stop(precheck);
        }
        const execution = await this.#runSteps(driver, operation, progress);
        if (!execution.ok) return stop(execution);
        executedCount += 1;
        if (runPostchecks) {
          const postcheck = await this.#runChecks(driver, operation, 'postcheck');
          if (!postcheck.ok) return stop(postcheck);
        }
        executed.push(operation);
      } finally {
        options.callbacks?.onOperationComplete?.(operation);
      }
    }
    return stop(okVoid());
  }

  async #allHold(
    driver: Driver,
    steps: readonly SqlMigrationPlanOperationStep[],
  ): Promise<boolean> {
    if (steps.length === 0) return false;
    for (const step of steps) {
      if (!stepHolds((await driver.query(step.sql, step.params ?? [])).rows)) return false;
    }
    return true;
  }

  async #runChecks(
    driver: Driver,
    operation: Op,
    phase: 'precheck' | 'postcheck',
  ): Promise<Checked> {
    for (const step of operation[phase]) {
      if (stepHolds((await driver.query(step.sql, step.params ?? [])).rows)) continue;
      const failedCheck = {
        operationId: operation.id,
        phase,
        description: step.description,
        ...ifDefined('expectation', step.expectation),
      };
      return runnerFailure(
        phase === 'precheck' ? 'MIGRATION.PRECHECK_FAILED' : 'MIGRATION.POSTCHECK_FAILED',
        `Operation ${operation.id} failed during ${phase}: ${step.description}`,
        {
          why:
            phase === 'precheck' ? failedPrecheckWhy(failedCheck) : failedPostcheckWhy(failedCheck),
          meta: { failedCheck },
        },
      );
    }
    return okVoid();
  }

  /** Runs an operation's steps, and records in `progress` each one that reached the database, which a DDL statement changes for good. */
  async #runSteps(driver: Driver, operation: Op, progress: SpaceProgress): Promise<Checked> {
    for (const step of operation.execute) {
      try {
        await driver.query(step.sql, step.params ?? []);
        progress.changedDatabase = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return runnerFailure(
          'MIGRATION.EXECUTION_FAILED',
          `Operation ${operation.id} failed during execution: ${step.description}`,
          {
            why: message,
            meta: { operationId: operation.id, stepDescription: step.description, sql: step.sql },
          },
        );
      }
    }
    return okVoid();
  }

  async #writeMarkerAndLedger(
    driver: Driver,
    options: Options,
    existingMarker: ContractMarkerRecord | null,
    executed: readonly Op[],
    progress: SpaceProgress,
  ): Promise<Checked> {
    const { plan } = options;
    const destination = {
      storageHash: plan.destination.storageHash,
      profileHash:
        plan.destination.profileHash ??
        options.destinationContract.profileHash ??
        plan.destination.storageHash,
      invariants: plan.providedInvariants,
      ...ifDefined('databasePolicies', options.databasePolicies),
    };
    await driver.query('START TRANSACTION');
    try {
      if (existingMarker === null) {
        await this.family.initMarker({ driver, space: plan.spaceId, destination });
      } else {
        const swapped = await this.family.updateMarker({
          driver,
          space: plan.spaceId,
          expectedFrom: existingMarker.storageHash,
          destination,
        });
        if (!swapped) {
          await driver.query('ROLLBACK');
          const found = await this.family.readMarker({ driver, space: plan.spaceId });
          return runnerFailure(
            'MIGRATION.MARKER_CAS_FAILURE',
            'Marker was modified by another process during migration execution.',
            {
              meta: {
                space: plan.spaceId,
                expectedStorageHash: existingMarker.storageHash,
                foundStorageHash: found?.storageHash ?? null,
                destinationStorageHash: plan.destination.storageHash,
              },
            },
          );
        }
      }
      await this.#writeLedger(driver, options, executed);
    } catch (error) {
      await driver.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    progress.changedDatabase = true;
    await driver.query('COMMIT');
    return okVoid();
  }

  async #writeLedger(driver: Driver, options: Options, executed: readonly Op[]): Promise<void> {
    const { plan, migrationEdges } = options;
    const edgeOperations = migrationEdges.reduce((sum, edge) => sum + edge.operationCount, 0);
    if (edgeOperations !== plan.operations.length) {
      throw new InternalError(
        `Ledger write: plan.operations length (${plan.operations.length}) does not match sum of migrationEdges operationCount (${edgeOperations})`,
      );
    }
    let offset = 0;
    for (const edge of migrationEdges) {
      const operations = executed.slice(offset, offset + edge.operationCount);
      offset += edge.operationCount;
      await this.family.writeLedgerEntry({
        driver,
        space: plan.spaceId,
        entry: {
          edgeId: `${edge.from}->${edge.to}`,
          from: edge.from,
          to: edge.to,
          migrationName: edge.dirName,
          migrationHash: edge.migrationHash,
          operations,
        },
      });
    }
  }

  #checkDestination(
    destination: SqlMigrationPlanContractInfo,
    contract: Options['destinationContract'],
  ): Checked {
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
      destination.profileHash !== undefined &&
      contract.profileHash !== undefined &&
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

  #checkPolicy(policy: MigrationOperationPolicy, operations: readonly Op[]): Checked {
    const allowed = new Set(policy.allowedOperationClasses);
    const refused = operations.find((operation) => !allowed.has(operation.operationClass));
    if (refused === undefined) return okVoid();
    return runnerFailure(
      'MIGRATION.POLICY_VIOLATION',
      `Operation ${refused.id} has class "${refused.operationClass}" which is not allowed by policy.`,
      {
        why: `Policy only allows: ${policy.allowedOperationClasses.join(', ')}.`,
        meta: {
          operationId: refused.id,
          operationClass: refused.operationClass,
          allowedClasses: policy.allowedOperationClasses,
        },
      },
    );
  }

  #checkOrigin(
    marker: ContractMarkerRecord | null,
    origin: SqlMigrationPlanContractInfo | null,
  ): Checked {
    if (origin === null) return okVoid();
    if (marker === null) {
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
    if (origin.profileHash !== undefined && marker.profileHash !== origin.profileHash) {
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
}

export function createMysqlMigrationRunner(
  family: SqlControlFamilyInstance,
): SqlMigrationRunner<MysqlPlanTargetDetails> {
  return new MysqlMigrationRunner(family);
}
