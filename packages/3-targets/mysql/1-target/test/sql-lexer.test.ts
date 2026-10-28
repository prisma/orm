import { describe, expect, it } from 'vitest';
import { tokenizeMysqlSql } from '../src/core/sql-lexer';

const placeholders = (sql: string) =>
  tokenizeMysqlSql(sql)
    .filter((token) => token.kind === 'placeholder')
    .map((token) => token.text);

describe('tokenizeMysqlSql', () => {
  it('finds placeholders outside quoted text, backtick identifiers and comments', () => {
    expect(
      placeholders(
        'SELECT ?1, \'a?\\\'?\', "b?""?", `c?``?`, ?2 /* ? */ # ?\n-- ?\n--\x01 ?\n--\x7f?\n?3 -- ?4',
      ),
    ).toEqual(['?1', '?2', '?3', '?4']);
  });

  it('keeps the text around placeholders, so joining the tokens gives the statement back', () => {
    const sql = "SELECT 'x', ?1 FROM t WHERE a = ?";
    expect(
      tokenizeMysqlSql(sql)
        .map((token) => token.text)
        .join(''),
    ).toBe(sql);
  });

  it('gives each comment and each run of whitespace a token of its own', () => {
    expect(tokenizeMysqlSql('LIMIT /* a */ ?1 # b\n')).toEqual([
      { kind: 'word', text: 'LIMIT' },
      { kind: 'whitespace', text: ' ' },
      { kind: 'comment', text: '/* a */' },
      { kind: 'whitespace', text: ' ' },
      { kind: 'placeholder', text: '?1', number: 1 },
      { kind: 'whitespace', text: ' ' },
      { kind: 'comment', text: '# b\n' },
    ]);
  });

  it('reads a word, quoted text and each other character as one token', () => {
    expect(tokenizeMysqlSql("SELECT a_$1, 'x LIMIT' FROM `t`.é\t\n(5)")).toEqual([
      { kind: 'word', text: 'SELECT' },
      { kind: 'whitespace', text: ' ' },
      { kind: 'word', text: 'a_$1' },
      { kind: 'symbol', text: ',' },
      { kind: 'whitespace', text: ' ' },
      { kind: 'quoted', text: "'x LIMIT'" },
      { kind: 'whitespace', text: ' ' },
      { kind: 'word', text: 'FROM' },
      { kind: 'whitespace', text: ' ' },
      { kind: 'quoted', text: '`t`' },
      { kind: 'symbol', text: '.' },
      { kind: 'word', text: 'é' },
      { kind: 'whitespace', text: '\t\n' },
      { kind: 'symbol', text: '(' },
      { kind: 'word', text: '5' },
      { kind: 'symbol', text: ')' },
    ]);
  });

  it('refuses an executable /*! comment, but not an optimizer hint', () => {
    expect(() => tokenizeMysqlSql('SELECT /*!80000 1 */')).toThrow(
      expect.objectContaining({ code: 'RUNTIME.AST_INVALID' }),
    );
    expect(placeholders('SELECT /*+ SET_VAR(a = 1) */ ?1')).toEqual(['?1']);
  });
});

describe('a placeholder token', () => {
  it('carries the number of ?N, and none for a bare ? or a leading zero', () => {
    expect(
      tokenizeMysqlSql('?1 ?12 ? ?01 ?0').flatMap((token) =>
        token.kind === 'placeholder' ? [token.number] : [],
      ),
    ).toEqual([1, 12, undefined, undefined, undefined]);
  });
});
