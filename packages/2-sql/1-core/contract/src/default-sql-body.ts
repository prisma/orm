const UNSAFE_DEFAULT_BODY = /;|--|\/\*|\$\$|\bSELECT\b/i;

/** Returns undefined when the body may be rendered as `DEFAULT (<body>)`, else the reason. */
export function checkSqlDefaultBody(body: string): string | undefined {
  return UNSAFE_DEFAULT_BODY.test(body)
    ? 'Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.'
    : undefined;
}

/**
 * Names the Prisma default function a raw SQL body spells exactly, ignoring surrounding whitespace. The planners treat the contract expressions `now()` and `autoincrement()` as those functions, so a raw body with that text would not be used as written.
 */
export function reservedSqlDefaultBody(body: string): 'now' | 'autoincrement' | undefined {
  switch (body.trim()) {
    case 'now()':
      return 'now';
    case 'autoincrement()':
      return 'autoincrement';
    default:
      return undefined;
  }
}
