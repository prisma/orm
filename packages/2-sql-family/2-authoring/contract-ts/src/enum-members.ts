import type { EntityCoordinate } from '@internal/contract/types';
import { type EnumTypeHandle, encodeEnumTypeMembers } from '@internal/contract-authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { contractError } from './contract-errors';

/**
 * The member values a membership check must enforce, encoded exactly as the
 * column stores them. Membership predicates support strings and finite numbers.
 */
export function checkMemberValues(
  handle: EnumTypeHandle,
  codecLookup: CodecLookupWithDescriptors,
): readonly (string | number)[] {
  const encoded = encodeEnumTypeMembers(handle, codecLookup, 'the column').map(
    (member) => member.value,
  );
  const values: (string | number)[] = [];
  for (const value of encoded) {
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
      throw contractError(
        'CONTRACT.ENUM_INVALID',
        `enumType("${handle.enumName}"): CHECK constraint members must encode to strings or finite numbers.`,
        { meta: { enumName: handle.enumName, reason: 'unsupported-member-value' } },
      );
    }
    values.push(value);
  }
  return values;
}

export interface EnumValueSetRefs {
  readonly domain: EntityCoordinate<'domain', 'enum'>;
  readonly storage: EntityCoordinate<'storage', 'valueSet'>;
}

/**
 * The refs of a field typed by an authored enum: the domain enum and its storage value set. Authored enums are registered in the default namespace, whatever namespace the field's model is in.
 */
export function enumValueSetRefs(
  enumHandle: EnumTypeHandle | undefined,
  defaultNamespaceId: string,
): EnumValueSetRefs | undefined {
  if (enumHandle === undefined) return undefined;
  const common = { namespaceId: defaultNamespaceId, entityName: enumHandle.enumName };
  return {
    domain: { plane: 'domain', entityKind: 'enum', ...common },
    storage: { plane: 'storage', entityKind: 'valueSet', ...common },
  };
}
