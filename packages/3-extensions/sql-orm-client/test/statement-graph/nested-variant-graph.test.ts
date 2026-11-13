import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { ParamRef } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { requireVariantTable } from '../../src/collection-tables';
import { parseMutationInput } from '../../src/relation-mutations';
import {
  createAllVariantGraph,
  createGraph,
  updateFirstGraph,
} from '../../src/statement-graph/collection-graphs';
import type { Graph } from '../../src/statement-graph/graph';
import { Insert } from '../../src/statement-graph/insert';
import { mtiCreateContextOf } from '../../src/statement-graph/storage-rows';
import type { Contract as PolyContract } from '../fixtures/polymorphism/generated/contract';
import polyContractJson from '../fixtures/polymorphism/generated/contract.json' with {
  type: 'json',
};
import { buildTestContextFromContract, createMockRuntime } from '../helpers';
import { printGraph } from './print-graph';
import { visibleNodes } from './statements';

interface VariantMutator {
  variant(value: string): {
    create(data: object | readonly object[]): unknown;
    connect(criteria: object | readonly object[]): unknown;
    disconnect(criteria?: readonly object[]): unknown;
  };
}

const serializer = new PostgresContractSerializer();

type TestContext = ExecutionContext<Contract<SqlStorage>>;

const polyContract = serializer.deserializeContract<PolyContract>(polyContractJson);
const context = buildTestContextFromContract(polyContract);
const contextWithoutReturning = {
  ...context,
  contract: {
    ...polyContract,
    capabilities: Object.fromEntries(
      Object.entries(polyContract.capabilities).map(([target, flags]) => [
        target,
        Object.fromEntries(Object.entries(flags).filter(([flag]) => flag !== 'returning')),
      ]),
    ),
  },
};

function relatedCollection(ctx: TestContext = context) {
  const runtime = createMockRuntime();
  return (relation: { readonly to: string; readonly toNamespace: string }) =>
    new Collection({ runtime, context: ctx }, relation.to, { namespaceId: relation.toNamespace });
}

function parsed(modelName: string, data: Record<string, unknown>, ctx: TestContext = context) {
  return parseMutationInput(
    ctx.contract,
    'public',
    modelName,
    data as never,
    relatedCollection(ctx),
  );
}

function targetOf(modelName: string) {
  const collection = new Collection({ runtime: createMockRuntime(), context }, modelName, {
    namespaceId: 'public',
  });
  return { context, state: collection.where({ id: 1 }).state, modelName, namespaceId: 'public' };
}

function createOf(
  modelName: string,
  data: Record<string, unknown>,
  ctx: TestContext = context,
): Graph {
  const collection = new Collection({ runtime: createMockRuntime(), context: ctx }, modelName, {
    namespaceId: 'public',
  });
  return createGraph(
    { context: ctx, state: collection.state, modelName, namespaceId: 'public' },
    parsed(modelName, data, ctx),
  );
}

function updateOf(modelName: string, data: Record<string, unknown>): Graph {
  return updateFirstGraph(targetOf(modelName), {}, parsed(modelName, data).relationMutations);
}

function insertedRows(graph: Graph, table: string): Record<string, unknown>[] {
  return visibleNodes(graph).flatMap(([, node]) =>
    node instanceof Insert
      ? node.asts
          .filter((ast) => ast.table.name === table)
          .flatMap((ast) =>
            ast.rows.map((row) =>
              Object.fromEntries(
                Object.entries(row).map(([column, value]) => [
                  column,
                  value instanceof ParamRef ? value.value : value.kind,
                ]),
              ),
            ),
          )
      : [],
  );
}

const crash = { title: 'Crash', severity: 'high' };
const hang = { title: 'Hang', severity: 'low' };
const crashRow = { title: 'Crash', type: 'bug', severity: 'high' };
const hangRow = { title: 'Hang', type: 'bug', severity: 'low' };

describe('a nested create of a variant stored in the base table', () => {
  describe('on a relation the child holds the key for', () => {
    it('inserts the rows in one Insert with the discriminator and the key of the parent in create()', () => {
      const graph = createOf('Project', {
        id: 1,
        name: 'Launch',
        tasks: (tasks: VariantMutator) => tasks.variant('bug').create([crash, hang]),
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Insert projects_tbl',
          'n2 Insert tasks 2 rows <- PayloadData n1 (id->project_id)',
          'result: n1',
        ].join('\n'),
      );
      expect(insertedRows(graph, 'tasks')).toEqual([crashRow, hangRow]);
    });
  });
});

