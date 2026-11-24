import { describe, expect, it } from 'vitest';
import {
  destinationModelOf,
  type ModelMatchInput,
  originModelOf,
} from '../src/core/migrations/mongo-statement-planning';
import { modelRenamesOf } from '../src/core/migrations/mongo-storage-renames';
import {
  contract,
  type ModelSpec,
  NS,
  plan,
  planned,
  renameModel,
  schemaCollection,
} from './mongo-statement-fixtures';

const at = (model: string) => ({ namespaceId: NS, model });

function match(
  from: Readonly<Record<string, ModelSpec>>,
  to: Readonly<Record<string, ModelSpec>>,
  statements: ModelMatchInput['statements'] = [],
): ModelMatchInput {
  const fromContract = contract('from', from, { items: {} });
  const toContract = contract('to', to, { items: {} });
  return {
    statements,
    models: modelRenamesOf(statements, fromContract, toContract),
    fieldRenames: [],
    fromContract,
    contract: toContract,
    collectionAfterRenames: (collection) => collection,
  };
}

const plain = { collection: 'items', fields: ['_id'] };
const tasks = (variants: Readonly<Record<string, string>>): Record<string, ModelSpec> => ({
  Task: { collection: 'items', fields: ['_id', 'type'], discriminator: 'type', variants },
  ...Object.fromEntries(
    Object.keys(variants).map((name) => [name, { collection: 'items', fields: [], base: 'Task' }]),
  ),
});

describe('destinationModelOf', () => {
  it('pairs no origin model with a new model that two origin models are stored like', () => {
    const input = match({ Note: plain, Task: plain }, { Article: plain });

    expect([destinationModelOf(at('Note'), input), destinationModelOf(at('Task'), input)]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('pairs no origin model by storage with a model a rename statement names', () => {
    const input = match(tasks({ Bug: 'bug', Epic: 'epic' }), tasks({ Saga: 'bug' }), [
      { kind: 'rename', entity: 'model', from: at('Epic'), to: at('Saga') },
    ]);

    expect({
      bug: destinationModelOf(at('Bug'), input),
      epic: destinationModelOf(at('Epic'), input),
      origin: originModelOf(at('Saga'), input),
    }).toEqual({ bug: undefined, epic: at('Saga'), origin: at('Epic') });
  });

  it('pairs a variant renamed without a statement with the only new model stored like it', () => {
    const input = match(tasks({ Bug: 'bug', Epic: 'epic' }), tasks({ Issue: 'bug', Epic: 'epic' }));

    expect([destinationModelOf(at('Bug'), input), originModelOf(at('Issue'), input)]).toEqual([
      at('Issue'),
      at('Bug'),
    ]);
  });

  it('pairs an origin model that a statement renames another model to with nothing, as the collection renames do', () => {
    const input = match({ Note: plain, Task: plain }, { Task: plain }, [
      {
        kind: 'rename',
        entity: 'model',
        from: at('Note'),
        to: at('Task'),
      },
    ]);
    expect({
      note: destinationModelOf(at('Note'), input),
      task: destinationModelOf(at('Task'), input),
      originOfTask: originModelOf(at('Task'), input),
    }).toEqual({ note: at('Task'), task: undefined, originOfTask: at('Note') });
  });
});

describe('a model rename statement onto the name of another origin model', () => {
  it('renames the collection of the renamed model and drops the other, asking about it', () => {
    const from = contract(
      'from',
      {
        User: { collection: 'users', fields: ['_id', 'email'] },
        Account: { collection: 'accounts', fields: ['_id', 'name'] },
      },
      { users: {}, accounts: {} },
    );
    const to = contract(
      'to',
      { Account: { collection: 'people', fields: ['_id', 'email'] } },
      { people: {} },
    );
    expect(
      planned(
        plan({
          from,
          to,
          schema: [schemaCollection('users'), schemaCollection('accounts')],
          statements: [renameModel('User', 'Account')],
        }),
      ),
    ).toEqual({
      labels: ['Rename collection users to people', 'Drop collection accounts'],
      classes: ['widening', 'destructive'],
      applied: [[0]],
      dataLoss: [
        {
          operationIndex: 1,
          subject: { kind: 'model', namespaceId: NS, model: 'Account' },
          loss: 'drop',
          label: 'Drop collection accounts',
        },
      ],
    });
  });
});

describe('a root model paired only by storage', () => {
  it('gets no field rename with no statement: a field whose stored name changes is unset and asked about, as before', () => {
    const from = contract(
      'from',
      { User: { collection: 'users', fields: ['_id', 'nick'], storedAs: { nick: 'n' } } },
      { users: {} },
    );
    const to = contract(
      'to',
      { Member: { collection: 'users', fields: ['_id', 'nick'], storedAs: { nick: 'nn' } } },
      { users: {} },
    );
    expect(planned(plan({ from, to, schema: [schemaCollection('users')] }))).toEqual({
      labels: ['Remove field n from collection users'],
      classes: ['destructive'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 0,
          subject: { kind: 'field', namespaceId: NS, model: 'User', field: 'nick' },
          loss: 'drop',
          label: 'Remove field n from collection users',
        },
      ],
    });
  });

  it('is still refused when its embedded relation changes its stored name, since that refusal renames nothing', () => {
    const embedded = (field: string) =>
      ({ addr: { field, model: 'Address', cardinality: '1:1' } }) as const;
    const from = contract(
      'from',
      {
        Task: { collection: 'tasks', fields: ['_id'], embeds: embedded('a') },
        Address: { owner: 'Task', fields: ['street'] },
      },
      { tasks: {} },
    );
    const to = contract(
      'to',
      {
        Ticket: { collection: 'tasks', fields: ['_id'], embeds: embedded('b') },
        Address: { owner: 'Ticket', fields: ['street'] },
      },
      { tasks: {} },
    );
    expect(plan({ from, to, schema: [schemaCollection('tasks')] })).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename field "a" to "b" in collection "tasks": the field is an embedded relation',
          why: 'The stored name of embedded relation "Task.addr" changes from "a" to "b", and renaming an embedded relation is not supported in this release. Keep the stored name "a" in the contract, then run this command again.',
        },
      ],
    });
  });
});

describe('a variant paired only by storage', () => {
  it('gets the rename of a field whose stored name changes, as its pair is the same documents', () => {
    const from = contract(
      'from',
      {
        Task: {
          collection: 'tasks',
          fields: ['_id', 'type'],
          discriminator: 'type',
          variants: { Bug: 'bug' },
        },
        Bug: { collection: 'tasks', fields: ['sev'], base: 'Task' },
      },
      { tasks: {} },
    );
    const to = contract(
      'to',
      {
        Task: {
          collection: 'tasks',
          fields: ['_id', 'type'],
          discriminator: 'type',
          variants: { Defect: 'bug' },
        },
        Defect: {
          collection: 'tasks',
          fields: ['sev'],
          storedAs: { sev: 'severity' },
          base: 'Task',
        },
      },
      { tasks: {} },
    );
    expect(planned(plan({ from, to, schema: [schemaCollection('tasks')] }))).toEqual({
      labels: ['Rename field sev to severity in collection tasks in documents whose type is "bug"'],
      classes: ['widening'],
      applied: [],
      dataLoss: [],
    });
  });
});
