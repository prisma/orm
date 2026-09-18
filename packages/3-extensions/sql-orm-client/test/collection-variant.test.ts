import {
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  type InsertAst,
  LiteralExpr,
  type SelectAst,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it, vi } from 'vitest';
import { Collection } from '../src/collection';
import { withReturningCapability } from './collection-fixtures';
import {
  buildMixedPolyContract,
  buildStiPolyContract,
  createMockRuntime,
  getTestContext,
  isSelectAst,
} from './helpers';

function collectColumnRefs(expr: AnyExpression | undefined): ColumnRef[] {
  if (!expr) return [];
  if (expr instanceof ColumnRef) return [expr];
  const refs: ColumnRef[] = [];
  const visit = (value: unknown): void => {
    if (value instanceof ColumnRef) {
      refs.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value && typeof value === 'object' && 'kind' in value) {
      refs.push(...collectColumnRefs(value as AnyExpression));
    }
  };
  for (const value of Object.values(expr as unknown as Record<string, unknown>)) {
    visit(value);
  }
  return refs;
}

function expectSelectWithFeatureJoin(ast: unknown): asserts ast is SelectAst {
  expect(isSelectAst(ast)).toBe(true);
  if (!isSelectAst(ast)) return;
  expect(
    ast.joins?.some(
      (join) => join.source.kind === 'table-source' && join.source.name === 'features',
    ),
  ).toBe(true);
}

function expectExistsWithFeatureJoin(expr: AnyExpression | undefined): ExistsExpr {
  expect(expr).toBeInstanceOf(ExistsExpr);
  if (!(expr instanceof ExistsExpr)) {
    throw new Error('Expected an EXISTS expression');
  }
  expect(
    expr.subquery.joins?.some(
      (join) => join.source.kind === 'table-source' && join.source.name === 'features',
    ),
  ).toBe(true);
  return expr;
}

// The mixed poly contract is patched in at runtime, so Project/tasks are
// absent from the static Models type. This minimal surface lets the runtime
// test drive include('tasks', t => t.variant('Bug')) and read the resulting
// nested state without a static contract for the patched models.
interface PolyVariantRefinement {
  variant(name: string): PolyVariantRefinement;
}
interface PolyParent {
  include(
    relation: 'tasks',
    refine?: (collection: PolyVariantRefinement) => PolyVariantRefinement,
  ): { state: { includes: { nested: { variantName?: string } }[] } };
}

interface FeaturePredicateField {
  gt(value: number): unknown;
}

interface FeaturePredicateRelation {
  some(): unknown;
}

interface FeaturePredicate {
  priority: FeaturePredicateField;
  assignee: FeaturePredicateRelation;
}

interface FeatureCountCollection {
  where(predicate: (task: FeaturePredicate) => unknown): FeatureCountCollection;
  include(relation: 'assignee'): FeatureCountCollection;
  updateAndCount(data: { title: string }): Promise<number>;
  deleteAll(): { toArray(): Promise<Record<string, unknown>[]> };
  deleteAndCount(): Promise<number>;
}

interface MixedPolyCountCollection {
  variant(name: 'Feature'): FeatureCountCollection;
}

function createPolyCollection() {
  const contract = buildStiPolyContract();
  const baseContext = getTestContext();
  const context = { ...baseContext, contract };
  const runtime = createMockRuntime();
  const collection = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
  return { collection, runtime, contract };
}

