import { asNamespaceId } from '@internal/contract/types';
import { APP_SPACE_ID, expectAbsent } from '@internal/framework-components/control';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import {
  createMigrationPlan,
  plannerFailure,
  plannerSuccess,
  runnerFailure,
} from '../src/core/migrations/plan-helpers';
import type {
  SqlMigrationPlan,
  SqlMigrationPlanOperation,
  SqlPlannerConflict,
} from '../src/core/migrations/types';

type TestTargetDetails = { readonly schema: string };

describe('createMigrationPlan', () => {
  it('returns a deep-frozen plan and does not retain mutable references', () => {
    const sourceOperations = [
      {
        id: 'operation.table.user',
        label: 'Create table "user"',
        operationClass: 'additive',
        target: { id: 'postgres', details: { schema: 'public' } },
        precheck: [{ description: 'ensure table missing', sql: 'select 1' }],
        execute: [
          { description: 'create table', sql: 'create table "user" ("id" serial primary key)' },
        ],
        postcheck: [{ description: 'verify table exists', sql: 'select to_regclass(\'"user"\')' }],
      },
    ];

    const plan = createMigrationPlan<TestTargetDetails>({
      targetId: 'postgres',
      spaceId: APP_SPACE_ID,
      origin: { storageHash: 'originCore', profileHash: 'originProfile' },
      destination: { storageHash: 'core', profileHash: 'profile' },
      operations: sourceOperations as readonly SqlMigrationPlanOperation<TestTargetDetails>[],
      meta: { marker: 'none' },
      providedInvariants: [],
    });

    expect(plan).toMatchObject({
      targetId: 'postgres',
      origin: { storageHash: 'originCore', profileHash: 'originProfile' },
      destination: { storageHash: 'core', profileHash: 'profile' },
      operations: [
        {
          id: 'operation.table.user',
          operationClass: 'additive',
          target: { id: 'postgres', details: { schema: 'public' } },
        },
      ],
      meta: { marker: 'none' },
    });

    expect(Object.isFrozen(plan.operations)).toBe(true);
    const firstOperation = plan.operations[0]! as SqlMigrationPlanOperation<TestTargetDetails>;
    expect(Object.isFrozen(firstOperation)).toBe(true);
    expect(Object.isFrozen(firstOperation.precheck)).toBe(true);
  });

  it("keeps a check's expectation", () => {
    const plan = createMigrationPlan<TestTargetDetails>({
      targetId: 'postgres',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: { storageHash: 'core', profileHash: 'profile' },
      operations: [
        {
          id: 'operation.table.user',
          label: 'Create table "user"',
          operationClass: 'additive',
          target: { id: 'postgres', details: { schema: 'public' } },
          precheck: [
            {
              description: 'ensure table "user" does not exist',
              sql: 'select 1',
              expectation: expectAbsent('table "user"'),
            },
          ],
          execute: [],
          postcheck: [],
        },
      ],
      providedInvariants: [],
    });

    const operation = plan.operations[0] as SqlMigrationPlanOperation<TestTargetDetails>;
    expect(operation.precheck[0]?.expectation).toEqual({
      expects: 'absent',
      object: 'table "user"',
    });
  });

  it('freezes and clones target.details to prevent mutation', () => {
    const mutableDetails = { schema: 'public', objectType: 'table' as const, name: 'user' };
    const plan = createMigrationPlan({
      targetId: 'postgres',
      spaceId: APP_SPACE_ID,
      destination: { storageHash: 'abc' },
      operations: [
        {
          id: 'op1',
          label: 'Test',
          operationClass: 'additive',
          target: { id: 'postgres', details: mutableDetails },
          precheck: [],
          execute: [],
          postcheck: [],
        },
      ],
      providedInvariants: [],
    });

    // Mutate original
    mutableDetails.schema = 'mutated';

    const op0 = plan.operations[0]! as SqlMigrationPlanOperation<TestTargetDetails>;
    // Assert plan's details unchanged
    expect(op0.target.details).toMatchObject({
      schema: 'public',
      objectType: 'table',
      name: 'user',
    });

    // Assert frozen
    expect(Object.isFrozen(op0.target)).toBe(true);
    expect(Object.isFrozen(op0.target.details)).toBe(true);
  });

  it('preserves primitive details without cloning', () => {
    const plan = createMigrationPlan({
      targetId: 'postgres',
      spaceId: APP_SPACE_ID,
      destination: { storageHash: 'abc' },
      operations: [
        {
          id: 'op1',
          label: 'Test',
          operationClass: 'additive',
          target: { id: 'postgres', details: 'primitive-string' as unknown as TestTargetDetails },
          precheck: [],
          execute: [],
          postcheck: [],
        },
      ],
      providedInvariants: [],
    });

    const op0 = plan.operations[0]! as SqlMigrationPlanOperation<TestTargetDetails>;
    // Primitive should remain as-is (no cloning needed)
    expect(op0.target.details).toBe('primitive-string');
    expect(Object.isFrozen(op0.target)).toBe(true);
  });

  it('freezes and clones array details', () => {
    const mutableArray = ['item1', 'item2'];
    const plan = createMigrationPlan({
      targetId: 'postgres',
      spaceId: APP_SPACE_ID,
      destination: { storageHash: 'abc' },
      operations: [
        {
          id: 'op1',
          label: 'Test',
          operationClass: 'additive',
          target: { id: 'postgres', details: mutableArray as unknown as TestTargetDetails },
          precheck: [],
          execute: [],
          postcheck: [],
        },
      ],
      providedInvariants: [],
    });

    // Mutate original array
    mutableArray.push('item3');

    const op0 = plan.operations[0]! as SqlMigrationPlanOperation<TestTargetDetails>;
    // Assert plan's array unchanged
    expect(op0.target.details).toEqual(['item1', 'item2']);
    expect(Object.isFrozen(op0.target)).toBe(true);
    expect(Object.isFrozen(op0.target.details)).toBe(true);
  });
});

