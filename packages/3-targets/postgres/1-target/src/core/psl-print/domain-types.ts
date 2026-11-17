import type {
  Contract,
  ContractEnum,
  ContractField,
  JsonValue,
  ScalarFieldType,
} from '@internal/contract/types';
import type { SqlPslBuildContext } from '@internal/family-sql/control';
import type { InferredTypeConstructors } from '@internal/family-sql/psl-build';
import { requiredParamKeys, validateCodecTypeParams } from '@internal/framework-components/codec';
import type { PslCompositeType, PslField } from '@internal/framework-components/psl-ast';
import { isSqlDataType } from '@internal/sql-contract/data-type';
import type { SqlStorage } from '@internal/sql-contract/types';
import { nonEmptyTypeParams, StorageColumn } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
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

/**
 * The data type a value-object member's codec represents, after checking the member's type
 * parameters against it. A member has no column of its own.
 */
function dataTypeOfMember(
  type: ScalarFieldType,
  coordinate: string,
  context: SqlPslBuildContext,
): string {
  const { codecId } = type;
  const descriptor = context.codecLookup.descriptorFor(codecId);
  if (descriptor === undefined) refuseMemberCodecWithoutNativeType(codecId, coordinate);
  const dataType = context.dataTypes.lookup.get(descriptor.dataType);
  if (dataType === undefined || !isSqlDataType(dataType)) {
    refuseMemberCodecWithoutNativeType(codecId, coordinate);
  }
  const typeParams = nonEmptyTypeParams(type.typeParams);
  if (typeParams === undefined) {
    if (requiredParamKeys(dataType).length > 0) {
      refuseMemberCodecNeedingTypeParameters(codecId, coordinate);
    }
    return dataType.id;
  }
  validateCodecTypeParams(descriptor, {
    codecId,
    typeParams: blindCast<JsonValue, 'contract type parameters are JSON'>(typeParams),
  });
  return dataType.id;
}

/** The PSL type position of a value-object member: a value object or an enum by name, or a scalar as a column would print. */
function buildMemberType(input: {
  readonly field: ContractField;
  readonly coordinate: string;
  readonly inferredConstructors: InferredTypeConstructors;
  readonly context: SqlPslBuildContext;
  readonly enumBlockNames: ReadonlyMap<string, string>;
  readonly domainEnums: Readonly<Record<string, ContractEnum>>;
}): PslColumnType {
  const { field, coordinate } = input;
  refuseUnwritableFieldShape(field, coordinate);
  const { type } = field;
  if (type.kind === 'valueObject') {
    return { kind: 'valueObject', typeName: type.entityName };
  }
  refuseUnderivedMemberValueSet({
    field,
    type,
    coordinate,
    domainEnums: input.domainEnums,
  });
  if (field.valueSet !== undefined) {
    return { kind: 'enum', typeName: field.valueSet.entityName };
  }
  return buildColumnType({
    column: new StorageColumn({
      dataType: dataTypeOfMember(type, coordinate, input.context),
      codecId: type.codecId,
      nullable: field.nullable,
      ...ifDefined('many', field.many),
      ...ifDefined('typeParams', type.typeParams),
    }),
    inferredConstructors: input.inferredConstructors,
    authoringTypes: input.context.authoringContributions.type,
    dataTypes: input.context.dataTypes,
    enumBlockNames: input.enumBlockNames,
    coordinate,
  });
}

/** The `type` blocks of one namespace, one per value object its storage holds. */
export function buildCompositeTypes(input: {
  readonly contract: Contract<SqlStorage>;
  readonly namespaceId: string;
  readonly inferredConstructors: InferredTypeConstructors;
  readonly context: SqlPslBuildContext;
  readonly enumBlockNames: ReadonlyMap<string, string>;
  readonly domainEnums: Readonly<Record<string, ContractEnum>>;
}): readonly PslCompositeType[] {
  refuseValueObjectsOutsideDefaultNamespace(input.contract, input.namespaceId);
  const valueObjects =
    input.contract.storage.namespaces[input.namespaceId]?.entries.valueObject ?? {};
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
          inferredConstructors: input.inferredConstructors,
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