describe('Collection.variant()', () => {
  it('adds a discriminator filter to state', () => {
    const { collection } = createPolyCollection();
    const narrowed = collection.variant('Admin' as never);
    expect(narrowed.state.filters).toHaveLength(1);
    const filter = narrowed.state.filters[0];
    expect(filter).toBeInstanceOf(BinaryExpr);
    const binExpr = filter as BinaryExpr;
    expect(binExpr.left).toBeInstanceOf(ColumnRef);
    expect((binExpr.left as ColumnRef).column).toBe('kind');
    expect(binExpr.right).toBeInstanceOf(LiteralExpr);
    expect((binExpr.right as LiteralExpr).value).toBe('admin');
  });

  it('sets variantName on state', () => {
    const { collection } = createPolyCollection();
    const narrowed = collection.variant('Regular' as never);
    expect(narrowed.state.variantName).toBe('Regular');
  });

  it('replaces previous variant filter when chaining', () => {
    const { collection } = createPolyCollection();
    const first = collection.variant('Admin' as never);
    const second = first.variant('Regular' as never);

    expect(second.state.filters).toHaveLength(1);
    const filter = second.state.filters[0] as BinaryExpr;
    expect((filter.right as LiteralExpr).value).toBe('regular');
    expect(second.state.variantName).toBe('Regular');
  });

  it('returns unchanged collection when model has no discriminator', () => {
    const baseContext = getTestContext();
    const runtime = createMockRuntime();
    const collection = new Collection({ runtime, context: baseContext }, 'User', {
      namespaceId: 'public',
    });
    const result = collection.variant('Admin' as never);
    expect(result.state.filters).toHaveLength(0);
  });

  it('returns unchanged collection for unknown variant name', () => {
    const { collection } = createPolyCollection();
    const result = collection.variant('NonExistent' as never);
    expect(result.state.filters).toHaveLength(0);
  });

  it('preserves non-variant filters when chaining variants', () => {
    const { collection } = createPolyCollection();
    const withWhere = collection.where({ name: 'Alice' } as never);
    const narrowed = withWhere.variant('Admin' as never);

    expect(narrowed.state.filters).toHaveLength(2);
    const variantFilter = narrowed.state.filters[1] as BinaryExpr;
    expect((variantFilter.left as ColumnRef).column).toBe('kind');
  });

  it('preserves non-variant filters when re-narrowing', () => {
    const { collection } = createPolyCollection();
    const withWhere = collection.where({ name: 'Alice' } as never);
    const first = withWhere.variant('Admin' as never);
    const second = first.variant('Regular' as never);

    expect(second.state.filters).toHaveLength(2);
    const variantFilter = second.state.filters[1] as BinaryExpr;
    expect((variantFilter.right as LiteralExpr).value).toBe('regular');
  });
});

describe('STI polymorphic query pipeline', () => {
  it('base query maps mixed-variant rows into variant-specific shapes', async () => {
    const { collection, runtime } = createPolyCollection();
    runtime.setNextResults([
      [
        { id: 1, name: 'Alice', email: 'a@x', kind: 'admin', role: 'superadmin', plan: null },
        { id: 2, name: 'Bob', email: 'b@x', kind: 'regular', role: null, plan: 'free' },
      ],
    ]);

    const rows = await collection.all().toArray();

    expect(rows).toHaveLength(2);
    const admin = rows[0]!;
    expect(admin).toEqual({
      id: 1,
      name: 'Alice',
      email: 'a@x',
      kind: 'admin',
      role: 'superadmin',
    });
    expect(admin).not.toHaveProperty('plan');

    const regular = rows[1]!;
    expect(regular).toEqual({
      id: 2,
      name: 'Bob',
      email: 'b@x',
      kind: 'regular',
      plan: 'free',
    });
    expect(regular).not.toHaveProperty('role');
  });

  it('variant query maps all rows with the specified variant shape', async () => {
    const { collection, runtime } = createPolyCollection();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'a@x', kind: 'admin', role: 'superadmin', plan: null }],
    ]);

    const rows = await (collection.variant('Admin' as never) as typeof collection).all().toArray();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: 1,
      name: 'Alice',
      email: 'a@x',
      kind: 'admin',
      role: 'superadmin',
    });
    expect(rows[0]).not.toHaveProperty('plan');
  });
});

