import type { ColumnDefault } from '@internal/contract/types';
import {
  canonicalizeTaggedLiteralBody,
  describeTaggedLiteralFailure,
  resolveBacktickEscapes,
} from '@internal/framework-components/control';
import { checkSqlDefaultBody, reservedSqlDefaultBody } from '@internal/sql-contract/validators';
import { contractError } from './contract-errors';

/**
 * A raw SQL column default written as a template literal: `` sql`gen_random_uuid()` ``. The raw
 * text between the backticks is read the way PSL reads a backtick string (`` \` `` and `\\` are the
 * only escapes), canonicalized the same way, and used verbatim as the default expression.
 * Interpolation is not supported.
 */
export function sql(strings: TemplateStringsArray, ...values: readonly never[]): ColumnDefault {
  if (values.length > 0) {
    throw contractError(
      'CONTRACT.DEFAULT_SQL_INTERPOLATION',
      'sql`...` does not support interpolation; write the SQL as one literal.',
      { meta: { interpolations: values.length } },
    );
  }
  const canonical = canonicalizeTaggedLiteralBody(resolveBacktickEscapes(strings.raw.join('')));
  if (!canonical.ok) {
    throw contractError(
      'CONTRACT.DEFAULT_INVALID',
      describeTaggedLiteralFailure(canonical.reason),
      {
        meta: { reason: canonical.reason, offset: canonical.offset },
      },
    );
  }
  const reserved = reservedSqlDefaultBody(canonical.body);
  if (reserved !== undefined) {
    throw contractError(
      'CONTRACT.DEFAULT_INVALID',
      `Write .default(${reserved}()) instead of sql\`${reserved}()\`; ${reserved}() is a Prisma default function, not raw SQL.`,
      { meta: { reason: 'reserved-function', expression: canonical.body } },
    );
  }
  const rejected = checkSqlDefaultBody(canonical.body);
  if (rejected !== undefined) {
    throw contractError('CONTRACT.DEFAULT_INVALID', rejected, {
      meta: { reason: 'unsafe-sql', expression: canonical.body },
    });
  }
  return { kind: 'function', expression: canonical.body };
}
