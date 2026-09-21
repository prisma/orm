import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Token } from '../src/tokenizer';
import { isTerminatedStringLiteral, Tokenizer } from '../src/tokenizer';

const KIND_COLUMN_WIDTH = 15;

function escapeForDebug(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
    .replaceAll('"', '\\"');
}

function debugTokens(tokens: Iterable<Token>): string {
  const lines: string[] = [];
  for (const token of tokens) {
    lines.push(`${token.kind.padEnd(KIND_COLUMN_WIDTH)}"${escapeForDebug(token.text)}"`);
  }
  return lines.join('\n');
}

function collectAll(source: string): Token[] {
  const t = new Tokenizer(source);
  const tokens: Token[] = [];
  let tok: Token;
  do {
    tok = t.next();
    tokens.push(tok);
  } while (tok.kind !== 'Eof');
  return tokens;
}

function tokenize(source: string): string {
  return debugTokens(collectAll(source));
}

function assertLossless(source: string): void {
  const tokens = collectAll(source);
  expect(tokens.map((t) => t.text).join('')).toBe(source);
}

describe('Tokenizer', () => {
  describe('PSL fragments', () => {
    const cases: [string, string][] = [
      ['model with fields and attributes', 'model User {\n  id Int @id\n}'],
      ['optional and array types', 'role Role?\nposts Post[]'],
      ['@relation with named arguments', '@relation(fields: [userId], references: [id])'],
      ['block attribute @@index', '@@index([userId])'],
      ['comment followed by model', '// config\nmodel C {}'],
      ['string default value', '@default("unknown")'],
      ['namespaced attribute with dot', '@extension.VarChar(191)'],
      ['types block with equals', 'Email = String'],
      ['hyphenated attribute namespace', '@my-pack.column'],
      ['unicode identifiers', 'café Ñame 名前'],
      ['astral unicode identifiers', '𐐀𐐁 test'],
    ];

    it.each(cases)('lossless round-trip: %s', (_desc, input) => {
      assertLossless(input);
    });

    it.each(cases)('snapshot: %s', (_desc, input) => {
      expect(tokenize(input)).toMatchSnapshot();
    });
  });

  describe('fixture: realistic schema', () => {
    const fixture = readFileSync(join(__dirname, 'fixtures/schema.psl'), 'utf-8');

    it('lossless round-trip', () => {
      assertLossless(fixture);
    });

    it('token output matches snapshot', () => {
      expect(tokenize(fixture)).toMatchSnapshot();
    });
  });

  describe('edge cases', () => {
    it('handles \\r\\n line endings (lossless)', () => {
      const schema = 'model User {\r\n  id Int\r\n}';
      assertLossless(schema);
      expect(tokenize(schema)).toMatchInlineSnapshot(`
        "Ident          "model"
        Whitespace     " "
        Ident          "User"
        Whitespace     " "
        LBrace         "{"
        Newline        "\\r\\n"
        Whitespace     "  "
        Ident          "id"
        Whitespace     " "
        Ident          "Int"
        Newline        "\\r\\n"
        RBrace         "}"
        Eof            """
      `);
    });

    it('handles number literals and trailing dots', () => {
      expect(tokenize('1.5')).toMatchInlineSnapshot(`
        "NumberLiteral  "1.5"
        Eof            """
      `);
      expect(tokenize('1.')).toMatchInlineSnapshot(`
        "NumberLiteral  "1"
        Dot            "."
        Eof            """
      `);
    });

    it('handles negative number literals', () => {
      expect(tokenize('-1')).toMatchInlineSnapshot(`
        "NumberLiteral  "-1"
        Eof            """
      `);
      expect(tokenize('-3.14')).toMatchInlineSnapshot(`
        "NumberLiteral  "-3.14"
        Eof            """
      `);
      expect(tokenize('@default(-1)')).toMatchInlineSnapshot(`
        "At             "@"
        Ident          "default"
        LParen         "("
        NumberLiteral  "-1"
        RParen         ")"
        Eof            """
      `);
    });

    it('tokenizes NaN / Infinity / -Infinity as number literals', () => {
      expect(tokenize('NaN')).toMatchInlineSnapshot(`
        "NumberLiteral  "NaN"
        Eof            """
      `);
      expect(tokenize('Infinity')).toMatchInlineSnapshot(`
        "NumberLiteral  "Infinity"
        Eof            """
      `);
      expect(tokenize('-Infinity')).toMatchInlineSnapshot(`
        "NumberLiteral  "-Infinity"
        Eof            """
      `);
    });

    it('keeps identifier-continued forms (Infinityx / NaNxyz) as identifiers', () => {
      expect(tokenize('Infinityx')).toMatchInlineSnapshot(`
        "Ident          "Infinityx"
        Eof            """
      `);
      expect(tokenize('NaNxyz')).toMatchInlineSnapshot(`
        "Ident          "NaNxyz"
        Eof            """
      `);
    });

    it('handles string escapes and unterminated strings', () => {
      expect(tokenize('"hello \\"world\\""')).toMatchInlineSnapshot(`
        "StringLiteral  "\\"hello \\\\\\"world\\\\\\"\\""
        Eof            """
      `);
      expect(tokenize('"hello\nworld')).toMatchInlineSnapshot(`
        "StringLiteral  "\\"hello"
        Newline        "\\n"
        Ident          "world"
        Eof            """
      `);
      expect(tokenize('"hello')).toMatchInlineSnapshot(`
        "StringLiteral  "\\"hello"
        Eof            """
      `);
    });

    it('emits single-char Invalid tokens for unknown characters', () => {
      assertLossless('#$%^&');
      expect(tokenize('#$%^&')).toMatchInlineSnapshot(`
        "Invalid        "#"
        Invalid        "$"
        Invalid        "%"
        Invalid        "^"
        Invalid        "&"
        Eof            """
      `);
    });

    it('resumes known tokens after Invalid', () => {
      assertLossless('#$model');
      expect(tokenize('#$model')).toMatchInlineSnapshot(`
        "Invalid        "#"
        Invalid        "$"
        Ident          "model"
        Eof            """
      `);
    });

    it('handles lone / and ! as Invalid', () => {
      expect(tokenize('!/')).toMatchInlineSnapshot(`
        "Invalid        "!"
        Invalid        "/"
        Eof            """
      `);
    });

    it('never throws on pathological input', () => {
      const nasty = '!@#$%^&*(){}[]<>~`|\\;\'"/?.,\x00\x01\x02';
      assertLossless(nasty);
      expect(() => tokenize(nasty)).not.toThrow();
    });
  });

  describe('cursor API', () => {
    it('peek(0) returns the same token as a subsequent next()', () => {
      const t = new Tokenizer('model User');
      const peeked = t.peek(0);
      const consumed = t.next();
      expect(peeked).toEqual(consumed);
    });

    it('peek(1) returns the token after the next one', () => {
      const t = new Tokenizer('model User');
      const peekOne = t.peek(1);
      t.next(); // consume 'model'
      const second = t.next(); // consume ' '
      expect(peekOne).toEqual(second);
    });

    it('reuses buffered lookahead after consuming an earlier token', () => {
      const t = new Tokenizer('model User');
      const peeked = t.peek(2);
      expect(peeked).toEqual({ kind: 'Ident', text: 'User' });
      expect(t.peek(2)).toBe(peeked);
      expect(t.next()).toEqual({ kind: 'Ident', text: 'model' });
      expect(t.peek(1)).toBe(peeked);
      expect(t.next()).toEqual({ kind: 'Whitespace', text: ' ' });
      expect(t.next()).toBe(peeked);
    });

    it('returns Eof beyond available lookahead without consuming buffered tokens', () => {
      const t = new Tokenizer('a b');
      expect(t.peek(10)).toEqual({ kind: 'Eof', text: '' });
      expect(t.peek(3)).toEqual({ kind: 'Eof', text: '' });
      expect(t.next()).toEqual({ kind: 'Ident', text: 'a' });
      expect(t.next()).toEqual({ kind: 'Whitespace', text: ' ' });
      expect(t.next()).toEqual({ kind: 'Ident', text: 'b' });
      expect(t.peek(10)).toEqual({ kind: 'Eof', text: '' });
    });

    it('returns Eof indefinitely after source is exhausted', () => {
      const t = new Tokenizer('a');
      expect(t.next().kind).toBe('Ident');
      expect(t.next().kind).toBe('Eof');
      expect(t.next().kind).toBe('Eof');
      expect(t.next().kind).toBe('Eof');
    });

    it('peek(0) returns Eof after Eof has been consumed', () => {
      const t = new Tokenizer('a');
      t.next(); // 'a'
      t.next(); // Eof
      expect(t.peek(0).kind).toBe('Eof');
    });
  });
});

