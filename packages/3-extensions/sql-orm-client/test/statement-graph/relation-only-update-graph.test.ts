import { int4Column } from '@internal/adapter-postgres/column-types';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { parseMutationInput } from '../../src/relation-mutations';
import { updateFirstGraph } from '../../src/statement-graph/collection-graphs';
import type { NodeId } from '../../src/statement-graph/edge';
import { Find } from '../../src/statement-graph/find';
import type { Graph } from '../../src/statement-graph/graph';
import { baseContract, relatedCollectionOf, withoutCapabilityKeys } from '../collection-fixtures';
import { defineContract, field, model, rel } from '../contract-builder';
import type { Contract as PolyContract } from '../fixtures/polymorphism/generated/contract';
import polyContractJson from '../fixtures/polymorphism/generated/contract.json' with {
  type: 'json',
};
import { buildTestContextFromContract, createMockRuntime, getTestContext } from '../helpers';
import { printGraph } from './print-graph';

interface Mutator {
  where(filter: object): Mutator;
  variant(value: string): Mutator;
  create(data: object | readonly object[]): unknown;
  connect(criterion: object): unknown;
  disconnect(criteria?: readonly object[]): unknown;
  update(data: object): unknown;
  updateAll(data: object): unknown;
  delete(): unknown;
  deleteAll(): unknown;
}
type TestContext = ExecutionContext<Contract<SqlStorage>>;

const perRelation = ['outerReferencesInDerivedTables', 'jsonAggWithoutTruncation'];

const contexts: readonly (readonly [string, TestContext])[] = [
  ['with returning', getTestContext()],
  [
    'without returning',
    { ...getTestContext(), contract: withoutCapabilityKeys(baseContract, ['returning']) },
  ],
];

const AccountBase = model('Account', {
  fields: {
    id: field.column(int4Column).id(),
    addressId: field.column(int4Column).column('address_id').optional(),
  },
}).sql({ table: 'accounts' });

const Address = model('Address', {
  fields: {
    id: field.column(int4Column).id(),
    accountId: field.column(int4Column).column('account_id'),
  },
  relations: { account: rel.belongsTo(AccountBase, { from: 'accountId', to: 'id' }) },
}).sql({ table: 'addresses' });

const Account = AccountBase.relations({
  address: rel
    .belongsTo(Address, { from: 'addressId', to: 'id' })
    .sql({ fk: { onDelete: 'setNull', onUpdate: 'restrict' } }),
  addresses: rel.hasMany(() => Address, { by: 'accountId' }),
}).sql({ table: 'accounts' });

const accountsContext: TestContext = buildTestContextFromContract(
  defineContract({ models: { Account, Address } }),
);

const polyContext: TestContext = buildTestContextFromContract(
  new PostgresContractSerializer().deserializeContract<PolyContract>(polyContractJson),
);

function updateGraphOf(
  context: TestContext,
  modelName: string,
  data: Record<string, unknown>,
  include?: string,
): Graph {
  const collection = new Collection({ runtime: createMockRuntime(), context }, modelName, {
    namespaceId: 'public',
  }).where({ id: 1 });
  const state =
    include === undefined ? collection.state : collection.include(include as never).state;
  const parsed = parseMutationInput(
    context.contract,
    'public',
    modelName,
    data as never,
    relatedCollectionOf(context),
  );
  return updateFirstGraph(
    { context, state, modelName, namespaceId: 'public' },
    {},
    parsed.relationMutations,
  );
}

function updateOf(
  context: TestContext,
  modelName: string,
  data: Record<string, unknown>,
  include?: string,
): string {
  return printGraph(updateGraphOf(context, modelName, data, include));
}

function joinedTables(graph: Graph, id: NodeId | undefined): readonly string[] {
  const node = id === undefined ? undefined : graph.nodeAt(id);
  return node instanceof Find
    ? (node.ast.joins ?? []).flatMap(({ source }) =>
        source.kind === 'table-source' ? [source.name] : [],
      )
    : [];
}

function readBackOfFirstFind(printed: string): string | undefined {
  const lines = printed.split('\n');
  const result = lines.at(-1)?.replace('result: ', '');
  return lines.find((line) => line.startsWith(`${result} `));
}