describe('planner helpers', () => {
  it('produce immutable envelopes that clone conflict metadata', () => {
    const plan: SqlMigrationPlan<TestTargetDetails> = createMigrationPlan({
      targetId: 'postgres',
      spaceId: APP_SPACE_ID,
      destination: { storageHash: 'abc', profileHash: 'def' },
      operations: [],
      providedInvariants: [],
    });
    const noSubjects = { dataLoss: [], accessChanges: [], temporaryValues: [] };
    const success = plannerSuccess(plan, [], noSubjects);
    expect(success).toEqual({ kind: 'success', plan, appliedStatements: [], ...noSubjects });
    expect(Object.isFrozen(success)).toBe(true);

    const warning = {
      kind: 'controlPolicySuppressedCall' as const,
      summary: 'control policy suppressed: createTable(users)',
      meta: { controlPolicy: 'external', factoryName: 'createTable' },
    };
    const successWithWarnings = plannerSuccess(plan, [], noSubjects, [warning]);
    expect(successWithWarnings.warnings).toEqual([warning]);
    expect(plannerSuccess(plan, [], noSubjects, [])).toEqual({
      kind: 'success',
      plan,
      appliedStatements: [],
      ...noSubjects,
    });

    const conflict = {
      kind: 'typeMismatch',
      summary: 'Column "user"."email" has mismatched type',
      location: { entityKind: 'table', entityName: 'user', column: 'email' },
      meta: { hint: 'only additive operations allowed' },
    } satisfies SqlPlannerConflict;
    const failure = plannerFailure([conflict]);
    conflict.location!.entityName = 'mutated';

    expect(failure).toMatchObject({
      kind: 'failure',
      conflicts: [
        {
          kind: 'typeMismatch',
          location: { entityKind: 'table', entityName: 'user', column: 'email' },
          meta: { hint: 'only additive operations allowed' },
        },
      ],
    });
    expect(Object.isFrozen(failure.conflicts)).toBe(true);
    expect(Object.isFrozen(failure.conflicts[0]!)).toBe(true);
    expect(failure.conflicts[0]?.location?.entityName).toBe('user');

    const leaveOut = [
      {
        kind: 'rename' as const,
        entity: 'namespace' as const,
        from: asNamespaceId('app'),
        to: asNamespaceId('crm'),
      },
    ];
    expect(
      plannerFailure([{ kind: 'statementRefused', summary: 'Cannot rename', leaveOut }])
        .conflicts[0]?.leaveOut,
    ).toEqual(leaveOut);
  });
});

describe('runnerFailure', () => {
  it('returns a structured error with the summary as its message and the facts in meta', () => {
    const result = runnerFailure(
      'MIGRATION.PRECHECK_FAILED',
      'Operation op failed during precheck',
      {
        meta: { failedCheck: { operationId: 'op', phase: 'precheck', description: 'check' } },
      },
    );

    expect(result.ok).toBe(false);
    expect(isStructuredError(result.failure)).toBe(true);
    expect({
      code: result.failure.code,
      message: result.failure.message,
      meta: result.failure.meta,
    }).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message: 'Operation op failed during precheck',
      meta: { failedCheck: { operationId: 'op', phase: 'precheck', description: 'check' } },
    });
  });
});
