import type {
  Contract,
  ContractEnum,
  ContractField,
  JsonValue,
  ScalarFieldType,
} from '@internal/contract/types';
import type { SqlPslBuildContext } from '@internal/family-sql/control';
import type { PslTypeMap } from '@internal/family-sql/psl-build';
import type {
  PslCompositeType,
  PslField,
  PslNamedTypeDeclaration,
  PslTypesBlock,
} from '@internal/framework-components/psl-ast';
import type { SqlStorage } from '@internal/sql-contract/types';
import { resolvedTypeParams, StorageColumn } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { isPostgresCodecDescriptor } from '../codec-descriptor';
import { SYNTHETIC_SPAN } from '../psl-build/psl-literals';
import { buildColumnType, type PslColumnType } from './column-types';
import {
  refuseMemberCodecNeedingTypeParameters,
  refuseMemberCodecWithoutNativeType,
  refuseUnderivedMemberValueSet,
  refuseUnwritableFieldShape,
  refuseUnwritableName,
  refuseValueObjectsOutsideDefaultNamespace,
} from './refusals';

/** The native type the stack's codec names for a value-object member, which has no column of its own. */
function nativeTypeOfMember(
  type: ScalarFieldType,
  coordinate: string,
  context: SqlPslBuildContext,
): string {
  const { codecId } = type;
  const descriptor = context.codecLookup.descriptorFor(codecId);
  if (!isPostgresCodecDescriptor(descriptor)) {
    refuseMemberCodecWithoutNativeType(codecId, coordinate);
  }
  const typeParams = resolvedTypeParams(type, undefined);
  if (typeParams !== undefined) {
    return descriptor.nativeTypeFor({
      codecId,
      typeParams: blindCast<JsonValue, 'contract type parameters are JSON'>(typeParams),
    });
  }
  try {
    return descriptor.nativeTypeFor({ codecId });
  } catch {
    refuseMemberCodecNeedingTypeParameters(codecId, coordinate);
  }
}

/** The PSL type position of a value-object member: a value object or an enum by name, or a scalar as a column would print. */
function buildMemberType(input: {
  readonly field: ContractField;
  readonly coordinate: string;
  readonly typeMap: PslTypeMap;
  readonly context: SqlPslBuildContext;
  readonly enumBlockNames: ReadonlyMap<string, string>;
  readonly domainEnums: Readonly<Record<string, ContractEnum>>;
}): PslColumnType {
  const { field, coordinate } = input;
  refuseUnwritableFieldShape(field, coordinate);
  const { type } = field;
  if (type.kind === 'valueObject') {
    return { typeName: type.name };
  }
  refuseUnderivedMemberValueSet({
    field,
    type,
    coordinate,
    domainEnums: input.domainEnums,
  });
  if (field.valueSet !== undefined) {
    return { typeName: field.valueSet.entityName };
  }
  return buildColumnType({
    column: new StorageColumn({
      nativeType: nativeTypeOfMember(type, coordinate, input.context),
      codecId: type.codecId,
      nullable: field.nullable,
      ...ifDefined('many', field.many),
      ...ifDefined('typeParams', type.typeParams),
    }),
    typeMap: input.typeMap,
    authoringTypes: input.context.authoringContributions.type,
    enumBlockNames: input.enumBlockNames,
    coordinate,
  });
}

/** The `type` blocks of one namespace, one per value object the domain declares there. */
export function buildCompositeTypes(input: {
  readonly contract: Contract<SqlStorage>;
  readonly namespaceId: string;
  readonly typeMap: PslTypeMap;
  readonly context: SqlPslBuildContext;
  readonly enumBlockNames: ReadonlyMap<string, string>;
  readonly domainEnums: Readonly<Record<string, ContractEnum>>;
}): readonly PslCompositeType[] {
  refuseValueObjectsOutsideDefaultNamespace(input.contract, input.namespaceId);
  const valueObjects = input.contract.domain.namespaces[input.namespaceId]?.valueObjects ?? {};
  return Object.entries(valueObjects).map(([name, valueObject]) => {
    refuseUnwritableName('value object', name);
    return {
      kind: 'compositeType',
      name,
      fields: Object.entries(valueObject.fields).map(([fieldName, field]): PslField => {
        refuseUnwritableName('field', fieldName);
        const { typeName, typeConstructor } = buildMemberType({
          field,
          coordinate: `"${input.namespaceId}".${name}.${fieldName}`,
          typeMap: input.typeMap,
          context: input.context,
          enumBlockNames: input.enumBlockNames,
          domainEnums: input.domainEnums,
        });
        return {
          kind: 'field',
          name: fieldName,
          typeName,
          ...ifDefined('typeConstructor', typeConstructor),
          optional: field.nullable,
          list: !!field.many,
          elementOptional: !!field.many && field.many.elementNullable,
          attributes: [],
          span: SYNTHETIC_SPAN,
        };
      }),
      attributes: [],
      span: SYNTHETIC_SPAN,
    };
  });
}

/** The document's `types { … }` block, one declaration per named storage type. */
export function buildTypesBlock(
  contract: Contract<SqlStorage>,
  typeMap: PslTypeMap,
  context: SqlPslBuildContext,
): PslTypesBlock | undefined {
  const declarations: PslNamedTypeDeclaration[] = [];
  for (const [name, instance] of Object.entries(contract.storage.types ?? {})) {
    refuseUnwritableName('named type', name);
    const { typeName, typeConstructor } = buildColumnType({
      column: new StorageColumn({
        nativeType: instance.nativeType,
        codecId: instance.codecId,
        nullable: false,
        ...ifDefined('typeParams', instance.typeParams),
      }),
      typeMap,
      authoringTypes: context.authoringContributions.type,
      enumBlockNames: new Map(),
      coordinate: `types.${name}`,
    });
    declarations.push({
      kind: 'namedType',
      name,
      ...(typeConstructor === undefined ? { baseType: typeName } : { typeConstructor }),
      attributes: [],
      span: SYNTHETIC_SPAN,
    });
  }
  return declarations.length === 0
    ? undefined
    : { kind: 'types', declarations, span: SYNTHETIC_SPAN };
}
