import { asNamespaceId } from '@internal/contract/types';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import {
  askPlanQuestions,
  type PlanAnswer,
} from '../../../src/control-api/statements/plan-questions';
import { contractOf } from './statement-fixtures';

describe('the answers an answerQuestions callback gives', () => {
  it('are refused when a slot is missing from an array of the right length', async () => {
    let calls = 0;
    const result = askPlanQuestions({
      plan: {
        dataLoss: [
          {
            operationIndex: 0,
            label: 'Drop column "ratio" from "T"',
            loss: 'drop',
            subject: {
              kind: 'field',
              namespaceId: asNamespaceId('app'),
              model: 'T',
              field: 'ratio',
            },
          },
        ],
        accessChanges: [],
        temporaryValues: [],
      },
      askAccess: false,
      canConvert: false,
      statements: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin: contractOf({ app: { models: { T: { fields: ['id', 'ratio'] } } } }),
      originKnown: true,
      destination: contractOf({ app: { models: { T: { fields: ['id'] } } } }),
      answer: async () => {
        calls += 1;
        if (calls > 1) throw new Error('asked again');
        return new Array<PlanAnswer | undefined>(1);
      },
      replan: async () => ok({ dataLoss: [], accessChanges: [], temporaryValues: [] }),
    });

    await expect(result).rejects.toThrow(
      'answerQuestions left "Removing field "T.ratio" would delete its values." open, which it may do only beside a rename or convert answer that plans again.',
    );
  });
});
