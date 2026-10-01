import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import {
  coalesceSubtreeIssues,
  columnTypeChanged,
  mapNodeIssueToCall,
  planIssues,
} from '../../src/core/migrations/issue-planner';
import type { StrategyContext } from '../../src/core/migrations/planner-strategies';
import {
  actualColumn,
  checkConstraint,
  columnDefault,
  expectedColumn,
  foreignKey,
  index,
  issue,
  primaryKey,
  table,
  unique,
} from './node-issue-helpers';

const emptyCtx: StrategyContext = {
  expected: new SqlSchemaIR({ tables: {} }),
  actual: new SqlSchemaIR({ tables: {} }),
  policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
  frameworkComponents: [],
};

describe('mapNodeIssueToCall — table', () => {
  it('emits CreateTableCall + per-index CreateIndexCall for a not-found table', () => {
    const t = table({
      name: 'user',
      columns: {
        id: expectedColumn({ name: 'id', nativeType: 'INTEGER', nullable: false }),
        email: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: false }),
      },
      primaryKey: primaryKey(['id']),
      indexes: [index(['email'], { name: 'user_email_idx' })],
    });
    const result = mapNodeIssueToCall(issue({ path: ['database', 'user'], expected: t }), emptyCtx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toMatchObject({ factoryName: 'createTable', tableName: 'user' });
    expect(result.value[1]).toMatchObject({
      factoryName: 'createIndex',
      tableName: 'user',
      indexName: 'user_email_idx',
    });
  });

  it('emits DropTableCall for a not-expected table', () => {
    const t = table({ name: 'orphan', columns: {} });
    const result = mapNodeIssueToCall(issue({ path: ['database', 'orphan'], actual: t }), emptyCtx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual([
      expect.objectContaining({ factoryName: 'dropTable', tableName: 'orphan' }),
    ]);
  });

  it('skips control tables (_prisma_marker) without emitting a drop or a conflict', () => {
    const t = table({ name: '_prisma_marker', columns: {} });
    const result = mapNodeIssueToCall(
      issue({ path: ['database', '_prisma_marker'], actual: t }),
      emptyCtx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toHaveLength(0);
  });
});

describe('mapNodeIssueToCall — column', () => {
  it('emits AddColumnCall for a not-found column', () => {
    const col = expectedColumn({ name: 'bio', nativeType: 'TEXT', nullable: true });
    const result = mapNodeIssueToCall(
      issue({ path: ['database', 'user', 'column:bio'], expected: col }),
      emptyCtx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual([
      expect.objectContaining({ factoryName: 'addColumn', tableName: 'user', columnName: 'bio' }),
    ]);
  });

  it('emits DropColumnCall for a not-expected column', () => {
    const col = actualColumn({ name: 'old', nativeType: 'TEXT', nullable: true });
    const result = mapNodeIssueToCall(
      issue({ path: ['database', 'user', 'column:old'], actual: col }),
      emptyCtx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual([
      expect.objectContaining({ factoryName: 'dropColumn', tableName: 'user', columnName: 'old' }),
    ]);
  });

  it('returns a typeMismatch conflict for a not-equal column with a type change (unabsorbed)', () => {
    const expected = expectedColumn({ name: 'age', nativeType: 'INTEGER', nullable: false });
    const actual = actualColumn({ name: 'age', nativeType: 'TEXT', nullable: false });
    const result = mapNodeIssueToCall(
      issue({ path: ['database', 'user', 'column:age'], expected, actual }),
      emptyCtx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failure.kind).toBe('typeMismatch');
  });

  it('returns a nullabilityConflict for a not-equal column with only a nullability change', () => {
    const expected = expectedColumn({ name: 'age', nativeType: 'INTEGER', nullable: false });
    const actual = actualColumn({ name: 'age', nativeType: 'INTEGER', nullable: true });
    const result = mapNodeIssueToCall(
      issue({ path: ['database', 'user', 'column:age'], expected, actual }),
      emptyCtx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failure.kind).toBe('nullabilityConflict');
  });
});

describe('mapNodeIssueToCall — index', () => {
  it('emits CreateIndexCall with the node-carried name for a not-found index', () => {
    const idx = index(['email'], { name: 'idx_explicit' });
    const result = mapNodeIssueToCall(
      issue({ path: ['database', 'user', 'index:email'], expected: idx }),
      emptyCtx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual([
      expect.objectContaining({ factoryName: 'createIndex', indexName: 'idx_explicit' }),
    ]);
  });

  it('uses the node-carried name verbatim, never a table-derived default', () => {
    const idx = index(['userId'], { name: 'custom_userId_idx' });
    const result = mapNodeIssueToCall(
      issue({ path: ['database', 'post', 'index:custom_userId_idx'], expected: idx }),
      emptyCtx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual([
      expect.objectContaining({ factoryName: 'createIndex', indexName: 'custom_userId_idx' }),
    ]);
  });

  it('emits DropIndexCall for a not-expected index', () => {
    const idx = index(['old_col'], { name: 'idx_old' });
    const result = mapNodeIssueToCall(
      issue({ path: ['database', 'user', 'index:old_col'], actual: idx }),
      emptyCtx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual([
      expect.objectContaining({ factoryName: 'dropIndex', indexName: 'idx_old' }),
    ]);
  });

  it('returns an indexIncompatible conflict for an index drift (not-equal)', () => {
    const expected = index(['email'], { name: 'idx_email' });
    const actual = index(['email'], { name: 'idx_email', unique: true });
    const result = mapNodeIssueToCall(
      issue({ path: ['database', 'user', 'index:email'], expected, actual }),
      emptyCtx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failure.kind).toBe('indexIncompatible');
  });
});

describe('mapNodeIssueToCall — absorbed node kinds surface as conflicts when unabsorbed', () => {
  it('primary key: indexIncompatible', () => {
    const result = mapNodeIssueToCall(
      issue({
        path: ['database', 'user', 'primary-key'],
        expected: primaryKey(['id']),
      }),
      emptyCtx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failure.kind).toBe('indexIncompatible');
  });

  it('unique constraint: indexIncompatible', () => {
    const result = mapNodeIssueToCall(
      issue({
        path: ['database', 'user', 'unique:email'],
        expected: unique(['email']),
      }),
      emptyCtx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failure.kind).toBe('indexIncompatible');
  });

  it('foreign key: foreignKeyConflict', () => {
    const fk = foreignKey({
      columns: ['userId'],
      referencedTable: 'user',
      referencedColumns: ['id'],
    });
    const result = mapNodeIssueToCall(
      issue({
        path: ['database', 'post', 'foreign-key:userId->.user(id)'],
        expected: fk,
      }),
      emptyCtx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failure.kind).toBe('foreignKeyConflict');
  });

  it('column default: missingButNonAdditive', () => {
    const result = mapNodeIssueToCall(
      issue({
        path: ['database', 'user', 'column:name', 'default'],
        expected: columnDefault({ resolved: { kind: 'literal', value: 'x' } }),
      }),
      emptyCtx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failure.kind).toBe('missingButNonAdditive');
  });
});

describe('mapNodeIssueToCall — check constraint', () => {
  it('always returns unsupportedOperation (the SQLite target has no CHECK DDL support)', () => {
    const result = mapNodeIssueToCall(
      issue({
        path: ['database', 'user', 'check:status_check'],
        expected: checkConstraint({
          name: 'status_check',
          expression: `"status" IN ('a', 'b')`,
        }),
      }),
      emptyCtx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failure.kind).toBe('unsupportedOperation');
  });
});

describe('columnTypeChanged', () => {
  it('compares resolvedNativeType when both sides carry it', () => {
    const expected = expectedColumn({ name: 'a', nativeType: 'INTEGER', nullable: false });
    const actual = actualColumn({
      name: 'a',
      nativeType: 'INTEGER',
      nullable: false,
      resolvedNativeType: 'TEXT',
    });
    expect(columnTypeChanged(expected, actual)).toBe(true);
  });

  it('is false when only nullability differs', () => {
    const expected = expectedColumn({ name: 'a', nativeType: 'INTEGER', nullable: false });
    const actual = actualColumn({ name: 'a', nativeType: 'INTEGER', nullable: true });
    expect(columnTypeChanged(expected, actual)).toBe(false);
  });
});

describe('planIssues — dependency-graph ordering', () => {
  function factoryNames(issues: readonly ReturnType<typeof issue>[]): readonly string[] {
    const result = planIssues({ issues, strategies: [] });
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.failure)}`);
    return result.value.calls.map((c) => c.factoryName);
  }

  const created = issue({
    path: ['database', 'created'],
    expected: table({
      name: 'created',
      columns: { id: expectedColumn({ name: 'id', nativeType: 'INTEGER', nullable: false }) },
    }),
  });
  const droppedA = issue({
    path: ['database', 'a_orphan'],
    actual: table({ name: 'a_orphan', columns: {} }),
  });
  const droppedZ = issue({
    path: ['database', 'z_orphan'],
    actual: table({ name: 'z_orphan', columns: {} }),
  });

  it('keeps creates before drops (the retained call-bucket order)', () => {
    const names = factoryNames([droppedZ, created, droppedA]);
    expect(names.indexOf('createTable')).toBeLessThan(names.indexOf('dropTable'));
  });

  it('is deterministic regardless of input order (graph path tiebreak)', () => {
    const baseline = factoryNames([droppedZ, created, droppedA]);
    expect(factoryNames([created, droppedA, droppedZ])).toEqual(baseline);
    expect(factoryNames([droppedA, droppedZ, created])).toEqual(baseline);
    // The two independent table drops come out in stable path order every run.
    const dropOrder = factoryNames([droppedZ, droppedA]);
    expect(dropOrder).toEqual(['dropTable', 'dropTable']);
    expect(factoryNames([droppedA, droppedZ])).toEqual(dropOrder);
  });
});

describe('coalesceSubtreeIssues', () => {
  it('drops nested column/default issues under a not-found table', () => {
    const t = table({
      name: 'user',
      columns: { id: expectedColumn({ name: 'id', nativeType: 'INTEGER', nullable: false }) },
    });
    const tableIssue = issue({ path: ['database', 'user'], expected: t });
    const nestedColumn = issue({
      path: ['database', 'user', 'column:id'],
      expected: t.columns['id'],
    });
    const nestedDefault = issue({
      path: ['database', 'user', 'column:id', 'default'],
      expected: { resolved: { kind: 'literal', value: 1 } },
    });
    const unrelated = issue({
      path: ['database', 'other'],
      expected: table({ name: 'other', columns: {} }),
    });

    const result = coalesceSubtreeIssues([tableIssue, nestedColumn, nestedDefault, unrelated]);
    expect(result).toEqual([tableIssue, unrelated]);
  });

  it('drops a nested default issue under a not-found (new) column on an otherwise-matched table', () => {
    const col = expectedColumn({ name: 'bio', nativeType: 'TEXT', nullable: true });
    const columnIssue = issue({
      path: ['database', 'user', 'column:bio'],
      expected: col,
    });
    const nestedDefault = issue({
      path: ['database', 'user', 'column:bio', 'default'],
      expected: { resolved: { kind: 'literal', value: '' } },
    });
    const result = coalesceSubtreeIssues([columnIssue, nestedDefault]);
    expect(result).toEqual([columnIssue]);
  });

  it('keeps sibling per-attribute issues on a matched table untouched', () => {
    const colDrift = issue({
      path: ['database', 'user', 'column:age'],
      expected: expectedColumn({ name: 'age', nativeType: 'INTEGER', nullable: false }),
      actual: actualColumn({ name: 'age', nativeType: 'TEXT', nullable: false }),
    });
    const defaultMissing = issue({
      path: ['database', 'user', 'column:age', 'default'],
      expected: { resolved: { kind: 'literal', value: 0 } },
    });
    // No table-level or column-level not-found/not-expected issue present —
    // both survive untouched.
    expect(coalesceSubtreeIssues([colDrift, defaultMissing])).toEqual([colDrift, defaultMissing]);
  });

  it('is a no-op when there are no not-found/not-expected issues at all', () => {
    const onlyDrift = issue({
      path: ['database', 'user', 'column:age'],
      expected: expectedColumn({ name: 'age', nativeType: 'INTEGER', nullable: false }),
      actual: actualColumn({ name: 'age', nativeType: 'TEXT', nullable: false }),
    });
    expect(coalesceSubtreeIssues([onlyDrift])).toEqual([onlyDrift]);
  });
});

describe('planIssues — policy', () => {
  it('names the operation class the policy refused on each conflict', () => {
    const dropped = issue({
      path: ['database', 'orphan'],
      actual: table({ name: 'orphan', columns: {} }),
    });
    const result = planIssues({
      issues: [dropped],
      strategies: [],
      policy: { allowedOperationClasses: ['additive'] },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected conflicts');
    expect(result.failure).toEqual([
      expect.objectContaining({
        summary: expect.stringContaining('requires class "destructive"'),
        refusedOperationClass: 'destructive',
      }),
    ]);
  });
});
