import { blindCast } from '@internal/utils/casts';

export type TokenKind =
  | 'Ident'
  | 'StringLiteral'
  | 'NumberLiteral'
  | 'At'
  | 'DoubleAt'
  | 'LBrace'
  | 'RBrace'
  | 'LParen'
  | 'RParen'
  | 'LBracket'
  | 'RBracket'
  | 'Equals'
  | 'Question'
  | 'Dot'
  | 'Comma'
  | 'Colon'
  | 'Whitespace'
  | 'Newline'
  | 'Comment'
  | 'Invalid'
  | 'Eof';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

export class Tokenizer {
  readonly #source: string;
  #pos: number;
  readonly #buffer: Token[];

  constructor(source: string) {
    this.#source = source;
    this.#pos = 0;
    this.#buffer = [];
  }

  next(): Token {
    const next = this.#buffer.shift();
    if (next) {
      return next;
    }
    return this.#scanNext();
  }

  peek(offset = 0): Token {
    if (offset > this.#buffer.length) {
      const last = this.#buffer.at(-1);
      if (last?.kind === 'Eof') {
        return last;
      }
    }

    const token = this.#buffer[offset];
    if (token) {
      return token;
    }

    while (this.#buffer.length <= offset) {
      const token = this.#scanNext();
      if (token.kind === 'Eof') {
        return token;
      }
      this.#buffer.push(token);
    }

    return blindCast<
      Token,
      'For a nonnegative integer offset, the loop fills the buffer through that offset or returns EOF'
    >(this.#buffer[offset]);
  }

  #scanNext(): Token {
    const token = scan(this.#source, this.#pos);
    this.#pos += token.text.length;
    return token;
  }
}

function scan(source: string, pos: number): Token {
  if (pos >= source.length) {
    return { kind: 'Eof', text: '' };
  }

  return (
    scanNewline(source, pos) ??
    scanWhitespace(source, pos) ??
    scanComment(source, pos) ??
    scanAt(source, pos) ??
    scanKeywordNumber(source, pos) ??
    scanIdent(source, pos) ??
    scanNumber(source, pos) ??
    scanString(source, pos) ??
    scanPunctuation(source, pos) ?? {
      kind: 'Invalid' as const,
      text: readChar(source, pos),
    }
  );
}

function scanNewline(source: string, pos: number): Token | undefined {
  const ch = source.charAt(pos);
  if (ch !== '\r' && ch !== '\n') return undefined;
  if (ch === '\r' && source.charAt(pos + 1) === '\n') {
    return { kind: 'Newline', text: '\r\n' };
  }
  return { kind: 'Newline', text: ch };
}

function scanWhitespace(source: string, pos: number): Token | undefined {
  const ch = source.charAt(pos);
  if (ch !== ' ' && ch !== '\t') return undefined;
  let end = pos + 1;
  while (end < source.length) {
    const c = source.charAt(end);
    if (c !== ' ' && c !== '\t') break;
    end++;
  }
  return { kind: 'Whitespace', text: source.slice(pos, end) };
}

function scanComment(source: string, pos: number): Token | undefined {
  if (source.charAt(pos) !== '/' || source.charAt(pos + 1) !== '/') return undefined;
  let end = pos + 2;
  while (end < source.length) {
    const c = source.charAt(end);
    if (c === '\n' || c === '\r') break;
    end++;
  }
  return { kind: 'Comment', text: source.slice(pos, end) };
}

function scanAt(source: string, pos: number): Token | undefined {
  if (source.charAt(pos) !== '@') return undefined;
  if (source.charAt(pos + 1) === '@') {
    return { kind: 'DoubleAt', text: '@@' };
  }
  return { kind: 'At', text: '@' };
}

function scanIdent(source: string, pos: number): Token | undefined {
  const ch = readChar(source, pos);
  if (!isIdentStart(ch)) return undefined;
  let end = pos + ch.length;
  while (end < source.length) {
    const c = readChar(source, end);
    if (isIdentPart(c)) {
      end += c.length;
    } else {
      break;
    }
  }
  return { kind: 'Ident', text: source.slice(pos, end) };
}

const KEYWORD_NUMBERS = ['-Infinity', 'Infinity', 'NaN'] as const;

// `NaN`, `Infinity`, and `-Infinity` are numeric literals; they must match
// before `scanIdent` and are word-bounded, so `Infinityx` stays an `Ident`.
function scanKeywordNumber(source: string, pos: number): Token | undefined {
  for (const word of KEYWORD_NUMBERS) {
    if (!source.startsWith(word, pos)) continue;
    const after = readChar(source, pos + word.length);
    if (after !== '' && isIdentPart(after)) return undefined;
    return { kind: 'NumberLiteral', text: word };
  }
  return undefined;
}

function scanNumber(source: string, pos: number): Token | undefined {
  let end = pos;
  if (source.charAt(end) === '-') {
    if (end + 1 >= source.length || !isDigit(source.charAt(end + 1))) return undefined;
    end++;
  } else if (!isDigit(source.charAt(end))) {
    return undefined;
  }
  end++;
  while (end < source.length && isDigit(source.charAt(end))) {
    end++;
  }
  if (source.charAt(end) === '.' && end + 1 < source.length && isDigit(source.charAt(end + 1))) {
    end++;
    while (end < source.length && isDigit(source.charAt(end))) {
      end++;
    }
  }
  return { kind: 'NumberLiteral', text: source.slice(pos, end) };
}

const QUOTES: ReadonlySet<string> = new Set(['"', "'", '`']);

/**
 * A string in any of the three quote styles. A backslash escapes the next
 * character, so it never closes the string. A `"` or `'` string ends at the
 * end of its line when unterminated. A backtick string may span lines; when
 * unterminated it ends before the first later line whose first non-blank
 * character is `}`, so the parser resumes at the block's closing brace, or at
 * the end of the input. That recovery only applies when no later backtick
 * exists: a later backtick closes the string first.
 */
function scanString(source: string, pos: number): Token | undefined {
  const quote = source.charAt(pos);
  if (!QUOTES.has(quote)) return undefined;
  const multiline = quote === '`';
  let end = pos + 1;
  while (end < source.length) {
    const c = source.charAt(end);
    if (c === '\\' && end + 1 < source.length) {
      end += 2;
      continue;
    }
    if (c === quote) {
      end++;
      return { kind: 'StringLiteral', text: source.slice(pos, end) };
    }
    if (!multiline && (c === '\n' || c === '\r')) {
      return { kind: 'StringLiteral', text: source.slice(pos, end) };
    }
    end++;
  }
  const unterminatedEnd = multiline ? unterminatedBacktickStringEnd(source, pos + 1) : end;
  return { kind: 'StringLiteral', text: source.slice(pos, unterminatedEnd) };
}

function unterminatedBacktickStringEnd(source: string, from: number): number {
  let lineStart = nextLineStart(source, from);
  while (lineStart !== undefined) {
    let cursor = lineStart;
    while (source.charAt(cursor) === ' ' || source.charAt(cursor) === '\t') {
      cursor++;
    }
    if (source.charAt(cursor) === '}') return lineStart;
    lineStart = nextLineStart(source, cursor);
  }
  return source.length;
}

/** The offset just past the next `\r\n`, `\r`, or `\n` at or after `from`. */
function nextLineStart(source: string, from: number): number | undefined {
  for (let index = from; index < source.length; index++) {
    const c = source.charAt(index);
    if (c === '\n') return index + 1;
    if (c === '\r') return source.charAt(index + 1) === '\n' ? index + 2 : index + 1;
  }
  return undefined;
}

/**
 * `scanString` emits the same `StringLiteral` kind for well-formed and
 * unterminated strings, so callers ask here to tell them apart.
 *
 * The closing quote is unescaped iff an **even** number of backslashes precede
 * it (each `\\` pair cancels; an odd run leaves the final `\` escaping the
 * quote), so counting the trailing backslash run suffices — no full re-scan:
 *
 * - `"ok"`  → 0 backslashes (even) → terminated
 * - `'a\'`  → 1 backslash  (odd)   → the quote is escaped → unterminated
 * - `"a\\"` → 2 backslashes (even) → escaped `\`, real `"` → terminated
 */
export function isTerminatedStringLiteral(text: string): boolean {
  const quote = text.charAt(0);
  if (!QUOTES.has(quote)) return false;
  if (text.length < 2 || text.charAt(text.length - 1) !== quote) {
    return false;
  }
  let backslashes = 0;
  for (let i = text.length - 2; i >= 1 && text.charAt(i) === '\\'; i--) {
    backslashes++;
  }
  return backslashes % 2 === 0;
}

function scanPunctuation(source: string, pos: number): Token | undefined {
  const kind = PUNCTUATION[source.charAt(pos)];
  if (kind === undefined) return undefined;
  return { kind, text: source.charAt(pos) };
}

function readChar(source: string, pos: number): string {
  const cp = source.codePointAt(pos);
  return cp !== undefined ? String.fromCodePoint(cp) : '';
}

function isIdentStart(ch: string): boolean {
  return /\p{L}/u.test(ch) || ch === '_';
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch) || ch === '-';
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

const PUNCTUATION: Record<string, TokenKind> = {
  '{': 'LBrace',
  '}': 'RBrace',
  '(': 'LParen',
  ')': 'RParen',
  '[': 'LBracket',
  ']': 'RBracket',
  '=': 'Equals',
  '?': 'Question',
  '.': 'Dot',
  ',': 'Comma',
  ':': 'Colon',
};
