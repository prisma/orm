import type { ProjectionItem } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import {
  buildMixedPolyContract,
  createMockRuntime,
  getTestContext,
  isSelectAst,
  type MockRuntime,
} from './helpers';

interface RuntimeRows {
  toArray(): Promise<Record<string, unknown>[]>;
}

interface RuntimeCollection {
  variant(value: string): RuntimeCollection;
  select(...fields: string[]): RuntimeCollection;
  include(
    relationName: string,
    refine: (collection: RuntimeCollection) => RuntimeCollection,
  ): RuntimeCollection;
  all(): RuntimeRows;
}

function createVariantTaskCollection(): {
  readonly tasks: RuntimeCollection;
  readonly runtime: MockRuntime;
} {
  const contract = buildMixedPolyContract();
  const context = { ...getTestContext(), contract };
  const runtime = createMockRuntime();
  const collection = new Collection({ runtime, context }, 'Task', { namespaceId: 'public' });
  return { tasks: collection as unknown as RuntimeCollection, runtime };
}

function selectedTaskWithAssignee(tasks: RuntimeCollection, variantValue: string): RuntimeRows {
  return tasks
    .variant(variantValue)
    .select('id', 'title', 'type')
    .include('assignee', (assignee) => assignee.select('id', 'name'))
    .all();
}

function projectionAliases(runtime: MockRuntime): string[] {
  const ast = runtime.executions[0]?.plan.ast;
  expect(isSelectAst(ast)).toBe(true);
  if (!isSelectAst(ast)) {
    throw new Error('Expected variant include dispatch to execute a select plan');
  }
  return ast.projection.map((item: ProjectionItem) => item.alias);
}

describe('variant-owned include dispatch', () => {
  it('maps an explicitly selected MTI result without leaking internal relation columns', async () => {
    const { tasks, runtime } = createVariantTaskCollection();
    runtime.setNextResults([
      [
        {
          id: 2,
          title: 'Dark mode',
          type: 'feature',
          assignee: '[{"id":42,"name":"Ada"}]',
        },
      ],
    ]);

    const rows = await selectedTaskWithAssignee(tasks, 'feature').toArray();

    expect(rows).toEqual([
      {
        id: 2,
        title: 'Dark mode',
        type: 'feature',
        assignee: { id: 42, name: 'Ada' },
      },
    ]);
    expect(projectionAliases(runtime)).toEqual(['id', 'title', 'type', 'assignee']);
  });

  it('maps the whole STI result without projecting an unselected variant join key', async () => {
    const { tasks, runtime } = createVariantTaskCollection();
    runtime.setNextResults([
      [
        {
          id: 1,
          title: 'Crash',
          type: 'bug',
          assignee: '[{"id":11,"name":"Grace"}]',
        },
      ],
    ]);

    const rows = await selectedTaskWithAssignee(tasks, 'bug').toArray();

    expect(rows).toEqual([
      {
        id: 1,
        title: 'Crash',
        type: 'bug',
        assignee: { id: 11, name: 'Grace' },
      },
    ]);
    expect(projectionAliases(runtime)).toEqual(['id', 'title', 'type', 'assignee']);
  });
});
