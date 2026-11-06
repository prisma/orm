import type { Contract } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyInstance,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import type { SnapshotContentVerifier } from '@internal/migration-tools/contract-snapshot-store';
import { ifDefined } from '@internal/utils/defined';
import type { CliInvocation } from '../../utils/printed-command';
import type { AnswerPlanQuestions } from '../statements/plan-questions';
import type { StatementText } from '../statements/statement-text';
import type { DbUpdateResult, OnControlProgress, PlannerWarningsListener } from '../types';
import { executeRun } from './db-run';
import { DB_UPDATE_POLICY } from './db-update-policy';

/**
 * Options for the `db update` operation.
 *
 * Same loader → planner → runner pipeline as `db init`, but with the
 * widened operation policy (additive + widening + destructive). An apply
 * asks `answerQuestions` what each operation that would lose data means and
 * whether each that would change access may run, before it applies anything.
 */
export interface ExecuteDbUpdateOptions<TFamilyId extends string, TTargetId extends string>
  extends PlannerWarningsListener {
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly adapter: ControlAdapterInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  readonly contract: Contract;
  readonly mode: 'plan' | 'apply';
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId, unknown>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  /** Consents to every operation that would lose data, without asking. */
  readonly acceptDataLoss?: boolean;
  /** Consents to every operation that would change who can read or write data, without asking. */
  readonly acceptAccessChanges?: boolean;
  readonly migrationsDir: string;
  readonly targetId: TTargetId;
  readonly extensions?: ReadonlyArray<ControlExtensionDescriptor<TFamilyId, TTargetId>>;
  /** Content check for contract snapshots the aggregate loader resolves. */
  readonly verifySnapshotContent?: SnapshotContentVerifier;
  /**
   * The statements as the user wrote them, in the order given. A `rename` and a convert of a
   * variant are planned; a `delete` or `allow` answers the question about the subject it names.
   * Any other `convert` or `backfill` fails, once resolved, with
   * `MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE`: `db update` has no migration file to fill.
   */
  readonly statements?: readonly StatementText[];
  /** Asks the questions no statement answered; see {@link AnswerPlanQuestions}. */
  readonly answerQuestions: AnswerPlanQuestions;
  /** The command line the advice of a failure repeats. */
  readonly invocation: CliInvocation;
  readonly onProgress?: OnControlProgress;
}

/** Execute `db update` against the configured contract. */
export async function executeDbUpdate<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteDbUpdateOptions<TFamilyId, TTargetId>,
): Promise<DbUpdateResult> {
  return (await executeRun<TFamilyId, TTargetId>({
    driver: options.driver,
    adapter: options.adapter,
    familyInstance: options.familyInstance,
    contract: options.contract,
    migrations: options.migrations,
    frameworkComponents: options.frameworkComponents,
    migrationsDir: options.migrationsDir,
    targetId: options.targetId,
    extensions: options.extensions ?? [],
    policy: DB_UPDATE_POLICY,
    invocation: options.invocation,
    action: 'dbUpdate',
    mode: options.mode,
    statements: options.statements ?? [],
    answerQuestions: options.answerQuestions,
    acceptDataLoss: options.acceptDataLoss ?? false,
    acceptAccessChanges: options.acceptAccessChanges ?? false,
    ...ifDefined('verifySnapshotContent', options.verifySnapshotContent),
    ...ifDefined('onPlannerWarnings', options.onPlannerWarnings),
    ...ifDefined('onProgress', options.onProgress),
  })) as DbUpdateResult;
}
