import { ParamRef } from '@internal/sql-relational-core/ast';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { requireVariantTable } from '../../src/collection-tables';
import {
  createAllVariantGraph,
  createGraph,
  updateFirstGraph,
} from '../../src/mutation-graph/collection-graphs';
import type { Graph } from '../../src/mutation-graph/graph';
import { Insert } from '../../src/mutation-graph/insert';
import { mtiCreateContextOf } from '../../src/mutation-graph/storage-rows';
import { parseMutationInput } from '../../src/relation-mutations';
import type { Contract as PolyContract } from '../fixtures/polymorphism/generated/contract';
import polyContractJson from '../fixtures/polymorphism/generated/contract.json' with {
  type: 'json',
};
import { buildTestContextFromContract, createMockRuntime } from '../helpers';
import { printGraph } from './print-graph';
import { visibleNodes } from './statements';

interface VariantMutator {
  variant(value: string): { create(data: object | readonly object[]): unknown };
}

const serializer = new PostgresContractSerializer();

function withPinnedTask(json: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(json));
  copy.domain.namespaces.public.models.Person.relations.pinnedTask = {
    to: { model: 'Task', namespace: 'public' },
    cardinality: '1:1',
    on: { localFields: ['id'], targetFields: ['reporterId'] },
  };
  return copy;
}

function withoutReturning(json: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(json));
  for (const group of Object.values<Record<string, unknown>>(copy.capabilities)) {
    delete group['returning'];
  }
  return copy;
}

const context = buildTestContextFromContract(
  serializer.deserializeContract<PolyContract>(withPinnedTask(polyContractJson)),
);
const contextWithoutReturning = {
  ...context,
  contract: serializer.deserializeContract<PolyContract>(withoutReturning(polyContractJson)),
};

function relatedCollection(ctx = context) {
  const runtime = createMockRuntime();
  return (relation: { readonly to: string; readonly toNamespace: string }) =>
    new Collection({ runtime, context: ctx }, relation.to, { namespaceId: relation.toNamespace });
}

