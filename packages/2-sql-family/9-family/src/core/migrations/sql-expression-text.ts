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
  let depth = 0;
  let index = 0;
  let previousWord: string | undefined;
  while (index < text.length) {
    const character = text[index] ?? '';
    const quote = quoteAt(text, index, quoting);
    if (quote !== undefined) {
      const end = endOfQuote(text, index, quote);
      if (end === undefined) return 'a quote that is not closed';
      index = end;
      previousWord = undefined;
      continue;
    }
    if (character === ';') return 'a semicolon outside a quoted literal';
    if (text.startsWith('--', index) || text.startsWith('/*', index)) return 'a SQL comment';
    DOLLAR_QUOTE.lastIndex = index;
    if (character === '$' && DOLLAR_QUOTE.test(text)) return 'dollar quoting';
    if (character === ',' && depth === 0) return 'a comma outside parentheses';
    if (character === '(' || character === '[') depth += 1;
    if (character === ')' || character === ']') {
      depth -= 1;
      if (depth < 0) return 'parentheses that do not match';
    }
    WORD.lastIndex = index;
    const word = /[A-Za-z_]/.test(character) ? WORD.exec(text)?.[0].toUpperCase() : undefined;
    if (word !== undefined) {
      if (
        depth === 0 &&
        STATEMENT_KEYWORDS.has(word) &&
        !(word === 'FROM' && previousWord === 'DISTINCT')
      ) {
        return `the keyword ${word} outside parentheses`;
      }
      previousWord = word;
      index += word.length;
      continue;
    }
    if (!/\s/.test(character)) previousWord = undefined;
    index += 1;
  }
  return depth === 0 ? undefined : 'parentheses that do not match';
}