function createMixedPolyCollection() {
  const contract = buildMixedPolyContract();
  const baseContext = getTestContext();
  const context = { ...baseContext, contract };
  const runtime = createMockRuntime();
  const collection = new Collection({ runtime, context }, 'Task', { namespaceId: 'public' });
  return { collection, runtime };
}

describe('Mixed STI+MTI polymorphic query pipeline', () => {
  it('base query maps Bug (STI) and Feature (MTI) rows to variant-specific shapes', async () => {
    const { collection, runtime } = createMixedPolyCollection();
    runtime.setNextResults([
      [
        { id: 1, title: 'Crash', type: 'bug', severity: 'critical', features__priority: null },
        { id: 2, title: 'Dark mode', type: 'feature', severity: null, features__priority: 1 },
      ],
    ]);

    const rows = await collection.all().toArray();

    expect(rows).toHaveLength(2);

    const bug = rows[0]!;
    expect(bug).toEqual({ id: 1, title: 'Crash', type: 'bug', severity: 'critical' });
    expect(bug).not.toHaveProperty('priority');

    const feature = rows[1]!;
    expect(feature).toEqual({ id: 2, title: 'Dark mode', type: 'feature', priority: 1 });
    expect(feature).not.toHaveProperty('severity');
  });

  it('variant(Bug) query maps Bug STI rows only', async () => {
    const { collection, runtime } = createMixedPolyCollection();
    runtime.setNextResults([[{ id: 1, title: 'Crash', type: 'bug', severity: 'critical' }]]);

    const rows = await (collection.variant('Bug' as never) as typeof collection).all().toArray();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ id: 1, title: 'Crash', type: 'bug', severity: 'critical' });
  });

  it('variant(Feature) query maps Feature MTI rows only', async () => {
    const { collection, runtime } = createMixedPolyCollection();
    runtime.setNextResults([
      [{ id: 2, title: 'Dark mode', type: 'feature', features__priority: 1 }],
    ]);

    const rows = await (collection.variant('Feature' as never) as typeof collection)
      .all()
      .toArray();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ id: 2, title: 'Dark mode', type: 'feature', priority: 1 });
  });

  it('first() after variant(Feature) resolves the MTI variant field against the variant table', async () => {
    const { collection, runtime } = createMixedPolyCollection();
    runtime.setNextResults([
      [{ id: 2, title: 'Dark mode', type: 'feature', features__priority: 7 }],
    ]);

    // first()'s predicate is variant-aware like where()'s: under variant(Feature)
    // the runtime accessor exposes the MTI variant field `priority`, resolved
    // against the `features` variant table. The patched Task model is absent
    // from the static type, so the predicate field is reached via `never`.
    const narrowed = collection.variant('Feature' as never) as typeof collection;
    const row = await narrowed.first(((task: Record<string, { gte(value: number): unknown }>) =>
      task['priority']!.gte(3)) as never);

    expect(row).toEqual({ id: 2, title: 'Dark mode', type: 'feature', priority: 7 });

    const ast = runtime.executions[0]!.plan.ast;
    expect(isSelectAst(ast)).toBe(true);
    const featurePriorityRefs = isSelectAst(ast)
      ? collectColumnRefs(ast.where).filter(
          (ref) => ref.table === 'features' && ref.column === 'priority',
        )
      : [];
    expect(featurePriorityRefs).toHaveLength(1);
  });

  it('orderBy after variant(Feature) resolves the MTI variant field against the variant table', async () => {
    const { collection, runtime } = createMixedPolyCollection();
    runtime.setNextResults([
      [{ id: 2, title: 'Dark mode', type: 'feature', features__priority: 7 }],
    ]);

    // orderBy's selector is variant-aware like where()'s/first()'s: under
    // variant(Feature) the runtime accessor exposes the MTI variant field
    // `priority`, resolved against the `features` variant table. The patched
    // Task model is absent from the static type, so the field is reached via
    // `never`.
    const narrowed = collection.variant('Feature' as never) as typeof collection;
    await narrowed
      .orderBy(((task: Record<string, { desc(): unknown }>) => task['priority']!.desc()) as never)
      .all();

    const ast = runtime.executions[0]!.plan.ast;
    expect(isSelectAst(ast)).toBe(true);
    const orderRefs = isSelectAst(ast)
      ? (ast.orderBy ?? []).flatMap((item) => collectColumnRefs(item.expr))
      : [];
    expect(orderRefs).toEqual([ColumnRef.of('features', 'priority')]);
    expect(isSelectAst(ast) ? ast.orderBy?.[0]?.dir : undefined).toBe('desc');
  });

  it('orderBy after variant(Feature) keeps base fields qualified against the base table', async () => {
    const { collection, runtime } = createMixedPolyCollection();
    runtime.setNextResults([
      [{ id: 2, title: 'Dark mode', type: 'feature', features__priority: 7 }],
    ]);

    const narrowed = collection.variant('Feature' as never) as typeof collection;
    await narrowed
      .orderBy(((task: Record<string, { asc(): unknown }>) => task['title']!.asc()) as never)
      .all();

    const ast = runtime.executions[0]!.plan.ast;
    const orderRefs = isSelectAst(ast)
      ? (ast.orderBy ?? []).flatMap((item) => collectColumnRefs(item.expr))
      : [];
    expect(orderRefs).toEqual([ColumnRef.of('tasks', 'title')]);
  });

  it('orderBy without a variant resolves fields against the base table', async () => {
    const { collection, runtime } = createMixedPolyCollection();
    runtime.setNextResults([
      [{ id: 2, title: 'Dark mode', type: 'feature', features__priority: 7 }],
    ]);

    await collection
      .orderBy(((task: Record<string, { asc(): unknown }>) => task['title']!.asc()) as never)
      .all();

    const ast = runtime.executions[0]!.plan.ast;
    const orderRefs = isSelectAst(ast)
      ? (ast.orderBy ?? []).flatMap((item) => collectColumnRefs(item.expr))
      : [];
    expect(orderRefs).toEqual([ColumnRef.of('tasks', 'title')]);
  });

  it('variant() on a polymorphic-target include refinement sets nested variantName', () => {
    const contract = buildMixedPolyContract();
    const context = { ...getTestContext(), contract };
    const runtime = createMockRuntime();
    const projects = new Collection({ runtime, context }, 'Project', {
      namespaceId: 'public',
    }) as unknown as PolyParent;

    const refined = projects.include('tasks', (tasks) => tasks.variant('Bug'));

    expect(refined.state.includes[0]?.nested.variantName).toBe('Bug');
  });

  it('include of a polymorphic-target relation without refinement leaves variantName unset', () => {
    const contract = buildMixedPolyContract();
    const context = { ...getTestContext(), contract };
    const runtime = createMockRuntime();
    const projects = new Collection({ runtime, context }, 'Project', {
      namespaceId: 'public',
    }) as unknown as PolyParent;

    const included = projects.include('tasks');

    expect(included.state.includes[0]?.nested.variantName).toBeUndefined();
  });

  it('updateAndCount after variant(Feature) scopes MTI scalar predicates through the write subquery', async () => {
    const { collection, runtime } = createMixedPolyCollection();
    runtime.setNextStats([{ affectedRows: 1 }]);

    const mixedPoly = blindCast<
      MixedPolyCountCollection,
      'mixed poly test contract patches Task variants outside the static fixture type'
    >(collection);
    const count = await mixedPoly
      .variant('Feature')
      .where((task) => task.priority.gt(1))
      .updateAndCount({ title: 'Queued' });

    expect(count).toBe(1);
    expect(runtime.executions).toHaveLength(1);
    expect(runtime.executions[0]?.operation).toBe('execute');

    const writeAst = runtime.executions[0]!.plan.ast;
    expect(writeAst.kind).toBe('update');
    if (writeAst.kind !== 'update') {
      throw new Error('Expected an UPDATE plan');
    }
    const exists = expectExistsWithFeatureJoin(writeAst.where);
    expect(
      collectColumnRefs(exists.subquery.where).filter(
        (ref) => ref.table === 'features' && ref.column === 'priority',
      ),
    ).toHaveLength(1);
  });

  it('deleteAndCount after variant(Feature) scopes MTI relation predicates through the write subquery', async () => {
    const { collection, runtime } = createMixedPolyCollection();
    runtime.setNextStats([{ affectedRows: 1 }]);

    const mixedPoly = blindCast<
      MixedPolyCountCollection,
      'mixed poly test contract patches Task variants outside the static fixture type'
    >(collection);
    const count = await mixedPoly
      .variant('Feature')
      .where((task) => task.assignee.some())
      .deleteAndCount();

    expect(count).toBe(1);
    expect(runtime.executions).toHaveLength(1);
    expect(runtime.executions[0]?.operation).toBe('execute');

    const writeAst = runtime.executions[0]!.plan.ast;
    expect(writeAst.kind).toBe('delete');
    if (writeAst.kind !== 'delete') {
      throw new Error('Expected a DELETE plan');
    }
    const exists = expectExistsWithFeatureJoin(writeAst.where);
    expect(
      collectColumnRefs(exists.subquery.where).filter(
        (ref) => ref.table === 'features' && ref.column === 'assignee_id',
      ),
    ).toHaveLength(1);
  });

  it('deleteAll with includes after variant(Feature) scopes MTI predicates through the write subquery', async () => {
    const { collection, runtime } = createReturningMixedPolyCollection();
    runtime.setNextResults([[], []]);

    const mixedPoly = blindCast<
      MixedPolyCountCollection,
      'mixed poly test contract patches Task variants outside the static fixture type'
    >(collection);
    const rows = await mixedPoly
      .variant('Feature')
      .where((task) => task.priority.gt(1))
      .include('assignee')
      .deleteAll()
      .toArray();

    expect(rows).toEqual([]);
    expect(runtime.executions).toHaveLength(2);
    expectSelectWithFeatureJoin(runtime.executions[0]!.plan.ast);

    const writeAst = runtime.executions[1]!.plan.ast;
    expect(writeAst.kind).toBe('delete');
    if (writeAst.kind !== 'delete') {
      throw new Error('Expected a DELETE plan');
    }
    const exists = expectExistsWithFeatureJoin(writeAst.where);
    expect(
      collectColumnRefs(exists.subquery.where).filter(
        (ref) => ref.table === 'features' && ref.column === 'priority',
      ),
    ).toHaveLength(1);
  });
});

