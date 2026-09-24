import type { Contract, ContractField, ScalarFieldType } from '@internal/contract/types';
import type { SqlPslPrintContext } from '@internal/family-sql/control';
import type { PslTypeMap } from '@internal/family-sql/psl-ast';
import type {
  PslCompositeType,
  PslField,
  PslNamedTypeDeclaration,
  PslTypesBlock,
} from '@internal/framework-components/psl-ast';
import type { SqlStorage } from '@internal/sql-contract/types';
import { StorageColumn } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import { isPostgresCodecDescriptor } from '../codec-descriptor';
import { SYNTHETIC_SPAN } from '../psl-ast/psl-literals';
import { buildColumnType, type PslColumnType } from './column-types';
import {
  refuseNonIdentifier,
  refuseUnwritableFieldShape,
  refuseValueObjectFieldCodecNeedingTypeParameters,
  refuseValueObjectFieldCodecWithoutNativeType,
  refuseValueObjectFieldPartsTheSourceDrops,
  refuseValueObjectsOutsideDefaultNamespace,
} from './refusals';

/**
 * The native type the stack's codec names for a value-object field. The field has no column of its
 * own, and no type parameters, which the PSL source would not keep.
 */
function nativeTypeOfValueObjectField(
  field: ContractField & { readonly type: ScalarFieldType },
  coordinate: string,
  context: SqlPslPrintContext,
): string {
  const { codecId } = field.type;
  const descriptor = context.codecLookup.descriptorFor?.(codecId);
  if (!isPostgresCodecDescriptor(descriptor)) {
    refuseValueObjectFieldCodecWithoutNativeType(codecId, coordinate);
  }
  try {
    return descriptor.nativeTypeFor({ codecId });
  } catch {
    refuseValueObjectFieldCodecNeedingTypeParameters(codecId, coordinate);
  }
}

/** The PSL type position of a domain field: a value object by name, or a scalar as a column would print. */
export function buildDomainFieldType(input: {
  readonly field: ContractField;
  readonly coordinate: string;
  readonly typeMap: PslTypeMap;
  readonly context: SqlPslPrintContext;
  readonly enumBlockNames: ReadonlyMap<string, string>;
}): PslColumnType {
  const { field, coordinate } = input;
  refuseUnwritableFieldShape(field, coordinate);
  const { type } = field;
  if (type.kind === 'valueObject') {
    return { typeName: type.name };
  }
  refuseValueObjectFieldPartsTheSourceDrops({ ...field, type }, coordinate);
  return buildColumnType({
    column: new StorageColumn({
      nativeType: nativeTypeOfValueObjectField({ ...field, type }, coordinate, input.context),
      codecId: type.codecId,
      nullable: field.nullable,
      ...ifDefined('many', field.many),
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
  readonly context: SqlPslPrintContext;
  readonly enumBlockNames: ReadonlyMap<string, string>;
}): readonly PslCompositeType[] {
  refuseValueObjectsOutsideDefaultNamespace(input.contract, input.namespaceId);
  const valueObjects = input.contract.domain.namespaces[input.namespaceId]?.valueObjects ?? {};
  return Object.entries(valueObjects).map(([name, valueObject]) => {
    refuseNonIdentifier('value object', name);
    return {
      kind: 'compositeType',
      name,
      fields: Object.entries(valueObject.fields).map(([fieldName, field]): PslField => {
        refuseNonIdentifier('field', fieldName);
        const { typeName, typeConstructor } = buildDomainFieldType({
          field,
          coordinate: `"${input.namespaceId}".${name}.${fieldName}`,
          typeMap: input.typeMap,
          context: input.context,
          enumBlockNames: input.enumBlockNames,
        });
        return {
          kind: 'field',
          name: fieldName,
          typeName,
          ...ifDefined('typeConstructor', typeConstructor),
          optional: field.nullable,
          list: field.many === true,
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
  context: SqlPslPrintContext,
): PslTypesBlock | undefined {
  const declarations: PslNamedTypeDeclaration[] = [];
  for (const [name, instance] of Object.entries(contract.storage.types ?? {})) {
    refuseNonIdentifier('named type', name);
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
