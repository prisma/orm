import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import type { RecreateTableCall } from '../../src/core/migrations/op-factory-call';
import {
  nullabilityTighteningBackfillStrategy,
  recreateTableStrategy,
  type StrategyContext,
} from '../../src/core/migrations/planner-strategies';
import { sqliteTestComponents, sqliteTestTypes } from '../sqlite-test-types';
import { actualColumn, expectedColumn, issue, primaryKey, table } from './node-issue-helpers';

function makeContext(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    expected: new SqlSchemaIR({ tables: {} }),
    actual: new SqlSchemaIR({ tables: {} }),
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    frameworkComponents: sqliteTestComponents,
    types: sqliteTestTypes,
    ...overrides,
  };
}

const expectedUserTable = table({
  name: 'user',
  columns: {
    id: expectedColumn({ name: 'id', nativeType: 'INTEGER', nullable: false }),
    email: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
  },
  primaryKey: primaryKey(['id']),
});

const actualUserTable = table({
  name: 'user',
  columns: {
    id: actualColumn({ name: 'id', nativeType: 'INTEGER', nullable: false }),
    email: actualColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
  },
  primaryKey: primaryKey(['id']),
});

describe('recreateTableStrategy', () => {
  it('returns no_match when there are no recreate-eligible issues', () => {
    const missingColumn = issue({
      path: ['database', 'user', 'column:x'],
      expected: expectedColumn({ name: 'x', nativeType: 'TEXT', nullable: true }),
    });
    expect(recreateTableStrategy([missingColumn], makeContext()).kind).toBe('no_match');
  });

  it('classifies a pure default drift as widening', () => {
    const defaultDrift = issue({
      path: ['database', 'user', 'column:email', 'default'],
      expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
      actual: actualColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
    });
    const ctx = makeContext({
      expected: new SqlSchemaIR({ tables: { user: expectedUserTable } }),
      actual: new SqlSchemaIR({ tables: { user: actualUserTable } }),
    });
    const result = recreateTableStrategy([defaultDrift], ctx);
    expect(result.kind).toBe('match');
    if (result.kind !== 'match') return;
    expect(result.calls).toHaveLength(1);
    const call = result.calls[0] as RecreateTableCall;
    expect(call.factoryName).toBe('recreateTable');
    expect(call.operationClass).toBe('widening');
    expect(call.tableName).toBe('user');
    expect(result.issues).toHaveLength(0);
  });

  it('classifies a column type change as destructive', () => {
    const typeDrift = issue({
      path: ['database', 'user', 'column:email'],
      expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
      actual: actualColumn({ name: 'email', nativeType: 'INTEGER', nullable: true }),
    });
    const ctx = makeContext({
      expected: new SqlSchemaIR({ tables: { user: expectedUserTable } }),
      actual: new SqlSchemaIR({ tables: { user: actualUserTable } }),
    });
    const result = recreateTableStrategy([typeDrift], ctx);
    expect(result.kind).toBe('match');
    if (result.kind !== 'match') return;
    expect((result.calls[0] as RecreateTableCall).operationClass).toBe('destructive');
  });

  it('destructive wins over widening when both occur on the same table', () => {
    const defaultDrift = issue({
      path: ['database', 'user', 'column:email', 'default'],
      expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
      actual: actualColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
    });
    const pkDrift = issue({
      path: ['database', 'user', 'primary-key'],
      expected: primaryKey(['id']),
      actual: primaryKey(['id', 'email']),
    });
    const ctx = makeContext({
      expected: new SqlSchemaIR({ tables: { user: expectedUserTable } }),
      actual: new SqlSchemaIR({ tables: { user: actualUserTable } }),
    });
    const result = recreateTableStrategy([defaultDrift, pkDrift], ctx);
    expect(result.kind).toBe('match');
    if (result.kind !== 'match') return;
    expect((result.calls[0] as RecreateTableCall).operationClass).toBe('destructive');
    expect(result.issues).toHaveLength(0);
  });

  it('relaxing nullability (NOT NULL → nullable) is widening, tightening is destructive', () => {
    const ctx = makeContext({
      expected: new SqlSchemaIR({ tables: { user: expectedUserTable } }),
      actual: new SqlSchemaIR({ tables: { user: actualUserTable } }),
    });

    const relaxing = issue({
      path: ['database', 'user', 'column:email'],
      expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
      actual: actualColumn({ name: 'email', nativeType: 'TEXT', nullable: false }),
    });
    const widening = recreateTableStrategy([relaxing], ctx);
    expect(widening.kind).toBe('match');
    if (widening.kind !== 'match') return;
    expect((widening.calls[0] as RecreateTableCall).operationClass).toBe('widening');

    const tightening = issue({
      path: ['database', 'user', 'column:email'],
      expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: false }),
      actual: actualColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
    });
    const destructive = recreateTableStrategy([tightening], ctx);
    expect(destructive.kind).toBe('match');
    if (destructive.kind !== 'match') return;
    expect((destructive.calls[0] as RecreateTableCall).operationClass).toBe('destructive');
  });

  it('groups issues by table and emits one RecreateTableCall per affected table', () => {
    const aExpected = table({
      name: 'a',
      columns: { id: expectedColumn({ name: 'id', nativeType: 'INTEGER', nullable: false }) },
    });
    const aActual = table({
      name: 'a',
      columns: { id: actualColumn({ name: 'id', nativeType: 'TEXT', nullable: false }) },
    });
    const bExpected = table({
      name: 'b',
      columns: { id: expectedColumn({ name: 'id', nativeType: 'INTEGER', nullable: false }) },
    });
    const bActual = table({
      name: 'b',
      columns: { id: actualColumn({ name: 'id', nativeType: 'TEXT', nullable: false }) },
    });
    const ctx = makeContext({
      expected: new SqlSchemaIR({ tables: { a: aExpected, b: bExpected } }),
      actual: new SqlSchemaIR({ tables: { a: aActual, b: bActual } }),
    });
    const issues = [
      issue({
        path: ['database', 'a', 'column:id'],
        expected: aExpected.columns['id'],
        actual: aActual.columns['id'],
      }),
      issue({
        path: ['database', 'b', 'column:id'],
        expected: bExpected.columns['id'],
        actual: bActual.columns['id'],
      }),
    ];
    const result = recreateTableStrategy(issues, ctx);
    expect(result.kind).toBe('match');
    if (result.kind !== 'match') return;
    expect(result.calls).toHaveLength(2);
    expect(new Set(result.calls.map((c) => (c as RecreateTableCall).tableName))).toEqual(
      new Set(['a', 'b']),
    );
  });

  it('consumes but emits no call for a table missing from expected/actual (defensive)', () => {
    const ghostIssue = issue({
      path: ['database', 'ghost', 'column:x'],
      expected: expectedColumn({ name: 'x', nativeType: 'TEXT', nullable: true }),
      actual: actualColumn({ name: 'x', nativeType: 'INTEGER', nullable: true }),
    });
    const result = recreateTableStrategy([ghostIssue], makeContext());
    expect(result.kind).toBe('match');
    if (result.kind !== 'match') return;
    expect(result.calls).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
  });
});