describe.each(contexts)('an update() that sets none of the record fields, %s', (_, context) => {
  it('returns the Find of the record when no statement writes its table', () => {
    expect(
      updateOf(context, 'User', {
        posts: (posts: Mutator) => posts.create([{ id: 10, title: 'a', views: 1 }]),
      }),
    ).toBe(
      [
        'n1 Find users where id = 1',
        'n2 Insert posts <- PayloadData n1 (id->user_id)',
        'result: n1',
      ].join('\n'),
    );
  });

  it('reads the record back with its includes in one statement', () => {
    expect(
      updateOf(context, 'User', { posts: (posts: Mutator) => posts.connect({ id: 10 }) }, 'posts'),
    ).toBe(
      [
        'n1 Find users where id = 1',
        'n2 Update posts set nothing where id = 10 <- PayloadData n1 (id->user_id)',
        'n3 Find users <- FilterData n1 (id->id)',
        'result: n3',
      ].join('\n'),
    );
  });

  it('reads the record back after a delete of the row it holds the key of', () => {
    expect(
      readBackOfFirstFind(
        updateOf(context, 'User', {
          invitedBy: (inviter: Mutator) => inviter.delete(),
        }),
      ),
    ).toMatch(/^n\d+ Find users <- FilterData n1 \(id->id\)$/);
  });

  it('reads the record back after a disconnect with criteria of the row it holds the key of', () => {
    expect(
      readBackOfFirstFind(
        updateOf(context, 'User', {
          invitedBy: (inviter: Mutator) => inviter.disconnect([{ id: 2 }]),
        }),
      ),
    ).toMatch(/^n\d+ Find users <- FilterData n1 \(id->id\)$/);
  });

  it.each([
    ['create', (invited: Mutator) => invited.create([{ id: 10, name: 'Bob', email: 'b@c.d' }])],
    ['connect', (invited: Mutator) => invited.connect({ id: 10 })],
    ['disconnect', (invited: Mutator) => invited.disconnect([{ id: 10 }])],
    ['update', (invited: Mutator) => invited.where({ id: 10 }).update({ name: 'Bob' })],
    ['updateAll', (invited: Mutator) => invited.where({ id: 10 }).updateAll({ name: 'Bob' })],
    ['delete', (invited: Mutator) => invited.where({ id: 10 }).delete()],
    ['deleteAll', (invited: Mutator) => invited.where({ id: 10 }).deleteAll()],
  ])(
    'reads the record back after a nested %s on a relation of the model to itself',
    (_op, write) => {
      expect(readBackOfFirstFind(updateOf(context, 'User', { invitedUsers: write }))).toMatch(
        /^n\d+ Find users <- FilterData n1 \(id->id\)$/,
      );
    },
  );
});

describe('an update() that sets none of the record fields, with includes one query per relation', () => {
  const context: TestContext = {
    ...getTestContext(),
    contract: withoutCapabilityKeys(baseContract, perRelation),
  };

  it('reads the includes from the Find of the record after the nested writes', () => {
    expect(
      updateOf(context, 'User', { posts: (posts: Mutator) => posts.connect({ id: 10 }) }, 'posts'),
    ).toBe(
      [
        'n1 Find users where id = 1',
        'n2 Update posts set nothing where id = 10 <- PayloadData n1 (id->user_id)',
        'n3 FindRelated posts by (id) <- Rows n1',
        'n4 NestJoin posts <- WholeRows n1, WholeRows n3',
        'result: n4',
      ].join('\n'),
    );
  });
});

describe('an update() that sets none of the record fields, on a table a declared foreign-key action changes', () => {
  it('reads the record back after a delete whose action sets its key to null', () => {
    expect(
      readBackOfFirstFind(
        updateOf(accountsContext, 'Account', {
          addresses: (addresses: Mutator) => addresses.where({ id: 2 }).delete(),
        }),
      ),
    ).toMatch(/^n\d+ Find accounts <- FilterData n1 \(id->id\)$/);
  });

  it('returns the Find of the record after a write no declared action carries to its table', () => {
    expect(
      updateOf(accountsContext, 'Account', {
        addresses: (addresses: Mutator) => addresses.create({ id: 2 }),
      }),
    ).toBe(
      [
        'n1 Find accounts where id = 1',
        'n2 Insert addresses <- PayloadData n1 (id->account_id)',
        'result: n1',
      ].join('\n'),
    );
  });
});

describe('an update() that sets none of the record fields, on a base model with a variant in its own table', () => {
  it('reads the record back with the variant joins', () => {
    const graph = updateGraphOf(polyContext, 'Task', {
      comments: (comments: Mutator) => comments.create({ body: 'Seen it' }),
    });

    expect(joinedTables(graph, graph.result)).toEqual(['epics', 'features']);
    expect(printGraph(graph)).toBe(
      [
        'n1 Find tasks where id = 1',
        'n2 Insert task_comments <- PayloadData n1 (id->task_id)',
        'n3 Find tasks <- FilterData n1 (id->id)',
        'result: n3',
      ].join('\n'),
    );
  });
});

describe('an update() that sets none of the record fields, with a variant disconnect on a relation it holds the key for', () => {
  it('reads the record back after the conditional unlink', () => {
    expect(
      updateOf(polyContext, 'TaskComment', {
        task: (task: Mutator) => task.variant('bug').disconnect(),
      }),
    ).toBe(
      [
        'n1 Find task_comments where id = 1',
        "n2 Update task_comments set task_id = null where task_id in (select id from tasks where type = 'bug') <- FilterData n1 (id->id)",
        'n3 Find task_comments <- FilterData n1 (id->id)',
        'result: n3',
      ].join('\n'),
    );
  });
});
