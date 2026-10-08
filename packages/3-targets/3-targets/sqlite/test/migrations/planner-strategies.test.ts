import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import type { RecreateTableCall } from '../../src/core/migrations/op-factory-call';
import {
  nullabilityTighteningBackfillStrategy,
  recreateTableStrategy,
  type StrategyContext,
} from '../../src/core/migrations/planner-strategies';
import { sqliteTestComponents, sqliteTestTypes } from '../sqlite-test-types';
import {
  actualColumn,
  columnDefault,
  expectedColumn,
  foreignKey,
  issue,
  primaryKey,
  table,
  unique,
} from './node-issue-helpers';

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
    const pkDrift = issue({
      path: ['database', 'user', 'primary-key'],
      expected: primaryKey(['id']),
      actual: primaryKey(['id', 'email']),
    });
    const typeDrift = issue({
      path: ['database', 'user', 'column:email'],
      expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
      actual: actualColumn({ name: 'email', nativeType: 'INTEGER', nullable: true }),
    });
    const ctx = makeContext({
      expected: new SqlSchemaIR({ tables: { user: expectedUserTable } }),
      actual: new SqlSchemaIR({ tables: { user: actualUserTable } }),
    });
    const result = recreateTableStrategy([pkDrift, typeDrift], ctx);
    expect(result.kind).toBe('match');
    if (result.kind !== 'match') return;
    expect((result.calls[0] as RecreateTableCall).operationClass).toBe('destructive');
    expect(result.issues).toHaveLength(0);
  });

  it.each([
    [
      'a changed primary key',
      issue({
        path: ['database', 'user', 'primary-key'],
        expected: primaryKey(['id']),
        actual: primaryKey(['id', 'email']),
      }),
    ],
    [
      'a dropped unique constraint',
      issue({ path: ['database', 'user', 'unique:email'], actual: unique(['email']) }),
    ],
    [
      'a dropped foreign key',
      issue({
        path: ['database', 'user', 'foreign-key:org_id'],
        actual: foreignKey({
          columns: ['email'],
          referencedTable: 'org',
          referencedColumns: ['id'],
        }),
      }),
    ],
    [
      'a removed column default',
      issue({
        path: ['database', 'user', 'column:email', 'default'],
        actual: columnDefault({ raw: "'x'" }),
      }),
    ],
  ])('classifies a recreate for %s alone as widening', (_label, constraintIssue) => {
    const ctx = makeContext({
      expected: new SqlSchemaIR({ tables: { user: expectedUserTable } }),
      actual: new SqlSchemaIR({ tables: { user: actualUserTable } }),
    });
    const result = recreateTableStrategy([constraintIssue], ctx);
    expect(result.kind).toBe('match');
    if (result.kind !== 'match') return;
    expect((result.calls[0] as RecreateTableCall).operationClass).toBe('widening');
  });

  it('classifies a recreate for a nullability change alone as widening, in either direction', () => {
    const ctx = makeContext({
      expected: new SqlSchemaIR({ tables: { user: expectedUserTable } }),
      actual: new SqlSchemaIR({ tables: { user: actualUserTable } }),
    });
    const nullabilityChange = (expectedNullable: boolean) =>
      issue({
        path: ['database', 'user', 'column:email'],
        expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: expectedNullable }),
        actual: actualColumn({ name: 'email', nativeType: 'TEXT', nullable: !expectedNullable }),
      });

    const classes = [true, false].map((expectedNullable) => {
      const result = recreateTableStrategy([nullabilityChange(expectedNullable)], ctx);
      return result.kind === 'match'
        ? (result.calls[0] as RecreateTableCall).operationClass
        : result.kind;
    });

    expect(classes).toEqual(['widening', 'widening']);
  });

  it('classifies a recreate that leaves a live column out as destructive', () => {
    const actualWithNickname = table({
      name: 'user',
      columns: {
        id: actualColumn({ name: 'id', nativeType: 'INTEGER', nullable: false }),
        email: actualColumn({ name: 'email', nativeType: 'TEXT', nullable: false }),
        nickname: actualColumn({ name: 'nickname', nativeType: 'TEXT', nullable: true }),
      },
      primaryKey: primaryKey(['id']),
    });
    const relaxing = issue({
      path: ['database', 'user', 'column:email'],
      expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
      actual: actualColumn({ name: 'email', nativeType: 'TEXT', nullable: false }),
    });
    const result = recreateTableStrategy(
      [relaxing],
      makeContext({
        expected: new SqlSchemaIR({ tables: { user: expectedUserTable } }),
        actual: new SqlSchemaIR({ tables: { user: actualWithNickname } }),
      }),
    );

    expect(result.kind === 'match' && (result.calls[0] as RecreateTableCall).operationClass).toBe(
      'destructive',
    );
  });

  it('records the columns whose type changes as the lossy columns of the recreate', () => {
    const ctx = makeContext({
      expected: new SqlSchemaIR({ tables: { user: expectedUserTable } }),
      actual: new SqlSchemaIR({ tables: { user: actualUserTable } }),
    });
    const typeChange = issue({
      path: ['database', 'user', 'column:email'],
      expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
      actual: actualColumn({ name: 'email', nativeType: 'INTEGER', nullable: true }),
    });
    const pkDrift = issue({
      path: ['database', 'user', 'primary-key'],
      expected: primaryKey(['id']),
      actual: primaryKey(['id', 'email']),
    });

    const lossy = recreateTableStrategy([typeChange, pkDrift], ctx);
    const lossless = recreateTableStrategy([pkDrift], ctx);

    expect(
      [lossy, lossless].map((result) =>
        result.kind === 'match' ? (result.calls[0] as RecreateTableCall).lossyColumns : result.kind,
      ),
    ).toEqual([['email'], []]);
  });

  it('classifies a recreate for a nullability tightening and a type change as destructive', () => {
    const ctx = makeContext({
      expected: new SqlSchemaIR({ tables: { user: expectedUserTable } }),
      actual: new SqlSchemaIR({ tables: { user: actualUserTable } }),
    });
    const tighteningAndTypeChange = issue({
      path: ['database', 'user', 'column:email'],
      expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: false }),
      actual: actualColumn({ name: 'email', nativeType: 'INTEGER', nullable: true }),
    });

    const result = recreateTableStrategy([tighteningAndTypeChange], ctx);

    expect(result.kind).toBe('match');
    if (result.kind !== 'match') return;
    expect((result.calls[0] as RecreateTableCall).operationClass).toBe('destructive');
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