describe('nullabilityTighteningBackfillStrategy', () => {
  it("returns no_match when policy does not include 'data'", () => {
    const tightening = issue({
      path: ['database', 'user', 'column:email'],
      expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: false }),
      actual: actualColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
    });
    const result = nullabilityTighteningBackfillStrategy(
      [tightening],
      makeContext({ policy: { allowedOperationClasses: ['additive', 'destructive'] } }),
    );
    expect(result.kind).toBe('no_match');
  });

  it("returns no_match for relaxing nullability under 'data' policy", () => {
    const relaxing = issue({
      path: ['database', 'user', 'column:email'],
      expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
      actual: actualColumn({ name: 'email', nativeType: 'TEXT', nullable: false }),
    });
    const result = nullabilityTighteningBackfillStrategy(
      [relaxing],
      makeContext({ policy: { allowedOperationClasses: ['additive', 'data', 'widening'] } }),
    );
    expect(result.kind).toBe('no_match');
  });

  it("emits a DataTransformCall per tightened column under 'data' policy without consuming the issue", () => {
    const tightening = issue({
      path: ['database', 'user', 'column:email'],
      expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: false }),
      actual: actualColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
    });
    const result = nullabilityTighteningBackfillStrategy(
      [tightening],
      makeContext({ policy: { allowedOperationClasses: ['additive', 'destructive', 'data'] } }),
    );
    expect(result.kind).toBe('match');
    if (result.kind !== 'match') return;
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]?.factoryName).toBe('dataTransform');
    expect(result.calls[0]?.operationClass).toBe('data');
    expect(result.recipe).toBe(true);
    // Issue NOT consumed — recreateTableStrategy still needs it.
    expect(result.issues).toEqual([tightening]);
  });

  it('does not fire for a pure type change carrying no nullability difference', () => {
    const typeDrift = issue({
      path: ['database', 'user', 'column:email'],
      expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: false }),
      actual: actualColumn({ name: 'email', nativeType: 'INTEGER', nullable: false }),
    });
    const result = nullabilityTighteningBackfillStrategy(
      [typeDrift],
      makeContext({ policy: { allowedOperationClasses: ['additive', 'destructive', 'data'] } }),
    );
    expect(result.kind).toBe('no_match');
  });
});
