import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { dataLossQuestion } from '../../../src/control-api/statements/plan-questions';
import { contractOf } from './statement-fixtures';

const origin = contractOf({ app: { models: { User: { fields: ['email'] } } } });
const destination = contractOf({ app: { models: { User: { fields: ['email'] } } } });
const drop = {
  operationIndex: 0,
  label: 'Drop column age from user',
  subject: { kind: 'storage', name: 'public.user.age' },
} as const;

describe('dataLossQuestion for data no model names', () => {
  it('says no model of a known origin contract stores it', () => {
    const question = dataLossQuestion(drop, {
      origin,
      destination,
      renames: [],
      originKnown: true,
      keepDataByHand: undefined,
    });

    expect({ question: question.question, verbs: question.verbs }).toEqual({
      question:
        'Drop column age from user would lose the data in "public.user.age", which no model of the origin contract stores.',
      verbs: ['delete'],
    });
  });

  it('says the name is a storage name when the origin contract is unknown', () => {
    const question = dataLossQuestion(drop, {
      origin,
      destination,
      renames: [],
      originKnown: false,
      keepDataByHand: undefined,
    });

    expect(question.question).toBe(
      'Drop column age from user would lose the data in "public.user.age", named by its storage name because the origin contract is unknown; --delete loses its rows.',
    );
  });
});

describe('dataLossQuestion verbs', () => {
  const unbound = asNamespaceId('app');
  const destinationWithoutNickname = contractOf({
    app: { models: { User: { fields: ['email'] } } },
  });
  const withNickname = contractOf({ app: { models: { User: { fields: ['email', 'nickname'] } } } });

  const keepByHand = () => 'Rename it by hand first.';

  function questionFor(
    field: string,
    destination: typeof origin,
    keepDataByHand: (() => string) | undefined,
  ) {
    return dataLossQuestion(
      {
        operationIndex: 0,
        label: 'An operation',
        subject: { kind: 'field', namespaceId: unbound, model: 'User', field },
      },
      { origin: withNickname, destination, renames: [], originKnown: true, keepDataByHand },
    );
  }

  function verbsFor(field: string, destination: typeof origin, renamesPlannable: boolean) {
    return questionFor(field, destination, renamesPlannable ? undefined : keepByHand).verbs;
  }

  it('offers rename for a field the destination no longer has', () => {
    expect(verbsFor('nickname', destinationWithoutNickname, true)).toEqual(['rename', 'delete']);
  });

  it('offers only delete for a field that keeps its name, such as one whose type changes', () => {
    expect(verbsFor('email', destinationWithoutNickname, true)).toEqual(['delete']);
  });

  it('offers only delete for a field a rename statement of the plan already renamed', () => {
    const destination = contractOf({ app: { models: { User: { fields: ['email', 'handle'] } } } });
    const question = dataLossQuestion(
      {
        operationIndex: 1,
        label: 'Recreate table User',
        subject: { kind: 'field', namespaceId: unbound, model: 'User', field: 'nickname' },
      },
      {
        origin: withNickname,
        destination,
        renames: [{ verb: 'rename', text: 'User.nickname:User.handle' }],
        originKnown: true,
        keepDataByHand: undefined,
      },
    );
    expect(question.verbs).toEqual(['delete']);
  });

  it('offers only delete where the planner cannot carry out a rename, and says how to keep the data by hand', () => {
    const question = questionFor('nickname', destinationWithoutNickname, keepByHand);
    expect({ verbs: question.verbs, question: question.question }).toEqual({
      verbs: ['delete'],
      question:
        'An operation would lose the values of field "User.nickname". Rename it by hand first.',
    });
  });

  it('writes the rename form of a field with its model, as a field rename is written', () => {
    expect(questionFor('nickname', destinationWithoutNickname, undefined).forms).toEqual({
      rename: 'User.nickname:User.<new name>',
    });
  });
});
