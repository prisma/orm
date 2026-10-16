import type { DescribeUnresolvedType } from '@internal/psl-parser';
import { parseQuotedStringLiteral } from './psl-attribute-parsing';

/**
 * The message for a field type the binder cannot find. `Unsupported("x")`, the Prisma 6 and
 * Prisma 7 way to keep a column of a type those versions do not know, is named as no Prisma 8
 * type; any other name keeps the binder's message.
 */
export function describeUnresolvedSqlType(): DescribeUnresolvedType {
  return ({ field, written }) => {
    const call = field.typeConstructor;
    if (written !== 'Unsupported' || call === undefined || call.args.length !== 1) {
      return undefined;
    }
    const [argument] = call.args;
    const typeName =
      argument?.kind === 'positional' ? parseQuotedStringLiteral(argument.value) : undefined;
    if (typeName === undefined) return undefined;
    return `Unsupported(${JSON.stringify(typeName)}) is not a Prisma 8 type. Write the column's type with a type constructor, or as Raw(${JSON.stringify(typeName)}) when no type constructor names it. If ${JSON.stringify(typeName)} comes from a database extension that has a Prisma 8 pack, add the pack to extensions in prisma.config.ts.`;
  };
}
