import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  consentDescription,
  dataLossQuestion,
} from '../../../src/control-api/statements/plan-questions';
import { contractOf } from './statement-fixtures';

const origin = contractOf({ app: { models: { User: { fields: ['email'] } } } });
const destination = contractOf({ app: { models: { User: { fields: ['email'] } } } });
const drop = {
  operationIndex: 0,
  label: 'Drop column age from user',
  subject: { kind: 'storage', name: 'public.user.age' },
  loss: 'drop',
} as const;

describe('dataLossQuestion for data no model names', () => {
  it('says no model of a known origin contract stores it', () => {
    const question = dataLossQuestion(drop, {
      origin,
      destination,
      statements: [],
      canConvert: true,
      originKnown: true,
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
      statements: [],
      canConvert: true,
      originKnown: false,
    });

    expect(question.question).toBe(
      'Drop column age from user would lose the data in "public.user.age", named by its storage name because the origin contract is unknown; --delete loses that data.',
    );
  });
});

describe('dataLossQuestion verbs', () => {
  const unbound = asNamespaceId('app');
  const destinationWithoutNickname = contractOf({
    app: { models: { User: { fields: ['email'] } } },
  });
  const withNickname = contractOf({ app: { models: { User: { fields: ['email', 'nickname'] } } } });

  function questionFor(field: string, destination: typeof origin) {
    return dataLossQuestion(
      {
        operationIndex: 0,
        label: 'An operation',
        subject: { kind: 'field', namespaceId: unbound, model: 'User', field },
        loss: 'drop',
      },
      {
        origin: withNickname,
        destination,
        statements: [],
        canConvert: true,
        originKnown: true,
      },
    );
  }

  function verbsFor(field: string, destination: typeof origin) {
    return questionFor(field, destination).verbs;
  }

  it('offers rename for a field the destination no longer has', () => {
    expect(verbsFor('nickname', destinationWithoutNickname)).toEqual(['rename', 'delete']);
  });

  it('offers only delete for a field that keeps its name, such as one whose type changes', () => {
    expect(verbsFor('email', destinationWithoutNickname)).toEqual(['delete']);
  });

  it('offers only delete for a field a rename statement of the plan already renamed', () => {
    const destination = contractOf({ app: { models: { User: { fields: ['email', 'handle'] } } } });
    const question = dataLossQuestion(
      {
        operationIndex: 1,
        label: 'Recreate table User',
        subject: { kind: 'field', namespaceId: unbound, model: 'User', field: 'nickname' },
        loss: 'drop',
      },
      {
        origin: withNickname,
        destination,
        statements: [{ verb: 'rename', text: 'User.nickname:User.handle' }],
        canConvert: true,
        originKnown: true,
      },
    );
    expect(question.verbs).toEqual(['delete']);
  });

  it('writes the rename form of a field with its model, as a field rename is written', () => {
    expect(questionFor('nickname', destinationWithoutNickname).forms).toEqual({
      rename: 'User.nickname:User.<new name>',
    });
  });
});

describe('dataLossQuestion for a type change', () => {
  const unbound = asNamespaceId('app');
  const int = { codecId: 'test/int@1' };
  const from = contractOf({ app: { models: { User: { fields: ['age'] } } } });
  const to = contractOf({
    app: { models: { User: { fields: ['age'], fieldTypes: { age: int } } } },
  });
  const renamedTo = contractOf({
    app: { models: { User: { fields: ['years'], fieldTypes: { years: int } } } },
  });
  const ageChange = {
    operationIndex: 0,
    label: 'Alter type of "User"."age" to int4',
    subject: { kind: 'field', namespaceId: unbound, model: 'User', field: 'age' },
    loss: 'typeChange',
  } as const;

  function question(
    canConvert: boolean,
    destination = to,
    statements: readonly { verb: 'rename'; text: string }[] = [],
  ) {
    return dataLossQuestion(ageChange, {
      origin: from,
      destination,
      statements,
      canConvert,
      originKnown: true,
    });
  }

  it('offers convert and delete where the command writes a migration to fill in', () => {
    const asked = question(true);
    expect({ verbs: asked.verbs, forms: asked.forms }).toEqual({
      verbs: ['convert', 'delete'],
      forms: { convert: 'User.age' },
    });
    expect(asked.validate('convert', 'User.age')).toBeUndefined();
  });

  it("says the operation changes the field's type, whatever its label", () => {
    const rebuild = dataLossQuestion(
      { ...ageChange, label: 'Recreate table User' },
      {
        origin: from,
        destination: to,
        statements: [],
        canConvert: true,
        originKnown: true,
      },
    );
    expect(rebuild.question).toBe(
      'Recreate table User would change the type of field "User.age" and can change or lose its values.',
    );
  });

  it('offers only delete where the command has no migration to fill in', () => {
    expect(question(false).verbs).toEqual(['delete']);
  });

  it('names the field to convert as the destination names it after a rename', () => {
    const asked = question(true, renamedTo, [{ verb: 'rename', text: 'User.age:User.years' }]);
    expect({
      subject: asked.subject,
      forms: asked.forms,
      accepted: asked.validate('convert', 'User.years'),
      rejected: asked.validate('convert', 'User.age'),
    }).toEqual({
      subject: 'User.age',
      forms: { convert: 'User.years' },
      accepted: undefined,
      rejected:
        'convert names the field as the destination contract names it: --convert User.years.',
    });
  });
});

