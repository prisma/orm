import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { dataLossQuestion } from '../../../src/control-api/statements/plan-questions';
import { contractOf } from './statement-fixtures';

const app = asNamespaceId('app');

function verbsForDropped(subject: Parameters<typeof dataLossQuestion>[0]['subject']) {
  return dataLossQuestion(
    { operationIndex: 0, label: 'An operation', subject, loss: 'drop' },
    {
      origin: contractOf({
        app: { models: { constructor: { fields: ['email'] } }, enums: { toString: ['A', 'B'] } },
      }),
      destination: contractOf({
        app: { models: { User: { fields: ['email'] } }, enums: { Role: ['X'] } },
      }),
      statements: [],
      canConvert: true,
      originKnown: true,
      temporaryValues: [],
    },
  ).verbs;
}

describe('a dropped model or enum named like a property every object has', () => {
  it('is absent from a destination that has no such model, so it can be renamed', () => {
    expect(verbsForDropped({ kind: 'model', namespaceId: app, model: 'constructor' })).toEqual([
      'rename',
      'delete',
    ]);
  });

  it('is absent from a destination that has no such enum, so its value can be renamed', () => {
    expect(
      verbsForDropped({ kind: 'enumValue', namespaceId: app, enum: 'toString', member: 'A' }),
    ).toEqual(['rename', 'delete']);
  });
});
