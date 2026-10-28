import { describe, expect, it } from 'vitest';
import {
  resolveStatements,
  type StatementOrigin,
} from '../../../src/control-api/statements/resolve-statements';
import {
  isStatementVerb,
  type StatementText,
} from '../../../src/control-api/statements/statement-text';
import { errorStatementNeedsMigrationFile } from '../../../src/utils/cli-errors';
import { contractOf, expectFailure, expectValue } from './statement-fixtures';

const UNRESOLVED = 'MIGRATION.STATEMENT_UNRESOLVED';
const INVALID = 'MIGRATION.STATEMENT_INVALID';

const int = { codecId: 'test/int@1' };
const optional = { nullable: true };

const origin = contractOf({
  app: {
    models: {
      User: {
        fields: ['id', 'age', 'bio', 'email'],
        relations: ['posts'],
        fieldTypes: { bio: optional },
      },
    },
  },
});
const destination = contractOf({
  app: {
    models: {
      User: {
        fields: ['id', 'age', 'bio', 'email', 'handle', 'nickname'],
        relations: ['posts'],
        fieldTypes: { age: int, nickname: optional },
      },
      Post: { fields: ['id', 'title'] },
    },
  },
});

const missingOrigin: StatementOrigin = {
  kind: 'missing',
  hash: 'sha256:abc',
  snapshotDirectory: 'migrations/snapshots',
  unreadable: undefined,
};

const convert = (text: string): StatementText => ({ verb: 'convert', text });
const backfill = (text: string): StatementText => ({ verb: 'backfill', text });
const rename = (text: string): StatementText => ({ verb: 'rename', text });

function resolve(
  statements: readonly StatementText[],
  from: ReturnType<typeof contractOf> = origin,
  to: ReturnType<typeof contractOf> = destination,
) {
  return resolveStatements({
    statements,
    origin: { kind: 'contract', contract: from },
    destination: to,
  });
}

const userField = (field: string) => ({ namespaceId: 'app', model: 'User', field });

describe('resolveStatements, convert statements', () => {
  it('resolves a field whose type changes to the field as the destination names it', () => {
    const converted = [{ kind: 'convert', entity: 'field', field: userField('age') }];
    expect([
      expectValue(resolve([convert('User.age')])),
      expectValue(resolve([convert('app.User.age')])),
    ]).toEqual([converted, converted]);
  });

  it('names a renamed field by its new name, whatever order the statements are given in', () => {
    const from = contractOf({ app: { models: { User: { fields: ['age'] } } } });
    const to = contractOf({
      app: { models: { User: { fields: ['years'], fieldTypes: { years: int } } } },
    });
    const renamed = {
      kind: 'rename',
      entity: 'field',
      from: userField('age'),
      to: userField('years'),
    };
    const converted = { kind: 'convert', entity: 'field', field: userField('years') };

    expect([
      expectValue(resolve([rename('User.age:User.years'), convert('User.years')], from, to)),
      expectValue(resolve([convert('User.years'), rename('User.age:User.years')], from, to)),
    ]).toEqual([
      [renamed, converted],
      [converted, renamed],
    ]);
  });

  it('refuses the old name of a renamed field, which the destination does not have', () => {
    const from = contractOf({ app: { models: { User: { fields: ['age'] } } } });
    const to = contractOf({
      app: { models: { User: { fields: ['years'], fieldTypes: { years: int } } } },
    });
    expectFailure(
      resolve([rename('User.age:User.years'), convert('User.age')], from, to),
      UNRESOLVED,
      'The destination model "User" has no field "age" (fields: years)',
      'as the destination contract names it',
    );
  });

  it('refuses a field whose type does not change, naming the type', () => {
    expectFailure(
      resolve([convert('User.email')]),
      UNRESOLVED,
      'Cannot resolve statement "--convert User.email"',
      'has the same type, test/text@1, in the origin and destination contracts',
      'Leave out --convert User.email.',
    );
  });

  it('refuses a value-object field whose type does not change, naming the value object', () => {
    const withAddress = contractOf({
      app: {
        models: {
          User: { fields: ['id', 'home'], fieldTypes: { home: { valueObject: 'Address' } } },
        },
        valueObjects: { Address: ['city'] },
      },
    });
    expectFailure(
      resolveStatements({
        statements: [convert('User.home')],
        origin: { kind: 'contract', contract: withAddress },
        destination: withAddress,
      }),
      UNRESOLVED,
      'has the same type, Address, in the origin and destination contracts',
    );
  });

  it('refuses a field the origin does not have and no rename gives it', () => {
    expectFailure(
      resolve([convert('User.handle')]),
      UNRESOLVED,
      'The origin model "User" has no field "handle" (fields: age, bio, email, id, posts), and no rename statement renames a field to it',
      'If the field was renamed, add --rename User.<old name>:User.handle',
    );
  });

  it('says to leave out the statement as the user wrote it', () => {
    const from = contractOf({ app: { models: { User: { fields: ['id'] } } } });
    const to = contractOf({
      app: { models: { User: { fields: ['id', 'Years'], fieldTypes: { Years: int } } } },
    });
    const failure = expectFailure(resolve([convert('User.Years')], from, to), UNRESOLVED);
    expect(failure.fix).toBe(
      'If the field was renamed, add --rename User.<old name>:User.Years. A new field has no values to convert, so leave out --convert User.Years.',
    );
  });

  it('gives a field statement its own advice when the model or namespace is unknown', () => {
    const advice =
      'A --convert statement names a field as the destination contract names it, Model.field or namespace.Model.field. Names match exactly, including case.';
    const unknownModel = expectFailure(
      resolve([convert('Ghost.x')]),
      UNRESOLVED,
      'The destination contract has no model "Ghost"',
    );
    const unknownNamespace = expectFailure(
      resolve([convert('billing.User.years')]),
      UNRESOLVED,
      'The destination contract has no namespace "billing"',
    );
    expect([unknownModel.fix, unknownNamespace.fix]).toEqual([advice, advice]);
  });

  it('refuses a value object without speaking of renames', () => {
    const withValueObject = contractOf({
      app: { models: { User: { fields: ['id'] } }, valueObjects: { Address: ['city'] } },
    });
    const failure = expectFailure(
      resolve([backfill('Address.city')], withValueObject, withValueObject),
      UNRESOLVED,
      '"Address" is a value object; a --backfill statement names a field of a model',
    );
    expect(`${failure.why} ${failure.fix}`).not.toMatch(/rename/i);
  });

  it('refuses a model, a relation and a model the origin does not have', () => {
    expectFailure(resolve([convert('User')]), INVALID, 'Model.field or namespace.Model.field');
    expectFailure(resolve([convert('User.posts')]), UNRESOLVED, '"User.posts" is a relation');
    expectFailure(
      resolve([convert('Post.title')]),
      UNRESOLVED,
      'The destination model "Post" has no counterpart in the origin contract',
    );
  });

  it('refuses a second statement about the same field', () => {
    expectFailure(
      resolve([convert('User.age'), convert('app.User.age')]),
      INVALID,
      'An earlier statement already converts "User.age".',
    );
  });

  it('needs the origin contract', () => {
    expectFailure(
      resolveStatements({
        statements: [convert('User.age')],
        origin: missingOrigin,
        destination,
      }),
      'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
    );
  });
});