interface CommentMutator {
  create(data: object): unknown;
}

function thrownBy(run: () => unknown): { code?: unknown; message?: unknown; meta?: unknown } {
  try {
    run();
  } catch (error) {
    return error as { code?: unknown; message?: unknown; meta?: unknown };
  }
  throw new Error('expected the call to throw');
}

function topLevelBugCreate(data: Record<string, unknown>): Graph {
  const bugs = new Collection({ runtime: createMockRuntime(), context }, 'Task', {
    namespaceId: 'public',
  }).variant('bug');
  return createGraph(
    { context, state: bugs.state, modelName: 'Task', namespaceId: 'public' },
    parsed('Task', data),
  );
}

describe('a nested create of a variant stored in the base table with a relation callback in its row', () => {
  it('inserts each row with the discriminator in its own Insert in update()', () => {
    const graph = updateOf('Project', {
      tasks: (tasks: VariantMutator) =>
        tasks.variant('bug').create([
          {
            ...crash,
            comments: (comments: CommentMutator) => comments.create({ body: 'Seen it' }),
          },
          hang,
        ]),
    });

    expect(printGraph(graph)).toBe(
      [
        'n1 Find projects_tbl where id = 1',
        'n2 Insert tasks <- PayloadData n1 (id->project_id)',
        'n3 Insert task_comments <- PayloadData n2 (id->task_id)',
        'n4 Insert tasks <- PayloadData n1 (id->project_id)',
        'result: n1',
      ].join('\n'),
    );
    expect(insertedRows(graph, 'tasks')).toEqual([crashRow, hangRow]);
  });

  it('refuses a callback on a relation of the variant with the error of the top-level variant create', () => {
    const assignee = { assignee: (person: CommentMutator) => person.create({ name: 'Ada' }) };
    const topLevel = thrownBy(() => topLevelBugCreate({ ...crash, ...assignee }));
    const nested = thrownBy(() =>
      createOf('Project', {
        id: 1,
        name: 'Launch',
        tasks: (tasks: VariantMutator) => tasks.variant('bug').create({ ...crash, ...assignee }),
      }),
    );

    expect(topLevel).toMatchObject({ code: 'ORM.FIELD_UNKNOWN' });
    expect(nested).toMatchObject({
      code: topLevel.code,
      message: topLevel.message,
      meta: topLevel.meta,
    });
  });
});

const darkMode = { title: 'Dark mode', priority: 1 };
const exportPdf = { title: 'Export to PDF', priority: 3 };

