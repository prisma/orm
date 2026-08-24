import { describe, expect, it } from 'vitest';
import { createCollectionFor } from './collection-fixtures';
import { isSelectAst, type MockRuntime } from './helpers';

function planOf(runtime: MockRuntime) {
  const execution = runtime.executions[0];
  if (execution === undefined) {
    throw new Error('Expected the aggregate chain to run one execution');
  }
  const { ast } = execution.plan;
  if (!isSelectAst(ast)) {
    throw new Error('Expected the aggregate execution plan to be a select SQL query plan');
  }
  return { ast, params: execution.plan.params };
}

const numericField = 'views' as never;

// Aggregate chains that name no aggregate input (no limit/offset/cursor/distinct)
// compile through the unchanged plain-filters path today. These snapshots
// pin that output before any input-select machinery lands, so a later change
// that widens the input-wrap condition too far shows up as a diff here
// instead of silently changing what an unpaginated aggregate compiles to.
describe('aggregate plan baseline for chains naming no aggregate input', () => {
  it('root aggregate() with no other clause', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ totalViews: 500 }]]);

    await collection.aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

    expect(planOf(runtime)).toMatchSnapshot();
  });

  it('root aggregate() with where()', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ totalViews: 500 }]]);

    await collection
      .where((post) => post.views.gte(100))
      .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

    expect(planOf(runtime)).toMatchSnapshot();
  });

  it('root aggregate() with orderBy() stays inert', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ totalViews: 500 }]]);

    await collection
      .orderBy((post) => post.views.desc())
      .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

    expect(planOf(runtime)).toMatchSnapshot();
  });

  it('root aggregate() with multiple selectors including a no-column count()', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ total: 3, totalViews: 500, avgViews: 166.67 }]]);

    await collection.aggregate((aggregate) => ({
      total: aggregate.count(),
      totalViews: aggregate.sum(numericField),
      avgViews: aggregate.avg(numericField),
    }));

    expect(planOf(runtime)).toMatchSnapshot();
  });

  it('groupBy().aggregate() with no other clause', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, totalViews: 500 }]]);

    await collection
      .groupBy('userId')
      .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

    expect(planOf(runtime)).toMatchSnapshot();
  });

  it('groupBy().aggregate() with where()', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, totalViews: 500 }]]);

    await collection
      .where((post) => post.views.gte(100))
      .groupBy('userId')
      .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

    expect(planOf(runtime)).toMatchSnapshot();
  });

  it('groupBy().having().aggregate()', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, totalViews: 500 }]]);

    await collection
      .groupBy('userId')
      .having((having) => having.count().gte(1))
      .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

    expect(planOf(runtime)).toMatchSnapshot();
  });
});
