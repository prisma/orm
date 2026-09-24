/**
 * Mirrors the SQL family's `sql` lowering entry; the authoring layer's tests cannot import the
 * family. ADR 254.
 */

import type { AuthoringDataTypeEntry } from '@internal/framework-components/authoring';
import { checkSqlDefaultBody, reservedSqlDefaultBody } from '@internal/sql-contract/validators';

export function sqlLiteralTagLowering(tag: string): AuthoringDataTypeEntry {
  return {
    written: { kind: 'tag', tag },
    documentation: "Uses the SQL in the string, verbatim, as the column's default expression.",
    lower: ({ literal, context }) => {
      const reject = (message: string) => ({
        ok: false as const,
        diagnostic: {
          code: 'PSL_INVALID_DEFAULT_SQL',
          message,
          sourceId: context.sourceId,
          span: literal.span,
        },
      });
      const reserved = reservedSqlDefaultBody(literal.body);
      if (reserved !== undefined) {
        return reject(
          `Write @default(${reserved}()) instead of ${literal.tag}\`${reserved}()\`; ${reserved}() is a Prisma default function, not raw SQL.`,
        );
      }
      const unsafe = checkSqlDefaultBody(literal.body);
      if (unsafe !== undefined) return reject(unsafe);
      return {
        ok: true as const,
        value: {
          kind: 'storage' as const,
          defaultValue: { kind: 'function' as const, expression: literal.body },
        },
      };
    },
  };
}
