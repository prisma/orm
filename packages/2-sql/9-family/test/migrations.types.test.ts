import { APP_SPACE_ID } from '@internal/framework-components/control';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  createMigrationPlan,
  plannerFailure,
  plannerSuccess,
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

    expectTypeOf(firstOperation.target.details).toEqualTypeOf<TestTargetDetails | undefined>();
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
    const success = plannerSuccess(plan, []);
    expect(success).toEqual({ kind: 'success', plan, appliedStatements: [] });
    expect(Object.isFrozen(success)).toBe(true);

    const warning = {
      kind: 'controlPolicySuppressedCall' as const,
      summary: 'control policy suppressed: createTable(users)',
      meta: { controlPolicy: 'external', factoryName: 'createTable' },
    };
    const successWithWarnings = plannerSuccess(plan, [], [warning]);
    expect(successWithWarnings.warnings).toEqual([warning]);
    expect(plannerSuccess(plan, [], [])).toEqual({ kind: 'success', plan, appliedStatements: [] });

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
  });
});
