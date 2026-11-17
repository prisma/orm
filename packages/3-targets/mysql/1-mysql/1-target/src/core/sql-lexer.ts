import { mysqlError } from './errors';

/** A `?` placeholder with the digits that follow it. `number` is N for a `?N`, and `undefined` for a bare `?` or one with a leading zero. */
export interface MysqlPlaceholderToken {
  readonly kind: 'placeholder';
  readonly text: string;
  readonly number: number | undefined;
}

/**
 * One token of MySQL SQL: a word (a keyword, an unquoted identifier or the digits of a number), a run of whitespace, quoted text (a string or a backtick identifier, quotes included), a comment, a placeholder, or any other single character.
 */
export type MysqlSqlToken =
  | {
      readonly kind: 'word' | 'whitespace' | 'quoted' | 'comment' | 'symbol';
      readonly text: string;
    }
  | MysqlPlaceholderToken;

const NUMBERED_PLACEHOLDER = /^\?([1-9]\d*)$/;

function placeholderToken(text: string): MysqlPlaceholderToken {
  const digits = NUMBERED_PLACEHOLDER.exec(text)?.[1];
  return { kind: 'placeholder', text, number: digits === undefined ? undefined : Number(digits) };
}

/** The index just past the quoted text that opens at `start`, where a doubled quote stays inside and, outside a backtick identifier, a backslash escapes the next character. The session clears `NO_BACKSLASH_ESCAPES` and `ANSI_QUOTES`, so MySQL reads quotes the same way. */
function endOfQuoted(sql: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < sql.length) {
    const char = sql[index];
    if (char === '\\' && quote !== '`') {
      index += 2;
    } else if (char === quote) {
      if (sql[index + 1] !== quote) return index + 1;
      index += 2;
    } else {
      index += 1;
    }
  }
  return sql.length;
}

function endOf(sql: string, start: number, terminator: string): number {
  const end = sql.indexOf(terminator, start);
  return end === -1 ? sql.length : end + terminator.length;
}

/** MySQL opens a `--` comment when the next character is whitespace or a control character, or the text ends: `my_isspace` or `my_iscntrl` in its lexer. */
function opensDashComment(sql: string, index: number): boolean {
  if (!sql.startsWith('--', index)) return false;
  const next = sql.charCodeAt(index + 2);
  return Number.isNaN(next) || next <= 0x20 || next === 0x7f;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

/** A character of an unquoted identifier, keyword or number, as MySQL reads one: a letter, a digit, `$`, `_`, or any character past ASCII. */
function isWordChar(char: string | undefined): boolean {
  if (char === undefined) return false;
  const lower = char.toLowerCase();
  return (
    isDigit(char) ||
    (lower >= 'a' && lower <= 'z') ||
    char === '$' ||
    char === '_' ||
    char >= '\u0080'
  );
}

function isWhitespace(char: string | undefined): boolean {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\r' ||
    char === '\f' ||
    char === '\v'
  );
}

function endOfRun(
  sql: string,
  start: number,
  belongs: (char: string | undefined) => boolean,
): number {
  let end = start;
  while (end < sql.length && belongs(sql[end])) end += 1;
  return end;
}

/**
 * Splits MySQL SQL into tokens as MySQL's lexer reads it: a `?` inside a quoted string, a backtick identifier or a `#`, `--` or block comment is not a placeholder, and a keyword inside one is not a word. Joining the tokens' text gives the SQL back. Refuses an executable `/*!` comment, whose content MySQL runs as SQL and whose strings the comment's closing marker does not end.
 */
export function tokenizeMysqlSql(sql: string): MysqlSqlToken[] {
  const tokens: MysqlSqlToken[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    let kind: MysqlSqlToken['kind'] = 'symbol';
    let end = index + 1;
    if (char === "'" || char === '"' || char === '`') {
      kind = 'quoted';
      end = endOfQuoted(sql, index, char);
    } else if (char === '#' || opensDashComment(sql, index) || sql.startsWith('/*', index)) {
      if (sql.startsWith('/*!', index)) {
        throw mysqlError(
          'RUNTIME.AST_INVALID',
          'A MySQL statement may not contain an executable /*! comment, whose content MySQL runs as SQL',
          { meta: { target: 'mysql', position: index } },
        );
      }
      kind = 'comment';
      end = sql.startsWith('/*', index) ? endOf(sql, index + 2, '*/') : endOf(sql, index, '\n');
    } else if (char === '?') {
      kind = 'placeholder';
      end = endOfRun(sql, end, isDigit);
    } else if (isWhitespace(char)) {
      kind = 'whitespace';
      end = endOfRun(sql, index, isWhitespace);
    } else if (isWordChar(char)) {
      kind = 'word';
      end = endOfRun(sql, index, isWordChar);
    }
    const text = sql.slice(index, end);
    tokens.push(kind === 'placeholder' ? placeholderToken(text) : { kind, text });
    index = end;
  }
  return tokens;
}