function createReturningMixedPolyCollection() {
  const contract = withReturningCapability(buildMixedPolyContract());
  const baseContext = getTestContext();
  const context = { ...baseContext, contract };
  const runtime = createMockRuntime();
  const collection = new Collection({ runtime, context }, 'Task', { namespaceId: 'public' });
  return { collection, runtime, contract };
}

describe('STI variant create (discriminator auto-injection)', () => {
  it('injects discriminator column/value into INSERT for STI variant', async () => {
    const { collection, runtime } = createReturningMixedPolyCollection();
    runtime.setNextResults([[{ id: 1, title: 'Crash', type: 'bug', severity: 'critical' }]]);

    const narrowed = collection.variant('Bug' as never) as typeof collection;
    await narrowed.createAll([{ title: 'Crash', severity: 'critical' } as never]).toArray();

    const execution = runtime.executions[0]!;
    const ast = execution.plan.ast as InsertAst;
    expect(ast.kind).toBe('insert');

    const firstRow = ast.rows![0]!;
    const typeParam = firstRow['type'];
    expect(typeParam).toBeDefined();
    expect(typeParam!.kind).toBe('param-ref');
    expect((typeParam as { value: unknown }).value).toBe('bug');
  });

  it('maps variant fields through merged base+variant column map', async () => {
    const { collection, runtime } = createReturningMixedPolyCollection();
    runtime.setNextResults([
      [{ id: 1, title: 'Crash', type: 'bug', severity: 'critical', assignee_id: 7 }],
    ]);

    const narrowed = collection.variant('Bug' as never) as typeof collection;
    const rows = await narrowed
      .createAll([{ title: 'Crash', severity: 'critical', assigneeId: 7 } as never])
      .toArray();

    const execution = runtime.executions[0]!;
    const ast = execution.plan.ast as InsertAst;
    const firstRow = ast.rows![0]!;

    expect(firstRow['title']).toBeDefined();
    expect(firstRow['severity']).toBeDefined();
    expect(firstRow['assignee_id']).toBeDefined();
    expect(firstRow['type']).toBeDefined();
    expect(rows).toEqual([
      { id: 1, title: 'Crash', type: 'bug', severity: 'critical', assigneeId: 7 },
    ]);
  });
});