function parsed(modelName: string, data: Record<string, unknown>, ctx = context) {
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

function createOf(modelName: string, data: Record<string, unknown>, ctx = context): Graph {
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

    it('inserts the row with the discriminator after finding the parent in update()', () => {
      const graph = updateOf('Project', {
        tasks: (tasks: VariantMutator) => tasks.variant('bug').create(crash),
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Find projects_tbl where id = 1',
          'n2 Insert tasks <- PayloadData n1 (id->project_id)',
          'result: n1',
        ].join('\n'),
      );
      expect(insertedRows(graph, 'tasks')).toEqual([crashRow]);
    });

    it('inserts the row with the discriminator on a to-one relation', () => {
      const graph = updateOf('Person', {
        pinnedTask: (task: VariantMutator) => task.variant('bug').create(crash),
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Find people where id = 1',
          'n2 Insert tasks <- PayloadData n1 (id->reporter_id)',
          'result: n1',
        ].join('\n'),
      );
      expect(insertedRows(graph, 'tasks')).toEqual([crashRow]);
    });
  });

  describe('on a relation the parent holds the key for', () => {
    it('inserts the row with the discriminator first and copies its key into the parent in create()', () => {
      const graph = createOf('TaskComment', {
        body: 'Seen it',
        task: (task: VariantMutator) => task.variant('bug').create(crash),
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Insert tasks',
          'n2 Insert task_comments <- PayloadData n1 (id->task_id)',
          'result: n2',
        ].join('\n'),
      );
      expect(insertedRows(graph, 'tasks')).toEqual([crashRow]);
    });

    it('inserts the row with the discriminator and writes its key with an Update in update()', () => {
      const graph = updateOf('TaskComment', {
        task: (task: VariantMutator) => task.variant('bug').create(crash),
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Find task_comments where id = 1',
          'n2 Insert tasks <- Requires n1',
          'n3 Update task_comments set nothing where id = 1 <- PayloadData n2 (id->task_id)',
          'result: n3',
        ].join('\n'),
      );
      expect(insertedRows(graph, 'tasks')).toEqual([crashRow]);
    });
  });

  describe('on a relation through a junction', () => {
    it('inserts each row with the discriminator and links it in create()', () => {
      const graph = createOf('Label', {
        name: 'ui',
        tasks: (tasks: VariantMutator) => tasks.variant('bug').create([crash, hang]),
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Insert labels',
          'n2 Insert tasks',
          'n3 Insert task_labels <- PayloadData n1 (id->label_id), PayloadData n2 (id->task_id)',
          'n4 Insert tasks',
          'n5 Insert task_labels <- PayloadData n1 (id->label_id), PayloadData n4 (id->task_id)',
          'result: n1',
        ].join('\n'),
      );
      expect(insertedRows(graph, 'tasks')).toEqual([crashRow, hangRow]);
    });

    it('inserts the row with the discriminator and links it in update()', () => {
      const graph = updateOf('Label', {
        tasks: (tasks: VariantMutator) => tasks.variant('bug').create(crash),
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Find labels where id = 1',
          'n2 Insert tasks <- Requires n1',
          'n3 Insert task_labels <- PayloadData n1 (id->label_id), PayloadData n2 (id->task_id)',
          'result: n1',
        ].join('\n'),
      );
      expect(insertedRows(graph, 'tasks')).toEqual([crashRow]);
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
  it('inserts the row with the discriminator, then the rows of a base relation with its key', () => {
    const graph = createOf('Project', {
      id: 1,
      name: 'Launch',
      tasks: (tasks: VariantMutator) =>
        tasks.variant('bug').create({
          ...crash,
          comments: (comments: CommentMutator) => comments.create({ body: 'Seen it' }),
        }),
    });

    expect(printGraph(graph)).toBe(
      [
        'n1 Insert projects_tbl',
        'n2 Insert tasks <- PayloadData n1 (id->project_id)',
        'n3 Insert task_comments <- PayloadData n2 (id->task_id)',
        'result: n1',
      ].join('\n'),
    );
    expect(insertedRows(graph, 'tasks')).toEqual([crashRow]);
    expect(insertedRows(graph, 'task_comments')).toEqual([{ body: 'Seen it' }]);
  });

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

    it('inserts the base row with the key of the parent, then the variant row in update()', () => {
      const graph = updateOf('Project', {
        tasks: (tasks: VariantMutator) => tasks.variant('feature').create(darkMode),
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Find projects_tbl where id = 1',
          'n2 Insert tasks <- PayloadData n1 (id->project_id)',
          'n3 Insert features <- PayloadData n2 (id->id)',
          'result: n1',
        ].join('\n'),
      );
    });

    it('inserts the base row with the key of the parent on a to-one relation', () => {
      const graph = updateOf('Person', {
        pinnedTask: (task: VariantMutator) => task.variant('feature').create(darkMode),
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Find people where id = 1',
          'n2 Insert tasks <- PayloadData n1 (id->reporter_id)',
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

    it('inserts the base and variant rows and writes the base key with an Update in update()', () => {
      const graph = updateOf('TaskComment', {
        task: (task: VariantMutator) => task.variant('feature').create(darkMode),
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Find task_comments where id = 1',
          'n2 Insert tasks <- Requires n1',
          'n3 Insert features <- PayloadData n2 (id->id)',
          'n4 Update task_comments set nothing where id = 1 <- PayloadData n2 (id->task_id)',
          'result: n4',
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

  it('refuses a relation callback in the row with the error of the top-level variant create', () => {
    const row = {
      ...darkMode,
      comments: (comments: CommentMutator) => comments.create({ body: 'Seen it' }),
    };
    const features = new Collection({ runtime: createMockRuntime(), context }, 'Task', {
      namespaceId: 'public',
    }).variant('feature');
    const topLevel = thrownBy(() => {
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
    const nested = thrownBy(() =>
      createOf('Project', {
        id: 1,
        name: 'Launch',
        tasks: (tasks: VariantMutator) => tasks.variant('feature').create(row),
      }),
    );

    expect(topLevel).toMatchObject({ code: 'ORM.FIELD_UNKNOWN' });
    expect(nested).toMatchObject({
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
