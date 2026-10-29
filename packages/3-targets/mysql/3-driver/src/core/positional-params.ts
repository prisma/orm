import { type MysqlPlaceholderToken, tokenizeMysqlSql } from '@internal/target-mysql/sql-utils';
import { structuredError } from '@internal/utils/structured-error';
import { bindValue } from './parameter-values';

function placeholderMismatch(placeholders: readonly string[], values: number): Error {
  return structuredError(
    'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
    `The MySQL statement writes placeholders ${JSON.stringify(placeholders)} for ${values} parameter value(s); write each value as a numbered ?N, or every value as a bare ? in order, and no other placeholder.`,
    {
      why: 'A placeholder that does not match a value binds a value to the wrong place in the statement, or leaves a value unbound.',
      fix: 'Pass values into raw SQL through interpolation rather than writing a `?` in the SQL text.',
      meta: { placeholders, params: values },
    },
  );
}

/** The index into `values` each placeholder takes: `?N` takes value N, and bare `?`s take the values in order. */
export function valueIndexes(
  placeholders: readonly MysqlPlaceholderToken[],
  values: number,
): number[] {
  const texts = placeholders.map((placeholder) => placeholder.text);
  if (texts.every((text) => text === '?')) {
    if (placeholders.length !== values) throw placeholderMismatch(texts, values);
    return placeholders.map((_, index) => index);
  }
  const indexes = placeholders.map((placeholder) => (placeholder.number ?? 0) - 1);
  const valid =
    indexes.every((index) => index >= 0 && index < values) && new Set(indexes).size === values;
  if (!valid) throw placeholderMismatch(texts, values);
  return indexes;
}

/**
 * The statement with each placeholder written as MySQL's positional `?`, and its values in that order. The adapter writes numbered `?N` placeholders, a value written as often as its `?N` appears; the control plane writes bare `?`s, which take the values in order. `tokenizeMysqlSql` reads the statement as MySQL's lexer does, so a `?` inside a quoted string, a backtick identifier or a comment stays text. Refuses a statement that mixes the two forms, or whose placeholders and values do not match.
 */
export function positionalParams(
  sql: string,
  values: readonly unknown[],
): { readonly sql: string; readonly values: unknown[] } {
  const tokens = tokenizeMysqlSql(sql);
  const placeholders = tokens.filter(
    (token): token is MysqlPlaceholderToken => token.kind === 'placeholder',
  );
  const indexes = valueIndexes(placeholders, values.length);
  return {
    sql: tokens.map((token) => (token.kind === 'placeholder' ? '?' : token.text)).join(''),
    values: indexes.map((index) => bindValue(values[index], index)),
  };
}