describe('a nested create of a variant stored in its own table', () => {
  describe('on a relation the child holds the key for', () => {
    it('inserts the base row with the key of the parent, then the variant row with its key, per row in create()', () => {
      const graph = createOf('Project', {
        id: 1,
        name: 'Launch',
        tasks: (tasks: VariantMutator) => tasks.variant('feature').create([darkMode, exportPdf]),
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Insert projects_tbl',
          'n2 Insert tasks <- PayloadData n1 (id->project_id)',
          'n3 Insert features <- PayloadData n2 (id->id)',
          'n4 Insert tasks <- PayloadData n1 (id->project_id)',
          'n5 Insert features <- PayloadData n4 (id->id)',
          'result: n1',
        ].join('\n'),
      );
      expect(insertedRows(graph, 'tasks')).toEqual([
        { title: 'Dark mode', type: 'feature' },
        { title: 'Export to PDF', type: 'feature' },
      ]);
      expect(insertedRows(graph, 'features')).toEqual([{ priority: 1 }, { priority: 3 }]);
    });

    it('inserts the base row with the key of the parent on a to-one relation', () => {
      const graph = updateOf('Person', {
        pinnedTask: (task: VariantMutator) => task.variant('feature').create(darkMode),
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Find people where id = 1',
          'n2 Insert tasks <- PayloadData n1 (id->pinned_by_id)',
          'n3 Insert features <- PayloadData n2 (id->id)',
          'result: n1',
        ].join('\n'),
      );
    });
  });

  describe('on a relation the parent holds the key for', () => {
    it('inserts the base and variant rows first and copies the base key into the parent in create()', () => {
      const graph = createOf('TaskComment', {
        body: 'Seen it',
        task: (task: VariantMutator) => task.variant('feature').create(darkMode),
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Insert tasks',
          'n2 Insert features <- PayloadData n1 (id->id)',
          'n3 Insert task_comments <- PayloadData n1 (id->task_id)',
          'result: n3',
        ].join('\n'),
      );
    });
  });

  describe('on a relation through a junction', () => {
    it('inserts the base and variant rows and links the base key, per row in create()', () => {
      const graph = createOf('Label', {
        name: 'ui',
        tasks: (tasks: VariantMutator) => tasks.variant('feature').create([darkMode, exportPdf]),
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Insert labels',
          'n2 Insert tasks',
          'n3 Insert features <- PayloadData n2 (id->id)',
          'n4 Insert task_labels <- PayloadData n1 (id->label_id), PayloadData n2 (id->task_id)',
          'n5 Insert tasks',
          'n6 Insert features <- PayloadData n5 (id->id)',
          'n7 Insert task_labels <- PayloadData n1 (id->label_id), PayloadData n5 (id->task_id)',
          'result: n1',
        ].join('\n'),
      );
    });

    it('inserts the base and variant rows and links the base key in update()', () => {
      const graph = updateOf('Label', {
        tasks: (tasks: VariantMutator) => tasks.variant('feature').create(darkMode),
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Find labels where id = 1',
          'n2 Insert tasks <- Requires n1',
          'n3 Insert features <- PayloadData n2 (id->id)',
          'n4 Insert task_labels <- PayloadData n1 (id->label_id), PayloadData n2 (id->task_id)',
          'result: n1',
        ].join('\n'),
      );
    });
  });

  function topLevelFeatureCreate(row: Record<string, unknown>) {
    const features = new Collection({ runtime: createMockRuntime(), context }, 'Task', {
      namespaceId: 'public',
    }).variant('feature');
    return thrownBy(() => {
      parsed('Task', row);
      const mti = mtiCreateContextOf({
        context,
        state: features.state,
        modelName: 'Task',
        namespaceId: 'public',
      });
      if (mti === undefined) {
        throw new Error('feature is stored in its own table');
      }
      createAllVariantGraph(
        { context, state: features.state, modelName: 'Task', namespaceId: 'public' },
        requireVariantTable(features.state.tables, 'feature'),
        mti,
        [row],
      );
    });
  }

  function nestedFeatureCreate(row: Record<string, unknown>) {
    return thrownBy(() =>
      createOf('Project', {
        id: 1,
        name: 'Launch',
        tasks: (tasks: VariantMutator) => tasks.variant('feature').create(row),
      }),
    );
  }

  it('refuses a relation callback in the row with the error of the top-level variant create', () => {
    const row = {
      ...darkMode,
      comments: (comments: CommentMutator) => comments.create({ body: 'Seen it' }),
    };
    const topLevel = topLevelFeatureCreate(row);

    expect(topLevel).toMatchObject({ code: 'ORM.FIELD_UNKNOWN' });
    expect(nestedFeatureCreate(row)).toMatchObject({
      code: topLevel.code,
      message: topLevel.message,
      meta: topLevel.meta,
    });
  });

  it('refuses a relation callback that returns no operation with the error of the top-level variant create', () => {
    const row = { ...darkMode, comments: () => 'not an operation' };
    const topLevel = topLevelFeatureCreate(row);

    expect(topLevel).toMatchObject({ code: 'ORM.RELATION_MUTATION_INVALID' });
    expect(nestedFeatureCreate(row)).toMatchObject({
      code: topLevel.code,
      message: topLevel.message,
      meta: topLevel.meta,
    });
  });

  it('is refused on a contract without returning as create() on the variant refuses it', () => {
    expect(
      thrownBy(() =>
        createOf(
          'Project',
          {
            id: 1,
            name: 'Launch',
            tasks: (tasks: VariantMutator) => tasks.variant('feature').create(darkMode),
          },
          contextWithoutReturning,
        ),
      ),
    ).toMatchObject({
      code: 'ORM.CAPABILITY_MISSING',
      message: 'create() requires contract capability "returning"',
      meta: { capability: 'returning', action: 'create()' },
    });
  });
});

