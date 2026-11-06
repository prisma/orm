import { type MysqlPlaceholderToken, tokenizeMysqlSql } from '@internal/target-mysql/sql-utils';
import { structuredError } from '@internal/utils/structured-error';

/** Refuses a lowered statement unless every placeholder is a numbered `?N` naming one of its parameters and every parameter has a placeholder. */
export function assertPlaceholdersMatchParams(sql: string, paramCount: number): void {
  const tokens = tokenizeMysqlSql(sql).filter(
    (token): token is MysqlPlaceholderToken => token.kind === 'placeholder',
  );
  const placeholders = tokens.map((token) => token.text);
  const numbers = tokens.map((token) => token.number ?? Number.NaN);
  const matches =
    numbers.every((number) => number >= 1 && number <= paramCount) &&
    new Set(numbers).size === paramCount;
  if (matches) return;
  throw structuredError(
    'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
    `The lowered MySQL statement writes placeholders ${JSON.stringify(placeholders)} for ${paramCount} parameter(s); each parameter must be written as its own numbered placeholder, and no other placeholder may appear.`,
    {
      why: 'A placeholder that does not match a parameter binds a value to the wrong place in the statement, or leaves a value unbound.',
      fix: 'Pass values into raw SQL through interpolation rather than writing a `?` in the SQL text.',
      meta: { placeholders, params: paramCount },
    },
  );
}