describe('dataLossQuestion for a field whose model the destination names differently', () => {
  const app = asNamespaceId('app');
  const profile = contractOf({ app: { models: { Profile: { fields: ['email', 'nickname'] } } } });
  const person = contractOf({ app: { models: { Person: { fields: ['email', 'alias'] } } } });
  const loss = {
    operationIndex: 0,
    label: 'Remove field nickname from collection profiles',
    subject: { kind: 'field', namespaceId: app, model: 'Profile', field: 'nickname' },
    loss: 'drop',
  } as const;

  it('offers only delete, and says to rename the model first', () => {
    const question = dataLossQuestion(loss, {
      origin: profile,
      destination: person,
      statements: [],
      canConvert: true,
      originKnown: true,
    });
    expect({ verbs: question.verbs, question: question.question }).toEqual({
      verbs: ['delete'],
      question:
        'Remove field nickname from collection profiles would lose the values of field "Profile.nickname". The destination contract has no model "Profile"; to keep the values instead, also pass --rename Profile:<new model name>, naming the model that stores them now, and the question then offers to rename the field.',
    });
  });

  it('offers the field rename once the printed model rename is passed, and accepts it', () => {
    const question = dataLossQuestion(loss, {
      origin: profile,
      destination: person,
      statements: [{ verb: 'rename', text: 'Profile:Person' }],
      canConvert: true,
      originKnown: true,
    });
    expect({
      subject: question.subject,
      verbs: question.verbs,
      forms: question.forms,
      accepted: question.validate('rename', 'Person.nickname:Person.alias'),
    }).toEqual({
      subject: 'Person.nickname',
      verbs: ['rename', 'delete'],
      forms: { rename: 'Person.nickname:Person.<new name>' },
      accepted: undefined,
    });
  });
});

describe('consentDescription', () => {
  const age = {
    kind: 'field',
    namespaceId: asNamespaceId('app'),
    model: 'User',
    field: 'age',
  } as const;

  it('says a delete that answers a type change accepts the lossy change, not that it deletes the field', () => {
    expect([
      consentDescription('delete', age, 'User.age', 'typeChange'),
      consentDescription('delete', age, 'User.age', 'drop'),
    ]).toEqual(['accept lossy type change of field "User.age"', 'delete field "User.age"']);
  });
});

describe('dataLossQuestion with advice from the target', () => {
  it('ends the question with how to keep the data, and still offers only delete', () => {
    const app = asNamespaceId('app');
    const users = contractOf({ app: { models: { User: { fields: ['email'] } } } });
    const question = dataLossQuestion(
      {
        operationIndex: 0,
        label: 'Drop storage users',
        subject: { kind: 'model', namespaceId: app, model: 'User' },
        loss: 'drop',
        keepDataAdvice: 'To keep its data, move it by hand.',
      },
      { origin: users, destination: users, statements: [], canConvert: true, originKnown: true },
    );

    expect({ question: question.question, verbs: question.verbs }).toEqual({
      question:
        'Drop storage users would lose the data of model "User". To keep its data, move it by hand.',
      verbs: ['delete'],
    });
  });
});
