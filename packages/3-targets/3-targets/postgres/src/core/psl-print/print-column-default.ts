import type { PslFieldAttribute } from '@internal/framework-components/psl-ast';
import type { StorageColumn } from '@internal/sql-contract/types';
import { postgresError } from '../errors';
import {
  buildAttribute,
  escapePslString,
  formatPslListLiteralValue,
  formatPslValue,
  positionalArg,
  pslDefaultValueFormat,
} from '../psl-infer/psl-literals';

/** The two function defaults Prisma 8 PSL writes by name; every other one is `dbgenerated`. */
const NAMED_FUNCTION_DEFAULTS = new Set(['now()', 'autoincrement()']);

/**
 * The `@default(…)` attribute for a storage column, or `undefined` when the
 * column carries no default.
 *
 * A literal prints as the PSL literal its codec reads back, with a number
 * printing unquoted from its decimal text; `now()` and `autoincrement()` print
 * by name; every other function default prints as `dbgenerated("…")`. This is
 * the one place that decides when to write `dbgenerated`.
 *
 * A literal the column's codec cannot write as a PSL literal is refused,
 * because every literal that would parse reads back as a different value.
 */
export function printColumnDefault(input: {
  readonly column: StorageColumn;
  readonly pslTypeName: string;
  readonly isEnum: boolean;
  readonly namespaceId: string;
  readonly tableName: string;
  readonly columnName: string;
}): PslFieldAttribute | undefined {
  const columnDefault = input.column.default;
  if (columnDefault === undefined) {
    return undefined;
  }

  if (columnDefault.kind === 'function') {
    const { expression } = columnDefault;
    const argument = NAMED_FUNCTION_DEFAULTS.has(expression)
      ? expression
      : `dbgenerated("${escapePslString(expression)}")`;
    return buildAttribute('field', 'default', [positionalArg(argument)]);
  }

  const format = input.isEnum ? formatPslValue : pslDefaultValueFormat(input.pslTypeName);
  const { value } = columnDefault;
  const literal = Array.isArray(value) ? formatPslListLiteralValue(value, format) : format(value);
  if (literal === undefined) {
    throw postgresError(
      'CONTRACT.CONVERT_UNSUPPORTED',
      `contract convert: column "${input.namespaceId}"."${input.tableName}"."${input.columnName}" has a literal default that cannot be written in Prisma 8 PSL: the ${input.pslTypeName} type reads no PSL literal back as ${JSON.stringify(value)}.`,
      {
        why: 'Writing the value as a quoted string would parse, but the PSL source would read it back as a string rather than as the value the column defaults to.',
        fix: 'Replace the literal default with a database expression default, or drop the default before converting.',
        meta: {
          namespaceId: input.namespaceId,
          table: input.tableName,
          column: input.columnName,
          pslTypeName: input.pslTypeName,
        },
      },
    );
  }
  return buildAttribute('field', 'default', [positionalArg(literal)]);
}