describe('the base mutator on a polymorphic target with a variant stored in its own table', () => {
  interface Mutator {
    connect(criteria: object): unknown;
    disconnect(criteria?: readonly object[]): unknown;
  }

  it('finds the row to connect on a relation the parent holds the key for', () => {
    expect(
      printGraph(updateOf('TaskComment', { task: (task: Mutator) => task.connect({ id: 2 }) })),
    ).toBe(
      [
        'n1 Find task_comments where id = 1',
        'n2 Find tasks where id = 2 limit 1 <- Requires n1',
        'n3 Assert <- Rows n2, Requires n1',
        'n4 Update task_comments set nothing where id = 1 <- PayloadData n2 (id->task_id)',
        'result: n4',
      ].join('\n'),
    );
  });

  it('finds the rows to connect and to disconnect on a relation through a junction', () => {
    expect(
      printGraph(
        updateOf('Label', {
          tasks: (tasks: Mutator) => [tasks.connect({ id: 2 }), tasks.disconnect([{ id: 3 }])],
        }),
      ),
    ).toBe(
      [
        'n1 Find labels where id = 1',
        'n2 Find tasks where id = 2 limit 1 <- Requires n1',
        'n3 Assert <- Rows n2, Requires n1',
        'n4 Insert task_labels on conflict (task_id, label_id) do nothing <- PayloadData n1 (id->label_id), PayloadData n2 (id->task_id)',
        'n5 Find tasks where id = 3 limit 1 <- Requires n1',
        'n6 Assert <- Rows n5, Requires n1',
        'n7 Delete task_labels <- FilterData n1 (id->label_id), FilterData n5 (id->task_id)',
        'result: n1',
      ].join('\n'),
    );
  });
});

const featureTwo =
  "exists (select id from tasks tasks_2 inner join features on tasks_2.id = features.id where (id = tasks.id and tasks.type = 'feature' and tasks.id = 2))";

describe('connect and disconnect on a variant stored in the base table', () => {
  it('adds the discriminator to the Update that links a row on a relation the child holds the key for', () => {
    expect(
      printGraph(
        updateOf('Project', {
          tasks: (tasks: VariantMutator) => tasks.variant('bug').connect({ id: 2 }),
        }),
      ),
    ).toBe(
      [
        'n1 Find projects_tbl where id = 1',
        "n2 Update tasks set nothing where type = 'bug' and id = 2 <- PayloadData n1 (id->project_id)",
        'result: n1',
      ].join('\n'),
    );
  });

  it('unlinks only rows of the variant on disconnect without criteria', () => {
    expect(
      printGraph(
        updateOf('Project', {
          tasks: (tasks: VariantMutator) => tasks.variant('bug').disconnect(),
        }),
      ),
    ).toBe(
      [
        'n1 Find projects_tbl where id = 1',
        "n2 Update tasks set project_id = null where type = 'bug' <- FilterData n1 (id->project_id)",
        'result: n1',
      ].join('\n'),
    );
  });

  it('adds the discriminator to the Find of the row to connect on a relation the parent holds the key for', () => {
    expect(
      printGraph(
        updateOf('TaskComment', {
          task: (task: VariantMutator) => task.variant('bug').connect({ id: 2 }),
        }),
      ),
    ).toBe(
      [
        'n1 Find task_comments where id = 1',
        "n2 Find tasks where type = 'bug' and id = 2 limit 1 <- Requires n1",
        'n3 Assert <- Rows n2, Requires n1',
        'n4 Update task_comments set nothing where id = 1 <- PayloadData n2 (id->task_id)',
        'result: n4',
      ].join('\n'),
    );
  });

  it('adds the discriminator to the Find of the row to connect through a junction', () => {
    expect(
      printGraph(
        updateOf('Label', {
          tasks: (tasks: VariantMutator) => tasks.variant('bug').connect({ id: 2 }),
        }),
      ),
    ).toBe(
      [
        'n1 Find labels where id = 1',
        "n2 Find tasks where type = 'bug' and id = 2 limit 1 <- Requires n1",
        'n3 Assert <- Rows n2, Requires n1',
        'n4 Insert task_labels on conflict (task_id, label_id) do nothing <- PayloadData n1 (id->label_id), PayloadData n2 (id->task_id)',
        'result: n1',
      ].join('\n'),
    );
  });
});

