import {
  type AuthoringTypeNamespace,
  isAuthoringTypeDescriptor,
  printTaggedLiteral,
} from '@internal/framework-components/authoring';
import type { AssembledAuthoringContributions } from '@internal/framework-components/control';
import type { DescribeUnresolvedType } from '@internal/psl-parser';
import { describeRemovedFieldPreset } from '@internal/psl-parser/interpret';
import { SQL_EXPRESSION_TAG } from '@internal/sql-contract/sql-expression';
import { compareStrings } from './compare-strings';
import { parseQuotedStringLiteral } from './psl-attribute-parsing';
import { removedSqlFieldPresets } from './removed-field-presets';

/** The default message for a bare type name, followed by the types of that name in a contributed namespace in sorted order, such as `sql.Ulid` for `Ulid`, or `undefined` when no namespace has one. */
function suggestNamespacedTypes(
  written: string,
  types: AuthoringTypeNamespace,
): string | undefined {
  const candidates = Object.entries(types)
    .flatMap(([namespace, member]) => {
      if (isAuthoringTypeDescriptor(member) || !Object.hasOwn(member, written)) return [];
      const type = member[written];
      return type !== undefined && isAuthoringTypeDescriptor(type)
        ? [`${namespace}.${written}`]
        : [];
    })
    .sort(compareStrings);
  return candidates.length === 0
    ? undefined
    : `Cannot find type "${written}". Did you mean ${candidates.join(' or ')}?`;
}

/**
 * The message for a field type the binder cannot find. A call to a field preset Prisma 8 removed names what to write instead, and a bare name that a contributed namespace holds names that type. `Unsupported("x")`, the Prisma 6 and Prisma 7 way to keep a column of a type those versions do not know, is named as no Prisma 8 type; any other name keeps the binder's message.
 */
export function describeUnresolvedSqlType(
  contributions: AssembledAuthoringContributions,
): DescribeUnresolvedType {
  return ({ field, written, isDeclared }) => {
    const call = field.typeConstructor;
    if (call === undefined) {
      return field.typeNamespaceId === undefined
        ? suggestNamespacedTypes(written, contributions.type)
        : undefined;
    }
    if (written !== 'Unsupported')
      return describeRemovedFieldPreset(
        removedSqlFieldPresets,
        field,
        contributions.type,
        isDeclared,
      );
    const [argument, ...rest] = call.args;
    const typeName =
      argument?.kind === 'positional' && rest.length === 0
        ? parseQuotedStringLiteral(argument.value)
        : undefined;
    if (typeName === undefined) return undefined;
    return `Unsupported(${JSON.stringify(typeName)}) is not a Prisma 8 type. Write the column's type with a type constructor, or as Raw(${printTaggedLiteral(SQL_EXPRESSION_TAG, typeName)}) when no type constructor names it. If ${JSON.stringify(typeName)} comes from a database extension that has a Prisma 8 pack, add the pack to extensions in prisma.config.ts.`;
  };
}
