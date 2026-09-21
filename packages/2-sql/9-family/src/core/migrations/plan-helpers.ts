import { blindCast } from '@internal/utils/casts';
import type { NotOk, Ok } from '@internal/utils/result';
import { notOk, ok } from '@internal/utils/result';
import type {
  AnyRecord,
  CreateSqlMigrationPlanOptions,
  SqlMigrationPlan,
  SqlMigrationPlanOperation,
  SqlMigrationPlanOperationStep,
  SqlMigrationPlanOperationTarget,
  SqlMigrationRunnerErrorCode,
  SqlMigrationRunnerFailure,
  SqlMigrationRunnerSuccessValue,
  SqlPlannerConflict,
  SqlPlannerFailureResult,
  SqlPlannerSuccessResult,
} from './types';

const readOnlyEmptyObject: Record<string, never> = Object.freeze({});

function cloneRecord<T extends AnyRecord>(value: T): T {
  if (value === readOnlyEmptyObject) {
    return value;
  }
  return blindCast<T, 'shallow clone preserves the input record shape while freezing it'>(
    Object.freeze({ ...value }),
  );
}

function freezeSteps(
  steps: readonly SqlMigrationPlanOperationStep[],
): readonly SqlMigrationPlanOperationStep[] {
  if (steps.length === 0) {
    return Object.freeze([]);
  }
  return Object.freeze(
    steps.map((step) =>
      Object.freeze({
        description: step.description,
        sql: step.sql,
        ...(step.params ? { params: Object.freeze([...step.params]) } : {}),
        ...(step.meta ? { meta: cloneRecord(step.meta) } : {}),
      }),
    ),
  );
}

function freezeDetailsValue<T>(value: T): T {
  // Primitives and null/undefined are already immutable, return as-is
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  // Arrays: shallow clone and freeze
  if (Array.isArray(value)) {
    return blindCast<T, 'shallow clone preserves the input array shape while freezing it'>(
      Object.freeze([...value]),
    );
  }
  // Objects: shallow clone and freeze (matching cloneRecord pattern)
  return blindCast<T, 'shallow clone preserves the input object shape while freezing it'>(
    Object.freeze({ ...value }),
  );
}

function freezeTargetDetails<TTargetDetails>(
  target: SqlMigrationPlanOperationTarget<TTargetDetails>,
): SqlMigrationPlanOperationTarget<TTargetDetails> {
  return Object.freeze({
    id: target.id,
    ...(target.details !== undefined ? { details: freezeDetailsValue(target.details) } : {}),
  });
}

function freezeOperation<TTargetDetails>(
  operation: SqlMigrationPlanOperation<TTargetDetails>,
): SqlMigrationPlanOperation<TTargetDetails> {
  return Object.freeze({
    id: operation.id,
    label: operation.label,
    ...(operation.summary ? { summary: operation.summary } : {}),
    operationClass: operation.operationClass,
    ...(operation.invariantId ? { invariantId: operation.invariantId } : {}),
    target: freezeTargetDetails(operation.target),
    precheck: freezeSteps(operation.precheck),
    execute: freezeSteps(operation.execute),
    postcheck: freezeSteps(operation.postcheck),
    ...(operation.meta ? { meta: cloneRecord(operation.meta) } : {}),
  });
}

function freezeOperations<TTargetDetails>(
  operations: readonly SqlMigrationPlanOperation<TTargetDetails>[],
): readonly SqlMigrationPlanOperation<TTargetDetails>[] {
  if (operations.length === 0) {
    return Object.freeze([]);
  }
  return Object.freeze(operations.map((operation) => freezeOperation(operation)));
}

export function createMigrationPlan<TTargetDetails>(
  options: CreateSqlMigrationPlanOptions<TTargetDetails>,
): SqlMigrationPlan<TTargetDetails> {
  return Object.freeze({
    targetId: options.targetId,
    spaceId: options.spaceId,
    ...(options.origin !== undefined
      ? { origin: options.origin ? Object.freeze({ ...options.origin }) : null }
      : {}),
    destination: Object.freeze({ ...options.destination }),
    operations: freezeOperations(options.operations),
    providedInvariants: Object.freeze([...options.providedInvariants]),
    ...(options.meta ? { meta: cloneRecord(options.meta) } : {}),
  });
}

export function plannerSuccess<TTargetDetails>(
  plan: SqlMigrationPlan<TTargetDetails>,
  warnings?: readonly SqlPlannerConflict[],
): SqlPlannerSuccessResult<TTargetDetails> {
  return Object.freeze({
    kind: 'success',
    plan,
    ...(warnings && warnings.length > 0
      ? {
          warnings: Object.freeze(
            warnings.map((conflict) =>
              Object.freeze({
                kind: conflict.kind,
                summary: conflict.summary,
                ...(conflict.why ? { why: conflict.why } : {}),
                ...(conflict.location ? { location: Object.freeze({ ...conflict.location }) } : {}),
                ...(conflict.meta ? { meta: cloneRecord(conflict.meta) } : {}),
              }),
            ),
          ),
        }
      : {}),
  });
}

export function plannerFailure(conflicts: readonly SqlPlannerConflict[]): SqlPlannerFailureResult {
  return Object.freeze({
    kind: 'failure' as const,
    conflicts: Object.freeze(
      conflicts.map((conflict) =>
        Object.freeze({
          kind: conflict.kind,
          summary: conflict.summary,
          ...(conflict.why ? { why: conflict.why } : {}),
          ...(conflict.location ? { location: Object.freeze({ ...conflict.location }) } : {}),
          ...(conflict.meta ? { meta: cloneRecord(conflict.meta) } : {}),
        }),
      ),
    ),
  });
}

/**
 * Creates a successful migration runner result.
 */
export function runnerSuccess(value: {
  operationsPlanned: number;
  operationsExecuted: number;
}): Ok<SqlMigrationRunnerSuccessValue> {
  return ok(
    Object.freeze({
      operationsPlanned: value.operationsPlanned,
      operationsExecuted: value.operationsExecuted,
    }),
  );
}

/**
 * Creates a failed migration runner result.
 */
export function runnerFailure(
  code: SqlMigrationRunnerErrorCode,
  summary: string,
  options?: { why?: string; meta?: AnyRecord },
): NotOk<SqlMigrationRunnerFailure> {
  const failure: SqlMigrationRunnerFailure = Object.freeze({
    code,
    summary,
    ...(options?.why ? { why: options.why } : {}),
    ...(options?.meta ? { meta: cloneRecord(options.meta) } : {}),
  });
  return notOk(failure);
}