describe('connect and disconnect on a variant stored in its own table', () => {
  it('adds the variant condition to the Update that links a row in create()', () => {
    expect(
      printGraph(
        createOf('Project', {
          id: 1,
          name: 'Launch',
          tasks: (tasks: VariantMutator) => tasks.variant('feature').connect([{ id: 2 }]),
        }),
      ),
    ).toBe(
      [
        'n1 Insert projects_tbl',
        `n2 Update tasks set nothing where ${featureTwo} <- PayloadData n1 (id->project_id)`,
        'result: n1',
      ].join('\n'),
    );
  });

  it('adds the variant condition to the Update that unlinks a row on 1:N and 1:1', () => {
    expect(
      printGraph(
        updateOf('Project', {
          tasks: (tasks: VariantMutator) => tasks.variant('feature').disconnect([{ id: 2 }]),
        }),
      ),
    ).toBe(
      [
        'n1 Find projects_tbl where id = 1',
        `n2 Update tasks set project_id = null where ${featureTwo} <- FilterData n1 (id->project_id)`,
        'result: n1',
      ].join('\n'),
    );
    expect(
      printGraph(
        updateOf('Person', {
          pinnedTask: (task: VariantMutator) => task.variant('feature').disconnect(),
        }),
      ),
    ).toBe(
      [
        'n1 Find people where id = 1',
        "n2 Update tasks set pinned_by_id = null where exists (select id from tasks tasks_2 inner join features on tasks_2.id = features.id where (id = tasks.id and tasks.type = 'feature')) <- FilterData n1 (id->pinned_by_id)",
        'result: n1',
      ].join('\n'),
    );
  });

  it('adds the variant condition to the Find of the row to connect on a relation the parent holds the key for', () => {
    expect(
      printGraph(
        updateOf('TaskComment', {
          task: (task: VariantMutator) => task.variant('feature').connect({ id: 2 }),
        }),
      ),
    ).toBe(
      [
        'n1 Find task_comments where id = 1',
        `n2 Find tasks where ${featureTwo} limit 1 <- Requires n1`,
        'n3 Assert <- Rows n2, Requires n1',
        'n4 Update task_comments set nothing where id = 1 <- PayloadData n2 (id->task_id)',
        'result: n4',
      ].join('\n'),
    );
  });

  it('adds the variant condition to the Find of the row to unlink through a junction', () => {
    expect(
      printGraph(
        updateOf('Label', {
          tasks: (tasks: VariantMutator) => tasks.variant('feature').disconnect([{ id: 2 }]),
        }),
      ),
    ).toBe(
      [
        'n1 Find labels where id = 1',
        `n2 Find tasks where ${featureTwo} limit 1 <- Requires n1`,
        'n3 Assert <- Rows n2, Requires n1',
        'n4 Delete task_labels <- FilterData n1 (id->label_id), FilterData n2 (id->task_id)',
        'result: n1',
      ].join('\n'),
    );
  });
});

describe('disconnect on a variant where the base mutator refuses it or the parent holds the key', () => {
  it('is refused on a relation the parent holds the key for while the graph is built', () => {
    expect(
      thrownBy(() =>
        updateOf('TaskComment', {
          task: (task: VariantMutator) => task.variant('bug').disconnect(),
        }),
      ),
    ).toMatchObject({
      code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
      message:
        'disconnect() nested mutation for relation "task" is not available on a variant, because the parent holds the key of the related row',
      meta: { kind: 'disconnect', relation: 'task', reason: 'variant-parent-owned' },
    });
  });

  it('is refused in create() as on the base mutator', () => {
    expect(
      thrownBy(() =>
        createOf('Project', {
          id: 1,
          name: 'Launch',
          tasks: (tasks: VariantMutator) => tasks.variant('bug').disconnect([{ id: 2 }]),
        }),
      ),
    ).toMatchObject({
      code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
      message: 'disconnect() is only supported in update() nested mutations',
      meta: { kind: 'disconnect', relation: 'tasks' },
    });
  });

  it('without criteria is refused through a junction as on the base mutator', () => {
    expect(
      thrownBy(() =>
        updateOf('Label', { tasks: (tasks: VariantMutator) => tasks.variant('bug').disconnect() }),
      ),
    ).toMatchObject({
      code: 'ORM.RELATION_MUTATION_INVALID',
      meta: { kind: 'disconnect', relation: 'tasks', problem: 'missing-criterion' },
    });
  });
});
