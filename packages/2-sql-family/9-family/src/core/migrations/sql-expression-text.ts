/** Keywords that end an expression and continue the statement around it. */
const STATEMENT_KEYWORDS = new Set([
  'FROM',
  'WHERE',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'GROUP',
  'ORDER',
  'HAVING',
  'LIMIT',
  'RETURNING',
  'WINDOW',
]);

/**
 * One way a target's SQL quotes a literal or an identifier. Inside the quote, the closing text
 * written twice stands for itself when `doubledCloseEscapes` is set, and a backslash escapes the
 * next character when `backslashEscapes` is set.
 */
export interface SqlQuote {
  readonly open: string;
  readonly close: string;
  readonly doubledCloseEscapes: boolean;
  readonly backslashEscapes: boolean;
}

/** The quotes a target's SQL knows. Letters in an opening text, such as the `E` of `E'`, match either case. */
export type SqlQuotingRules = readonly SqlQuote[];

const WORD = /[A-Za-z_][A-Za-z0-9_$]*/y;
const DOLLAR_QUOTE = /\$[A-Za-z_]*\$/y;

function quoteAt(text: string, index: number, quoting: SqlQuotingRules): SqlQuote | undefined {
  return quoting.find(
    (quote) =>
      text.slice(index, index + quote.open.length).toUpperCase() === quote.open.toUpperCase(),
  );
}

function endOfQuote(text: string, start: number, quote: SqlQuote): number | undefined {
  let index = start + quote.open.length;
  while (index < text.length) {
    if (quote.backslashEscapes && text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text.startsWith(quote.close, index)) {
      const after = index + quote.close.length;
      if (!quote.doubledCloseEscapes || !text.startsWith(quote.close, after)) return after;
      index = after + quote.close.length;
      continue;
    }
    index += 1;
  }
  return undefined;
}

/**
 * Returns what in `text` could end or extend the statement a migration writes it into, such as the
 * conversion of an `ALTER COLUMN … USING` clause or a column of an `INSERT … SELECT` list, or
 * undefined when it finds nothing. Text inside the quotes of `quoting` may hold anything; outside
 * them the text may not hold a semicolon, a SQL comment, dollar quoting, or, outside parentheses
 * and brackets, a comma or a keyword that would end the expression. `FROM` directly after
 * `DISTINCT`, as in `IS DISTINCT FROM`, belongs to the expression. It checks for these mistakes
 * only; it does not parse the SQL.
 */
export function checkSqlExpressionText(text: string, quoting: SqlQuotingRules): string | undefined {
  const state: ScanState = { index: 0, depth: 0, previousWord: undefined };
  while (state.index < text.length) {
    const problem = scanNext(text, quoting, state);
    if (problem !== undefined) return problem;
  }
  return state.depth === 0 ? undefined : 'parentheses that do not match';
}

interface ScanState {
  index: number;
  depth: number;
  previousWord: string | undefined;
}

function scanNext(text: string, quoting: SqlQuotingRules, state: ScanState): string | undefined {
  const quote = quoteAt(text, state.index, quoting);
  if (quote !== undefined) return skipQuote(text, quote, state);
  const character = text[state.index] ?? '';
  const problem = punctuationProblem(text, state.index, character, state.depth);
  if (problem !== undefined) return problem;
  state.depth = depthAfter(character, state.depth);
  if (state.depth < 0) return 'parentheses that do not match';
  const word = wordAt(text, state.index, character);
  if (word !== undefined) return consumeWord(word, state);
  if (!/\s/.test(character)) state.previousWord = undefined;
  state.index += 1;
  return undefined;
}

function skipQuote(text: string, quote: SqlQuote, state: ScanState): string | undefined {
  const end = endOfQuote(text, state.index, quote);
  if (end === undefined) return 'a quote that is not closed';
  state.index = end;
  state.previousWord = undefined;
  return undefined;
}

function punctuationProblem(
  text: string,
  index: number,
  character: string,
  depth: number,
): string | undefined {
  if (character === ';') return 'a semicolon outside a quoted literal';
  if (text.startsWith('--', index) || text.startsWith('/*', index)) return 'a SQL comment';
  if (character === '$' && matchAt(DOLLAR_QUOTE, text, index) !== undefined) {
    return 'dollar quoting';
  }
  if (character === ',' && depth === 0) return 'a comma outside parentheses';
  return undefined;
}

function depthAfter(character: string, depth: number): number {
  if (character === '(' || character === '[') return depth + 1;
  if (character === ')' || character === ']') return depth - 1;
  return depth;
}

function matchAt(pattern: RegExp, text: string, index: number): string | undefined {
  pattern.lastIndex = index;
  return pattern.exec(text)?.[0];
}

function wordAt(text: string, index: number, character: string): string | undefined {
  return /[A-Za-z_]/.test(character) ? matchAt(WORD, text, index)?.toUpperCase() : undefined;
}

function consumeWord(word: string, state: ScanState): string | undefined {
  if (endsExpression(word, state)) return `the keyword ${word} outside parentheses`;
  state.previousWord = word;
  state.index += word.length;
  return undefined;
}

function endsExpression(word: string, state: ScanState): boolean {
  return (
    state.depth === 0 &&
    STATEMENT_KEYWORDS.has(word) &&
    !(word === 'FROM' && state.previousWord === 'DISTINCT')
  );
}
