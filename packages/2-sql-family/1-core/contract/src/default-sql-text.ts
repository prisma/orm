const UNSAFE_DEFAULT_TEXT = /;|--|\/\*|\$\$|\bSELECT\b/i;

/** Returns undefined when the text may be rendered as `DEFAULT (<text>)`, else the reason. */
export function checkSqlDefaultText(text: string): string | undefined {
  return UNSAFE_DEFAULT_TEXT.test(text)
    ? 'Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.'
    : undefined;
}

/**
 * Names the Prisma default function that raw SQL text is exactly, ignoring surrounding whitespace. The planners treat the contract expressions `now()` and `autoincrement()` as those functions, so raw SQL with that text would not be used as written.
 */
export function reservedSqlDefaultText(text: string): 'now' | 'autoincrement' | undefined {
  switch (text.trim()) {
    case 'now()':
      return 'now';
    case 'autoincrement()':
      return 'autoincrement';
    default:
      return undefined;
  }
}
