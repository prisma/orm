import type {
  ControlDefaultLiteralTagEntry,
  LoweredDefaultResult,
} from '@internal/framework-components/control';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import { checkSqlDefaultBody, reservedSqlDefaultBody } from '@internal/sql-contract/validators';

/** A `` @default(sql`...`) `` body the SQL family refuses to lower. */
export const PSL_INVALID_DEFAULT_SQL: ContributedPslDiagnosticCode = 'PSL_INVALID_DEFAULT_SQL';

/**
 * The `` sql`...` `` default literal every SQL target registers: the canonical body becomes the expression verbatim. A body that is exactly `now()` or `autoincrement()` is refused so the named form is written instead.
 */
export function sqlDefaultLiteralTagEntry(usage: string): ControlDefaultLiteralTagEntry {
  return {
    usage,
    documentation: "Uses the SQL in the string, verbatim, as the column's default expression.",
    lower: ({ literal, context }): LoweredDefaultResult => {
      const reject = (message: string): LoweredDefaultResult => ({
        ok: false,
        diagnostic: {
          code: PSL_INVALID_DEFAULT_SQL,
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
      const reason = checkSqlDefaultBody(literal.body);
      if (reason !== undefined) return reject(reason);
      return {
        ok: true,
        value: {
          kind: 'storage',
          defaultValue: { kind: 'function', expression: literal.body },
        },
      };
    },
  };
}