describe('MTI variant mutation guards', () => {
  it('createAndCount() throws for MTI variants', async () => {
    const { collection } = createReturningMixedPolyCollection();
    const narrowed = collection.variant('Feature' as never) as typeof collection;
    await expect(narrowed.createAndCount([{ title: 'X', priority: 1 } as never])).rejects.toThrow(
      /createAndCount\(\) is not supported for MTI variant/,
    );
  });

  it('upsert() throws for MTI variants', async () => {
    const { collection } = createReturningMixedPolyCollection();
    const narrowed = collection.variant('Feature' as never) as typeof collection;
    await expect(
      narrowed.upsert({
        create: { title: 'X', priority: 1 } as never,
        update: {},
      }),
    ).rejects.toThrow(/upsert\(\) is not supported for MTI variant/);
  });
});

describe('STI variant upsert (discriminator auto-injection)', () => {
  it('injects discriminator into upsert create values for STI variant', async () => {
    const { collection, runtime } = createReturningMixedPolyCollection();
    runtime.setNextResults([[{ id: 1, title: 'Crash', type: 'bug', severity: 'critical' }]]);

    const narrowed = collection.variant('Bug' as never) as typeof collection;
    await narrowed.upsert({
      create: { title: 'Crash', severity: 'critical' } as never,
      update: { title: 'Updated' } as never,
    });

    const execution = runtime.executions[0]!;
    const ast = execution.plan.ast as InsertAst;
    expect(ast.kind).toBe('insert');

    const insertRow = ast.rows![0]!;
    const typeParam = insertRow['type'];
    expect(typeParam).toBeDefined();
    expect((typeParam as { value: unknown }).value).toBe('bug');

    expect(insertRow['severity']).toBeDefined();
  });
});

