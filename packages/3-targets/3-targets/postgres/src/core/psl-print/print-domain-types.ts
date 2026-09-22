import type { Contract, ContractField } from '@internal/contract/types';
import type { PslTypeMap } from '@internal/family-sql/psl-infer';
import type {
  PslCompositeType,
  PslField,
  PslNamedTypeDeclaration,
  PslTypesBlock,
} from '@internal/framework-components/psl-ast';
import type { SqlStorage } from '@internal/sql-contract/types';
import { StorageColumn } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { JsonValue } from '@internal/utils/json';
import type { AnyPostgresCodecDescriptor } from '../codec-descriptor';
import { codecDescriptorMap } from '../codec-type-map';
import { postgresError } from '../errors';
import { SYNTHETIC_SPAN } from '../psl-infer/psl-literals';
import { type PslColumnType, printColumnType } from './print-column-type';

const descriptorsByCodecId: ReadonlyMap<string, AnyPostgresCodecDescriptor> = new Map(
  Object.values(codecDescriptorMap).map((descriptor) => [descriptor.codecId, descriptor]),
);

/**
 * The storage column a domain field would occupy, so its PSL type prints
 * through the same map as a real column. A value object's fields have no
 * column of their own; their codec names the native type.
 */
function columnForDomainField(field: ContractField, coordinate: string): StorageColumn {
  if (field.type.kind !== 'scalar') {
    throw postgresError(
      'CONTRACT.PRINT_UNSUPPORTED',
      `contract print: field ${coordinate} has a ${field.type.kind} type, which cannot be written in Prisma 8 PSL.`,
      {
        why: 'A PSL field names one scalar, enum, or value-object type; a union of types has no PSL form.',
        fix: 'Give the field a single type, or author the Prisma 8 contract by hand.',
        meta: { coordinate, kind: field.type.kind },
      },
    );
  }
  const descriptor = descriptorsByCodecId.get(field.type.codecId);
  if (descriptor === undefined) {
    throw postgresError(
      'CONTRACT.PRINT_UNSUPPORTED',
      `contract print: field ${coordinate} uses codec "${field.type.codecId}", which the Postgres printer cannot name a native type for.`,
      {
        why: 'A value-object field has no storage column, so its PSL type is derived from its codec; this codec is not one the Postgres target owns.',
        fix: 'Author the Prisma 8 contract by hand for this value object.',
        meta: { coordinate, codecId: field.type.codecId },
      },
    );
  }
  return new StorageColumn({
    nativeType: descriptor.nativeTypeFor({
      codecId: field.type.codecId,
      ...ifDefined(
        'typeParams',
        blindCast<JsonValue | undefined, 'type parameters are JSON'>(field.type.typeParams),
      ),
    }),
    codecId: field.type.codecId,
    nullable: field.nullable,
    ...ifDefined('many', field.many),
    ...ifDefined('typeParams', field.type.typeParams),
    ...ifDefined('valueSet', field.valueSet),
  });
}

function refuseDictField(field: ContractField, coordinate: string): void {
  if (field.dict !== true) return;
  throw postgresError(
    'CONTRACT.PRINT_UNSUPPORTED',
    `contract print: field ${coordinate} is a dictionary, which cannot be written in Prisma 8 PSL.`,
    {
      why: 'PSL writes a field as one value or a list; it has no form for a keyed dictionary.',
      fix: 'Author the Prisma 8 contract by hand for this field.',
      meta: { coordinate },
    },
  );
}

/** The PSL type position of a domain field: a value object by name, or a scalar through the type map. */
export function printDomainFieldType(input: {
  readonly field: ContractField;
  readonly coordinate: string;
  readonly typeMap: PslTypeMap;
  readonly enumBlockNames: ReadonlyMap<string, string>;
}): PslColumnType {
  const { field, coordinate } = input;
  refuseDictField(field, coordinate);
  if (field.type.kind === 'valueObject') {
    return { typeName: field.type.name };
  }
  return printColumnType({
    column: columnForDomainField(field, coordinate),
    typeMap: input.typeMap,
    enumBlockNames: input.enumBlockNames,
    coordinate,
  });
}

/** The `type` blocks of one namespace, one per value object the domain declares there. */
export function buildCompositeTypes(input: {
  readonly contract: Contract<SqlStorage>;
  readonly namespaceId: string;
  readonly typeMap: PslTypeMap;
  readonly enumBlockNames: ReadonlyMap<string, string>;
}): readonly PslCompositeType[] {
  const valueObjects = input.contract.domain.namespaces[input.namespaceId]?.valueObjects ?? {};
  return Object.entries(valueObjects).map(([name, valueObject]) => ({
    kind: 'compositeType',
    name,
    fields: Object.entries(valueObject.fields).map(([fieldName, field]): PslField => {
      const { typeName, typeConstructor } = printDomainFieldType({
        field,
        coordinate: `"${input.namespaceId}".${name}.${fieldName}`,
        typeMap: input.typeMap,
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
  }));
}

/** The document's `types { … }` block, one declaration per named storage type. */
export function buildTypesBlock(
  contract: Contract<SqlStorage>,
  typeMap: PslTypeMap,
): PslTypesBlock | undefined {
  const declarations: PslNamedTypeDeclaration[] = [];
  for (const [name, instance] of Object.entries(contract.storage.types ?? {})) {
    const { typeName, typeConstructor } = printColumnType({
      column: new StorageColumn({
        nativeType: instance.nativeType,
        codecId: instance.codecId,
        nullable: false,
        ...ifDefined('typeParams', instance.typeParams),
      }),
      typeMap,
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
