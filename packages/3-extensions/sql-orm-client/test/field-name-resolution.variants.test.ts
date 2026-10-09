import { textColumn } from '@internal/adapter-postgres/column-types';
import { field } from '@internal/sql-contract-ts/contract-builder';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { mapSelectedFieldsToColumns } from '../src/collection-column-mapping';
import { createModelAccessor } from '../src/model-accessor';
import { orm } from '../src/orm';
import { compileSelect } from '../src/query-plan-select';
import { createCollectionFor } from './collection-fixtures';
import type { Contract as PolyContract } from './fixtures/polymorphism/generated/contract';
import polyContractJson from './fixtures/polymorphism/generated/contract.json' with {
  type: 'json',
};
import {
  buildTestContextFromContract,
  createMockRuntime,
  fieldUnknown,
  getTestContext,
} from './helpers';

const poly = new PostgresContractSerializer().deserializeContract<PolyContract>(polyContractJson);

describe('a select of a field name two variants map to different columns', () => {
  it('reads every such column when the collection is not narrowed', () => {
    expect(mapSelectedFieldsToColumns(poly, 'public', 'Task', undefined, ['assigneeId'])).toEqual([
      'bug_assignee_person_id',
      'feature_assignee_person_id',
    ]);
  });

  it('projects each column on its own table', () => {
    const { collection } = createCollectionFor('User');
    const state = {
      ...collection.state,
      selectedFields: ['id', 'bug_assignee_person_id', 'feature_assignee_person_id'],
    };
    const sql = JSON.stringify(compileSelect(poly, 'public', 'Task', 'tasks', state).ast);
    expect(sql).toContain('"table":"tasks","column":"bug_assignee_person_id"');
    expect(sql).toContain('"table":"features","column":"feature_assignee_person_id"');
  });

  it('reads only the narrowed variant column when the collection is narrowed', () => {
    expect(mapSelectedFieldsToColumns(poly, 'public', 'Task', 'Bug', ['assigneeId'])).toEqual([
      'bug_assignee_person_id',
    ]);
  });
});

describe('a relation shorthand filter', () => {
  it('refuses names the JavaScript runtime probes before reading them through the accessor', () => {
    const user = createModelAccessor(getTestContext(), 'public', 'User') as unknown as Record<
      string,
      { some(predicate: Record<string, unknown>): unknown }
    >;
    expect(() => user['posts']!.some(Object.fromEntries([['then', 1]]))).toThrow(
      fieldUnknown('Post', 'then'),
    );
    expect(() => user['posts']!.some({ toString: 1 })).toThrow(fieldUnknown('Post', 'toString'));
  });
});

describe('a fragment', () => {
  it('applies to a collection of a variant through a field the variant inherits', () => {
    const client = orm({
      runtime: createMockRuntime(),
      context: buildTestContextFromContract(poly),
    });
    const titled = client.fragment({ title: field.column(textColumn) }, (rows) =>
      rows.where((r) => r.title.eq('x')),
    );
    const bugs = new Collection(
      { runtime: createMockRuntime(), context: buildTestContextFromContract(poly) } as never,
      'Bug',
      { namespaceId: 'public' },
    );
    expect(() =>
      blindCast<(c: unknown) => unknown, 'a JavaScript caller'>(titled)(bugs),
    ).not.toThrow();
  });
});
