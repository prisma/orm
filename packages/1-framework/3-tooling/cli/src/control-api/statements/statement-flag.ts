import type { StatementText } from './statement-text';

const SHELL_SAFE = /^[A-Za-z0-9_.:/@%+,-]+$/;

/** The value as a shell passes it through unchanged, single-quoted when needed. */
export function shellQuoted(value: string): string {
  return SHELL_SAFE.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * A statement written as a flag a shell passes through unchanged: the value is single-quoted when
 * it has a character a shell would read, and joined with `=` when it starts with `-`, which a
 * parser would otherwise read as a flag.
 */
export function statementFlag(statement: StatementText): string {
  const value = shellQuoted(statement.text);
  return statement.text.startsWith('-')
    ? `--${statement.verb}=${value}`
    : `--${statement.verb} ${value}`;
}
