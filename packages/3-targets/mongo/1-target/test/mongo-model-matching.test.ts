import { describe, expect, it } from 'vitest';
import {
  destinationModelOf,
  type ModelMatchInput,
  originModelOf,
} from '../src/core/migrations/mongo-statement-planning';
import { contract, type ModelSpec, NS } from './mongo-statement-fixtures';

const at = (model: string) => ({ namespaceId: NS, model });

function match(
  from: Readonly<Record<string, ModelSpec>>,
  to: Readonly<Record<string, ModelSpec>>,
  statements: ModelMatchInput['statements'] = [],
): ModelMatchInput {
  return {
    statements,
    fieldRenames: [],
    fromContract: contract('from', from, { items: {} }),
    contract: contract('to', to, { items: {} }),
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
});
