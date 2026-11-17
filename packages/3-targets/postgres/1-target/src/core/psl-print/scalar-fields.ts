import type { Contract, ContractEnum, ExecutionMutationDefault } from '@internal/contract/types';
import type { SqlPslBuildContext } from '@internal/family-sql/control';
import type { InferredTypeConstructors } from '@internal/family-sql/psl-build';
import type { PslField, PslFieldAttribute } from '@internal/framework-components/psl-ast';
import { escapePslString } from '@internal/sql-contract/data-type-support';
import { nonEmptyTypeParams, type SqlStorage, StorageColumn } from '@internal/sql-contract/types';
import { pslFieldMapName } from '@internal/sql-contract-psl/map-names';
import { assertDefined } from '@internal/utils/assertions';
import { ifDefined } from '@internal/utils/defined';
import { PG_ENUM_CODEC_ID } from '../codec-ids';
import {
  buildAttribute,
  buildMapAttribute,
  namedArg,
  SYNTHETIC_SPAN,
} from '../psl-build/psl-literals';
import { buildColumnDefault } from './column-defaults';
import { buildColumnType, type PslColumnType } from './column-types';
import {
  discriminatorValueSetOf,
  type ModelWithTable,
  type VariantInfo,
} from './contract-model-index';
import type { NativeEnumEmission } from './enum-blocks';
import { buildGeneratorAttributes } from './generated-values';
import {
  refuseColumnControl,
  refuseFieldColumnMismatch,
  refuseStorageOfUndeclaredField,
  refuseUnwritableFieldShape,
  refuseUnwritableMappedName,
  refuseUnwritableName,
} from './refusals';

/** The generated values of the contract, keyed by the column they fill. */
export function executionDefaultsByColumn(
  contract: Contract<SqlStorage>,
): ReadonlyMap<string, ExecutionMutationDefault> {
  const byColumn = new Map<string, ExecutionMutationDefault>();
  for (const entry of contract.execution?.mutations.defaults ?? []) {
    byColumn.set(JSON.stringify([entry.ref.namespace, entry.ref.entry, entry.ref.field]), entry);
  }
  return byColumn;
}

function scalarFieldAttributes(input: {
  readonly column: StorageColumn;
  readonly fieldName: string;
  readonly namespaceId: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly isSingleColumnId: boolean;
  readonly primaryKeyName: string | undefined;
  readonly pslTypeName: string;
  readonly isEnum: boolean;
  readonly domainEnum: ContractEnum | undefined;
  readonly generatorAttributes: readonly PslFieldAttribute[];
  readonly context: SqlPslBuildContext;
}): readonly PslFieldAttribute[] {
  const attributes: PslFieldAttribute[] = [];
  if (input.isSingleColumnId) {
    attributes.push(
      buildAttribute(
        'field',
        'id',
        input.primaryKeyName === undefined
          ? []
          : [namedArg('map', `"${escapePslString(input.primaryKeyName)}"`)],
      ),
    );
  }
  const columnDefault = buildColumnDefault({
    column: input.column,
    pslTypeName: input.pslTypeName,
    isEnum: input.isEnum,
    domainEnum: input.domainEnum,
    namespaceId: input.namespaceId,
    tableName: input.tableName,
    columnName: input.columnName,
    context: input.context,
  });
  if (columnDefault !== undefined) {
    attributes.push(columnDefault);
  }
  attributes.push(...input.generatorAttributes);
  const mapName = pslFieldMapName(input.fieldName, input.columnName);
  if (mapName !== undefined) {
    attributes.push(buildMapAttribute('field', mapName));
  }
  return attributes;
}

/**
 * The scalar and value-object fields of one model, one per column its storage names.
 */