describe('MTI variant create (two-INSERT orchestration)', () => {
  it.each([1, 2])('shares a defaults cache across both tables and all %i rows', async (count) => {
    const contract = withReturningCapability(buildMixedPolyContract());
    const baseContext = getTestContext();
    const applyMutationDefaults = vi.fn(baseContext.applyMutationDefaults);
    const context = { ...baseContext, contract, applyMutationDefaults };
    const runtime = createMockRuntime();
    const collection = new Collection({ runtime, context }, 'Task', { namespaceId: 'public' });
    const narrowed = collection.variant('Feature' as never) as typeof collection;
    const input = Array.from({ length: count }, (_, index) => ({
      title: `Feature ${index}`,
      priority: index,
    }));
    const results = input.flatMap((row, index) => [
      [{ id: index + 1, title: row.title, type: 'feature' }],
      [{ id: index + 1, priority: row.priority }],
    ]);
    runtime.setNextResults(results);

    await narrowed.createAll(input as never).toArray();

    const calls = applyMutationDefaults.mock.calls.map(([options]) => options);
    expect(calls.map(({ table }) => table)).toEqual(input.flatMap(() => ['tasks', 'features']));
    const cache = calls[0]!.defaultValueCache;
    expect(cache).toBeInstanceOf(Map);
    for (const call of calls) {
      expect(call.defaultValueCache).toBe(cache);
    }

    applyMutationDefaults.mockClear();
    runtime.setNextResults(results);
    await narrowed.createAll(input as never).toArray();
    expect(applyMutationDefaults.mock.calls[0]![0].defaultValueCache).toBeInstanceOf(Map);
    expect(applyMutationDefaults.mock.calls[0]![0].defaultValueCache).not.toBe(cache);
  });

  it('executes two INSERTs: base table then variant table', async () => {
    const { collection, runtime } = createReturningMixedPolyCollection();
    runtime.setNextResults([
      [{ id: 10, title: 'Dark mode', type: 'feature' }],
      [{ id: 10, priority: 1 }],
    ]);

    const narrowed = collection.variant('Feature' as never) as typeof collection;
    await narrowed.createAll([{ title: 'Dark mode', priority: 1 } as never]).toArray();

    expect(runtime.executions).toHaveLength(2);

    const baseAst = runtime.executions[0]!.plan.ast as InsertAst;
    expect(baseAst.kind).toBe('insert');
    expect(baseAst.table.name).toBe('tasks');

    const baseRow = baseAst.rows![0]!;
    expect(baseRow['title']).toBeDefined();
    expect(baseRow['type']).toBeDefined();
    expect((baseRow['type'] as { value: unknown }).value).toBe('feature');
    expect(baseRow['priority']).toBeUndefined();

    const variantAst = runtime.executions[1]!.plan.ast as InsertAst;
    expect(variantAst.kind).toBe('insert');
    expect(variantAst.table.name).toBe('features');

    const variantRow = variantAst.rows![0]!;
    expect(variantRow['priority']).toBeDefined();
    expect(variantRow['id']).toBeDefined();
    expect((variantRow['id'] as { value: unknown }).value).toBe(10);
  });

  it('uses variant RETURNING result for the yielded row', async () => {
    const { collection, runtime } = createReturningMixedPolyCollection();
    runtime.setNextResults([
      [{ id: 10, title: 'Dark mode', type: 'feature' }],
      [{ id: 10, priority: 99 }],
    ]);

    const narrowed = collection.variant('Feature' as never) as typeof collection;
    const rows = await narrowed.createAll([{ title: 'Dark mode', priority: 1 } as never]).toArray();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty('priority', 99);
  });

  it('wraps both INSERTs in a transaction when available', async () => {
    const contract = withReturningCapability(buildMixedPolyContract());
    const baseContext = getTestContext();
    const context = { ...baseContext, contract };
    const baseRuntime = createMockRuntime();
    baseRuntime.setNextResults([
      [{ id: 10, title: 'Dark mode', type: 'feature' }],
      [{ id: 10, priority: 1 }],
    ]);

    const commit = vi.fn().mockResolvedValue(undefined);
    const rollback = vi.fn().mockResolvedValue(undefined);
    const txRuntime = {
      ...baseRuntime,
      transaction: vi.fn().mockResolvedValue({
        query: baseRuntime.query.bind(baseRuntime),
        execute: baseRuntime.execute.bind(baseRuntime),
        commit,
        rollback,
      }),
    };

    const collection = new Collection({ runtime: txRuntime, context }, 'Task', {
      namespaceId: 'public',
    });
    const narrowed = collection.variant('Feature' as never) as typeof collection;
    await narrowed.createAll([{ title: 'Dark mode', priority: 1 } as never]).toArray();

    expect(txRuntime.transaction).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
    expect(baseRuntime.executions).toHaveLength(2);
  });
});
