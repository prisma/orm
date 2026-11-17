import { describe, expect, it } from 'vitest';
import { parseRenameStatement } from '../../../src/control-api/statements/parse-rename';
import { expectFailure, expectValue } from './statement-fixtures';

function rename(text: string) {
  return { verb: 'rename', text } as const;
}

const FORMS = [
  'Write the statement as --rename <old>:<new>, where each side is Model, namespace.Model, Model.field or namespace.Model.field',
  'for example --rename Profile:User for a model or --rename User.name:User.fullName for a field',
];

describe('parseRenameStatement', () => {
  describe('accepted forms', () => {
    it.each([
      ['Profile:User', ['Profile'], ['User']],
      ['auth.Profile:billing.User', ['auth', 'Profile'], ['billing', 'User']],
      ['User.name:User.fullName', ['User', 'name'], ['User', 'fullName']],
      ['auth.User.name:auth.User.fullName', ['auth', 'User', 'name'], ['auth', 'User', 'fullName']],
      ['Profile:auth.User', ['Profile'], ['auth', 'User']],
      ['auth.User.name:User.fullName', ['auth', 'User', 'name'], ['User', 'fullName']],
    ])('splits %s into its two sides', (text, from, to) => {
      expect(expectValue(parseRenameStatement(rename(text)))).toEqual({
        verb: 'rename',
        text,
        from,
        to,
      });
    });

    it('keeps the case of every segment', () => {
      expect(expectValue(parseRenameStatement(rename('user:User')))).toEqual({
        verb: 'rename',
        text: 'user:User',
        from: ['user'],
        to: ['User'],
      });
    });
  });

  describe('malformed statements', () => {
    it.each([
      ['no colon', 'ProfileUser'],
      ['more than one colon', 'Profile:User:Account'],
      ['an empty old side', ':User'],
      ['an empty new side', 'Profile:'],
      ['an empty segment', 'auth..Profile:User'],
      ['a trailing dot', 'Profile.:User'],
      ['more than three segments', 'a.b.c.d:User'],
    ])('rejects %s, quoting the statement and listing the accepted forms', (_case, text) => {
      expectFailure(
        parseRenameStatement(rename(text)),
        'MIGRATION.STATEMENT_INVALID',
        text,
        ...FORMS,
      );
    });

    it.each(['Profile:auth.User.name', 'auth.User.name:Profile'])(
      'rejects %s, a model on one side and a field on the other',
      (text) => {
        expectFailure(
          parseRenameStatement(rename(text)),
          'MIGRATION.STATEMENT_INVALID',
          text,
          'model on one side and a field on the other',
        );
      },
    );

    it.each([
      [
        'Profile:auth.User.name',
        "To rename the model, write --rename Profile:auth.User. To rename a field, write --rename auth.User.<old field>:auth.User.name, naming the field's model as the new contract names it.",
      ],
      [
        'auth.User.name:Profile',
        "To rename the model, write --rename auth.User:Profile. To rename a field, write --rename Profile.name:Profile.<new field>, naming the field's model as the new contract names it.",
      ],
    ])('writes both statements %s may have meant', (text, fix) => {
      expect(
        expectFailure(parseRenameStatement(rename(text)), 'MIGRATION.STATEMENT_INVALID').fix,
      ).toBe(fix);
    });
  });
});