export function buildScalarFields(input: {
  readonly entry: ModelWithTable;
  readonly variant: VariantInfo | undefined;
  readonly enums: NativeEnumEmission;
  readonly domainEnums: Readonly<Record<string, ContractEnum>>;
  readonly inferredConstructors: InferredTypeConstructors;
  readonly context: SqlPslBuildContext;
  readonly executionDefaults: ReadonlyMap<string, ExecutionMutationDefault>;
  readonly defaultDomainEnumNames: ReadonlySet<string>;
}): readonly PslField[] {
  const { entry, variant, enums, domainEnums, inferredConstructors, context, executionDefaults } =
    input;
  const primaryKeyColumns = variant === undefined ? (entry.table.primaryKey?.columns ?? []) : [];
  const fields: PslField[] = [];
  const discriminatorField =
    discriminatorValueSetOf(entry) === undefined ? undefined : entry.model.discriminator?.field;

  for (const [fieldName, fieldStorage] of Object.entries(entry.storage.fields)) {
    const columnName = fieldStorage.column;
    const coordinate = `"${entry.namespaceId}"."${entry.tableName}"."${columnName}"`;
    const storedColumn = entry.table.columns[columnName];
    const column =
      fieldName === discriminatorField && storedColumn !== undefined
        ? withoutValueSet(storedColumn)
        : storedColumn;
    const field = entry.model.fields[fieldName];
    assertDefined(column, `column ${coordinate} is not declared by its table`);
    if (field === undefined) refuseStorageOfUndeclaredField({ entry, fieldName, coordinate });
    refuseUnwritableName('field', fieldName);
    refuseUnwritableMappedName('column', columnName);
    refuseUnwritableFieldShape(field, coordinate);
    refuseColumnControl(column, coordinate);
    refuseFieldColumnMismatch({
      field,
      column,
      coordinate,
      modelName: entry.name,
      singleTableVariant: variant?.singleTable === true,
      domainEnumNames: input.defaultDomainEnumNames,
    });
    const columnType: PslColumnType =
      field.type.kind === 'valueObject'
        ? { kind: 'valueObject', typeName: field.type.entityName }
        : buildColumnType({
            column,
            inferredConstructors,
            authoringTypes: context.authoringContributions.type,
            dataTypes: context.dataTypes,
            enumBlockNames: enums.blockNamesByTypeName,
            coordinate,
            namespaceId: entry.namespaceId,
          });
    const { typeName, typeConstructor } = columnType;

    const execution = executionDefaults.get(
      JSON.stringify([entry.namespaceId, entry.tableName, columnName]),
    );
    const generatorAttributes =
      execution === undefined
        ? []
        : buildGeneratorAttributes({
            executionDefault: execution,
            codecId: column.codecId,
            list: !!field.many,
            typeParams: nonEmptyTypeParams(column.typeParams),
            coordinate,
            context,
          });

    fields.push({
      kind: 'field',
      name: fieldName,
      typeName,
      ...ifDefined('typeConstructor', typeConstructor),
      optional: field.nullable,
      list: !!field.many,
      elementOptional: !!field.many && field.many.elementNullable,
      attributes: scalarFieldAttributes({
        column,
        fieldName,
        namespaceId: entry.namespaceId,
        tableName: entry.tableName,
        columnName,
        isSingleColumnId: primaryKeyColumns.length === 1 && primaryKeyColumns[0] === columnName,
        primaryKeyName: entry.table.primaryKey?.name,
        pslTypeName: columnType.typeName,
        isEnum: column.codecId === PG_ENUM_CODEC_ID,
        domainEnum:
          column.codecId === PG_ENUM_CODEC_ID || column.valueSet === undefined
            ? undefined
            : domainEnums[column.valueSet.entityName],
        generatorAttributes,
        context,
      }),
      span: SYNTHETIC_SPAN,
    });
  }

  return fields;
}

/** A discriminator column without the value set the PSL source writes for it from the variants, so it is written as the plain column it is declared as. */
function withoutValueSet(column: StorageColumn): StorageColumn {
  return new StorageColumn({
    dataType: column.dataType,
    codecId: column.codecId,
    nullable: column.nullable,
    many: column.many,
    ...ifDefined('typeParams', column.typeParams),
    ...ifDefined('default', column.default),
    ...ifDefined('control', column.control),
  });
}
