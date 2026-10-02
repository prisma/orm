import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import {
  collectScalarTypeConstructors,
  isAuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import type { AssembledAuthoringContributions } from '@internal/framework-components/control';
import type { DescribeUnresolvedType } from '@internal/psl-parser';

/**
 * A Mongo scalar name an earlier Prisma schema used, with the current name it
 * maps to. Each of these has no live binding in the assembled `type`
 * namespace at all, so the binder never resolves it; this table lets the
 * "cannot find type" diagnostic still name the current replacement (#30521).
 */
const EARLIER_MONGO_SCALAR_NAMES: Readonly<Record<string, string>> = {
  BigInt: 'Int64',
  Bytes: 'Binary',
  Decimal: 'Decimal128',
};

function scalarTypesSentence(types: AuthoringTypeNamespace): string {
  const current = [...collectScalarTypeConstructors(types).keys()].filter((name) => {
    const descriptor = types[name];
    return !(
      descriptor !== undefined &&
      isAuthoringTypeConstructorDescriptor(descriptor) &&
      descriptor.deprecated !== undefined
    );
  });
  return current.length === 0
    ? 'No Mongo scalar types are registered.'
    : `The Mongo scalar types are ${
        current.length === 1
          ? current.join('')
          : `${current.slice(0, -1).join(', ')} and ${current.at(-1)}`
      }.`;
}

/**
 * Mongo's `describeUnresolvedType` contribution: a name from an earlier
 * Prisma (`BigInt`, `Bytes`, `Decimal`) gets the current name and its BSON
 * storage; any other bare, unqualified type name the binder cannot resolve
 * gets the generic unsupported-type message naming the registered scalar
 * types. A qualified reference (`ns.Name`) or a constructor-call reference to
 * an unregistered name (`Name()`) falls back to the binder's own plain
 * "Cannot find type" message instead, since neither names a scalar the
 * registered-types list would help identify.
 */
export function describeUnresolvedMongoType(
  contributions: AssembledAuthoringContributions,
): DescribeUnresolvedType {
  const types = contributions.type;
  const scalars = collectScalarTypeConstructors(types);
  return ({ field, owner, written }) => {
    if (field.typeNamespaceId !== undefined || field.typeConstructor !== undefined) {
      return undefined;
    }
    const replacement = EARLIER_MONGO_SCALAR_NAMES[written];
    const replacementOutput = replacement === undefined ? undefined : scalars.get(replacement);
    if (replacement === undefined || replacementOutput === undefined) {
      return `Field "${owner.name}.${field.name}" has type "${written}", which is not a scalar type, an enum, a composite type or a model. ${scalarTypesSentence(types)}`;
    }
    return `Field "${owner.name}.${field.name}" has type "${written}", which is not a Mongo scalar type; use "${replacement}" (stored as BSON ${replacementOutput.nativeType}).`;
  };
}
