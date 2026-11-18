import { describe, expect, it } from 'vitest';
import { dbUpdateStatementVerbs } from '../../src/orm/statement-verbs';

describe('the allow statement', () => {
  it('describes access to a model in words every database family shares', () => {
    expect(dbUpdateStatementVerbs.allow.brief).toBe(
      "Let the command change who can read or write a model's data: --allow Model",
    );
  });
});
