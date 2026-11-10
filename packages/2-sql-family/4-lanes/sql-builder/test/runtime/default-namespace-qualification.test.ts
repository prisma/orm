import { validateSqlContractFully } from '@internal/sql-contract/validators';
import type { TableSource } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { sql } from '../../src/runtime/sql';
import { contract as contractJson } from '../fixtures/contract';
import type { Contract } from '../fixtures/generated/contract';

/** No target contributes aggregates to these plan-shape cases; resolution answers nothing and the codec slot stays empty. */
const emptyAggregateRegistry = {
  resolve: () => undefined,
  values: function* () {},
};

const sqlContract = validateSqlContractFully<Contract>(contractJson);

const stubBase = {
  operations: {},
  codecs: {},
  queryOperations: { entries: () => ({}) },
  aggregateDescriptors: emptyAggregateRegistry,
  types: {},
  applyMutationDefaults: () => [],
};

const stubInferer = { inferCodec: () => 'pg/text@1' };

function db() {
  return sql({
    context: { ...stubBase, contract: sqlContract } as unknown as ExecutionContext<
      typeof sqlContract
    >,
    rawCodecInferer: stubInferer,
  });
}

describe('namespace-facet table resolution', () => {
  it('stamps the public namespace on TableSource from the namespace facet', () => {
    const ast = db().public.users.buildAst() as TableSource;
    expect(ast.namespaceId).toBe('public');
  });

  it('carries the namespace coordinate through select, insert, update, and delete plans', () => {
    const selectFrom = (db().public.users.select('id').build().ast as { from: TableSource }).from;
    expect(selectFrom.namespaceId).toBe('public');

    const insertTable = (
      db()
        .public.users.insert([{ id: 1, email: 'a@example.com', name: 'Ann' }])
        .build().ast as { table: TableSource }
    ).table;
    expect(insertTable.namespaceId).toBe('public');

    const updateTable = (
      db().public.users.update({ name: 'Bob' }).build().ast as { table: TableSource }
    ).table;
    expect(updateTable.namespaceId).toBe('public');

    const deleteTable = (
      db()
        .public.users.delete()
        .where((f, fns) => fns.eq(f.id, 1))
        .build().ast as { table: TableSource }
    ).table;
    expect(deleteTable.namespaceId).toBe('public');
  });
});
