import type {
  ContractField,
  ContractValueObjectField,
  EntityCoordinate,
} from '@internal/contract/types';
import { nonEmptyTypeParams } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import {
  isValueObjectMember,
  type ScalarMemberNode,
  type ValueObjectMemberNode,
} from './contract-definition';
import { type EnumValueSetRefs, enumValueSetRefs } from './enum-members';

type Member = ScalarMemberNode | ValueObjectMemberNode;

/** The storage coordinate of a value object. Value objects are all in the default namespace. */
export function valueObjectReference(
  valueObjectName: string,
  defaultNamespaceId: string,
): EntityCoordinate<'storage', 'valueObject'> {
  return {
    plane: 'storage',
    namespaceId: defaultNamespaceId,
    entityKind: 'valueObject',
    entityName: valueObjectName,
  };
}

function fieldWithoutValueSet(
  field: Member,
  defaultNamespaceId: string,
): Omit<ContractField, 'valueSet'> {
  const many = field.many ? { elementNullable: field.elementNullable === true } : false;
  if (isValueObjectMember(field)) {
    return {
      type: {
        kind: 'valueObject',
        ...valueObjectReference(field.valueObjectName, defaultNamespaceId),
      },
      nullable: field.nullable,
      many,
    };
  }
  return {
    type: {
      kind: 'scalar',
      codecId: field.descriptor.codecId,
      ...ifDefined('typeParams', nonEmptyTypeParams(field.descriptor.typeParams)),
    },
    nullable: field.nullable,
    many,
  };
}

function enumRefsOf(field: Member, defaultNamespaceId: string): EnumValueSetRefs | undefined {
  return isValueObjectMember(field)
    ? undefined
    : enumValueSetRefs(field.enumTypeHandle, defaultNamespaceId);
}

/** A model field in the domain plane. A value object is referred to by its storage coordinate, an enum by the domain enum. */
export function buildDomainField(field: Member, defaultNamespaceId: string): ContractField {
  return {
    ...fieldWithoutValueSet(field, defaultNamespaceId),
    ...ifDefined('valueSet', enumRefsOf(field, defaultNamespaceId)?.domain),
  };
}

/** A member of a storage value object. Storage never refers to the domain plane, so an enum member refers to the storage value set. */
export function buildValueObjectMember(
  field: Member,
  defaultNamespaceId: string,
): ContractValueObjectField {
  return {
    ...fieldWithoutValueSet(field, defaultNamespaceId),
    ...ifDefined('valueSet', enumRefsOf(field, defaultNamespaceId)?.storage),
  };
}
