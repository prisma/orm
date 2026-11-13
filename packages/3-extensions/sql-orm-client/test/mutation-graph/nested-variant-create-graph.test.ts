import { ParamRef } from '@internal/sql-relational-core/ast';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { createGraph, updateFirstGraph } from '../../src/mutation-graph/collection-graphs';
import type { Graph } from '../../src/mutation-graph/graph';
import { Insert } from '../../src/mutation-graph/insert';
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

const context = buildTestContextFromContract(
  serializer.deserializeContract<PolyContract>(withPinnedTask(polyContractJson)),
);

function relatedCollection() {
  const runtime = createMockRuntime();
  return (relation: { readonly to: string; readonly toNamespace: string }) =>
    new Collection({ runtime, context }, relation.to, { namespaceId: relation.toNamespace });
}

function parsed(modelName: string, data: Record<string, unknown>) {
  return parseMutationInput(
    context.contract,
    'public',
    modelName,
    data as never,
    relatedCollection(),
  );
}

function targetOf(modelName: string) {
  const collection = new Collection({ runtime: createMockRuntime(), context }, modelName, {
    namespaceId: 'public',
  });
  return { context, state: collection.where({ id: 1 }).state, modelName, namespaceId: 'public' };
}

function createOf(modelName: string, data: Record<string, unknown>): Graph {
  const collection = new Collection({ runtime: createMockRuntime(), context }, modelName, {
    namespaceId: 'public',
  });
  return createGraph(
    { context, state: collection.state, modelName, namespaceId: 'public' },
    parsed(modelName, data),
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
          'n1 Find projects_tbl where id = 1 limit 1',
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
          'n1 Find people where id = 1 limit 1',
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
          'n1 Find task_comments where id = 1 limit 1',
          'n2 Insert tasks <- Requires n1',
          'n3 Update task_comments set nothing <- FilterData n1 (id->id), PayloadData n2 (id->task_id)',
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
          'n1 Find labels where id = 1 limit 1',
          'n2 Insert tasks <- Requires n1',
          'n3 Insert task_labels <- PayloadData n1 (id->label_id), PayloadData n2 (id->task_id)',
          'result: n1',
        ].join('\n'),
      );
      expect(insertedRows(graph, 'tasks')).toEqual([crashRow]);
    });
  });
});

describe('a nested create of a variant stored in its own table', () => {
  it('is refused while the graph is built', () => {
    expect(() =>
      createOf('Project', {
        id: 1,
        name: 'Launch',
        tasks: (tasks: VariantMutator) =>
          tasks.variant('feature').create({ title: 'Dark mode', priority: 1 }),
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.OPERATION_UNSUPPORTED',
        meta: {
          kind: 'create',
          relation: 'tasks',
          model: 'Task',
          variant: 'Feature',
          reason: 'mti-variant',
        },
      }),
    );
  });
});
