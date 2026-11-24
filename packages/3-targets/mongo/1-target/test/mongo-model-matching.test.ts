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
  it('pairs no root model by storage, even with the only new model stored like it', () => {
    const input = match({ Note: plain }, { Article: plain });
    expect([destinationModelOf(at('Note'), input), originModelOf(at('Article'), input)]).toEqual([
      undefined,
      undefined,
    ]);
  });

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