describe('resolveStatements, backfill statements', () => {
  it('resolves a required field new on a model the origin has, and an optional field made required', () => {
    expect(expectValue(resolve([backfill('User.handle'), backfill('User.bio')]))).toEqual([
      { kind: 'backfill', entity: 'field', field: userField('handle') },
      { kind: 'backfill', entity: 'field', field: userField('bio') },
    ]);
  });

  it('refuses a field that is optional in the destination', () => {
    expectFailure(
      resolve([backfill('User.nickname')]),
      UNRESOLVED,
      'The field "User.nickname" is optional in the destination contract, so no existing row needs a value',
      'Leave out --backfill User.nickname',
    );
  });

  it('refuses a field that is already required in the origin', () => {
    expectFailure(
      resolve([backfill('User.email')]),
      UNRESOLVED,
      'The field "User.email" is already required in the origin contract, so every existing row has a value',
    );
  });

  it('refuses a field of a model the origin does not have, which has no existing rows', () => {
    expectFailure(
      resolve([backfill('Post.title')]),
      UNRESOLVED,
      'The destination model "Post" has no counterpart in the origin contract',
    );
  });

  it('needs the origin contract', () => {
    expectFailure(
      resolveStatements({
        statements: [backfill('User.handle')],
        origin: missingOrigin,
        destination,
      }),
      'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
    );
  });
});

describe('the migration plan command the db update refusal prints', () => {
  it('resolves, renames included', () => {
    const from = contractOf({ app: { models: { User: { fields: ['age'] } } } });
    const to = contractOf({
      app: { models: { User: { fields: ['years'], fieldTypes: { years: int } } } },
    });
    const [command] = (
      errorStatementNeedsMigrationFile(
        [rename('User.age:User.years'), convert('User.years')],
        undefined,
      ).toEnvelope().nextActions ?? []
    ).flatMap((action) =>
      'command' in action && typeof action.command === 'string' ? [action.command] : [],
    );
    const words = (command ?? '').split(' ').slice(3);
    const statements = words.flatMap((word, index) => {
      const verb = word.slice(2);
      const text = words[index + 1];
      return word.startsWith('--') && isStatementVerb(verb) && text !== undefined
        ? [{ verb, text }]
        : [];
    });

    expect(statements).toEqual([rename('User.age:User.years'), convert('User.years')]);
    expect(resolve(statements, from, to).ok).toBe(true);
  });
});