describe('backtick strings', () => {
  it('scans a backtick string as a StringLiteral token, quotes included', () => {
    expect(tokenize('sql`gen_random_uuid()`')).toMatchInlineSnapshot(`
      "Ident          "sql"
      StringLiteral  "\`gen_random_uuid()\`"
      Eof            """
    `);
  });

  it('spans multiple lines', () => {
    const source = 'sql`\n  now()\n`';
    assertLossless(source);
    expect(tokenize(source)).toMatchInlineSnapshot(`
      "Ident          "sql"
      StringLiteral  "\`\\n  now()\\n\`"
      Eof            """
    `);
  });

  it('treats a backslash-escaped backtick as part of the string', () => {
    expect(tokenize('`a\\`b`')).toMatchInlineSnapshot(`
      "StringLiteral  "\`a\\\\\`b\`"
      Eof            """
    `);
  });

  it('lets an escaped backslash precede the closing backtick', () => {
    expect(tokenize('`a\\\\` x')).toMatchInlineSnapshot(`
      "StringLiteral  "\`a\\\\\\\\\`"
      Whitespace     " "
      Ident          "x"
      Eof            """
    `);
  });

  it('keeps an unterminated backtick string to the end of the source', () => {
    const source = '`abc\n  more\n';
    assertLossless(source);
    expect(tokenize(source)).toMatchInlineSnapshot(`
      "StringLiteral  "\`abc\\n  more\\n"
      Eof            """
    `);
  });

  it('ends an unterminated backtick string before the first line that opens with a closing brace', () => {
    const source = '`abc\n  more\n  }\nnext';
    assertLossless(source);
    expect(collectAll(source).map((t) => t.kind)).toEqual([
      'StringLiteral',
      'Whitespace',
      'RBrace',
      'Newline',
      'Ident',
      'Eof',
    ]);
    expect(collectAll(source)[0]?.text).toBe('`abc\n  more\n');
  });

  it.each([
    ['CR', '\r'],
    ['CRLF', '\r\n'],
  ])('recognises %s line breaks when ending an unterminated backtick string', (_name, eol) => {
    const source = `\`abc${eol}  more${eol}  }${eol}next`;
    assertLossless(source);
    expect(collectAll(source).map((t) => t.kind)).toEqual([
      'StringLiteral',
      'Whitespace',
      'RBrace',
      'Newline',
      'Ident',
      'Eof',
    ]);
    expect(collectAll(source)[0]?.text).toBe(`\`abc${eol}  more${eol}`);
  });

  it('still ends an unterminated double- or single-quoted string at the newline', () => {
    expect(collectAll('"abc\n}').map((t) => t.kind)).toEqual([
      'StringLiteral',
      'Newline',
      'RBrace',
      'Eof',
    ]);
    expect(collectAll("'abc\n}")[0]?.text).toBe("'abc");
  });

  it('is lossless with a dotted tag, whitespace before the string, and a double-quoted string', () => {
    assertLossless('pg.sql `a` sql"b"');
  });
});

describe('isTerminatedStringLiteral', () => {
  it('treats a literal with a closing quote as terminated', () => {
    expect(isTerminatedStringLiteral('"ok"')).toBe(true);
  });

  it('treats an empty string literal as terminated', () => {
    expect(isTerminatedStringLiteral('""')).toBe(true);
  });

  it('treats a literal with no closing quote as unterminated', () => {
    expect(isTerminatedStringLiteral('"oops')).toBe(false);
  });

  it('treats a trailing escaped quote as not closing the literal', () => {
    expect(isTerminatedStringLiteral('"a\\"')).toBe(false);
  });

  it('treats a real closing quote after an escaped quote as terminated', () => {
    expect(isTerminatedStringLiteral('"a\\""')).toBe(true);
  });

  it.each([
    ["'ok'", true],
    ['`ok`', true],
    ['``', true],
    ['`a\\\\`', true],
    ['`', false],
    ['`oops', false],
    ['`a\\`', false],
    ['"ok\'', false],
  ])('reads %s as terminated: %s', (text, terminated) => {
    expect(isTerminatedStringLiteral(text)).toBe(terminated);
  });
});
