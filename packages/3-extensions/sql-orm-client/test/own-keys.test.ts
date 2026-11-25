import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { autoincrement } from '@internal/sql-contract-ts/contract-builder';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { createCollectionTables } from '../src/collection-tables';
import { compileSelect } from '../src/query-plan-select';
import { upsertGraph } from '../src/statement-graph/collection-graphs';
import { queryGraph } from '../src/statement-graph/run-graph';
import { emptyState } from '../src/types';
import { defineContract, field, model } from './contract-builder';
import { defineContractWithTables } from './contract-with-tables';
import { buildTestContextFromContract, createMockRuntime } from './helpers';

const Item = model('Item', {
  fields: {
    id: field.column(int4Column).id(),
    constructor: field.column(textColumn),
  },
}).sql({ table: 'items' });

const contract = defineContractWithTables({ Item }, []);

function items() {
  return new Collection(
    { runtime: createMockRuntime(), context: buildTestContextFromContract(contract) },
    'Item',
    { namespaceId: 'public' },
  );
}

describe('a column named like a property every object has', () => {
  it('needs a cursor value when it orders the rows', () => {
    const state = {
      ...items().orderBy((item) =>
        (item.constructor as unknown as NonNullable<typeof item.id>).asc(),
      ).state,
      cursor: {},
    };
    expect(() => compileSelect(contract, 'Item', state)).toThrow(
      'Missing cursor value for orderBy column "constructor"',
    );
  });

  it('is not updated by an upsert that leaves it out of the update, when the row is read back by its create values', async () => {
    const Tag = model('Tag', {
      fields: {
        id: field.column(int4Column).default(autoincrement()).id(),
        label: field.column(textColumn),
        constructor: field.column(textColumn).unique(),
      },
    }).sql({ table: 'tags' });
    const withoutReturning: Contract<SqlStorage> = {
      ...defineContract({ models: { Tag } }),
      capabilities: { sql: { defaultInInsert: true } },
    };
    const context = {
      ...buildTestContextFromContract(withoutReturning),
      contract: withoutReturning,
    };
    const target = {
      context,
      state: emptyState(createCollectionTables(withoutReturning, 'public', 'Tag')),
      modelName: 'Tag',
      namespaceId: 'public',
    };
    const runtime = createMockRuntime();
    const graph = upsertGraph(target, { label: 'a', constructor: 'a' }, { label: 'b' }, [
      'constructor',
    ]);
    const error = await queryGraph(graph, { runtime, context }, target)
      .toArray()
      .catch((caught: unknown) => caught);
    expect({
      refused: isStructuredError(error) && error.code === 'ORM.CAPABILITY_MISSING',
      executed: runtime.executions.length > 0,
    }).toEqual({ refused: false, executed: true });
  });
});
