import type { Contract, ContractEnum, ExecutionMutationDefault } from '@internal/contract/types';
import type { SqlPslPrintContext } from '@internal/family-sql/control';
import type { PslTypeMap } from '@internal/family-sql/psl-ast';
import type { PslField, PslFieldAttribute } from '@internal/framework-components/psl-ast';
import type { SqlStorage, StorageColumn } from '@internal/sql-contract/types';
import { pslFieldMapName } from '@internal/sql-contract-psl/resolution';
import { escapePslString } from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import { PG_ENUM_CODEC_ID } from '../codec-ids';
import {
  buildAttribute,
  buildMapAttribute,
  namedArg,
  positionalArg,
  SYNTHETIC_SPAN,
} from '../psl-ast/psl-literals';
import { buildColumnDefault } from './column-defaults';
import { buildColumnType } from './column-types';
import type { ModelWithTable, VariantInfo } from './contract-model-index';
import { buildDomainFieldType } from './domain-types';
import type { NativeEnumEmission } from './enum-blocks';
import { buildExecutionDefault, temporalPresetArguments } from './generated-values';
import {
  refuseColumnControl,
  refuseFieldColumnMismatch,
  refuseFieldsWithoutColumn,
  refuseGeneratorWithDatabaseDefault,
  refuseStorageWithoutFieldOrColumn,
  refuseUnwritableFieldShape,
  refuseUnwritableName,
} from './refusals';

/** The generated values of the contract, keyed by the column they fill. */
export function executionDefaultsByColumn(
  contract: Contract<SqlStorage>,
): ReadonlyMap<string, ExecutionMutationDefault> {
  const byColumn = new Map<string, ExecutionMutationDefault>();
  for (const entry of contract.execution?.mutations.defaults ?? []) {
    byColumn.set(JSON.stringify([entry.ref.namespace, entry.ref.table, entry.ref.column]), entry);
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
  readonly generatedDefault: PslFieldAttribute | undefined;
  readonly context: SqlPslPrintContext;
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
  const columnDefault =
    input.generatedDefault ??
    buildColumnDefault({
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
  for (const kind of input.column.noCheck ?? []) {
    attributes.push(buildAttribute('field', 'noCheck', [positionalArg(kind)]));
  }
  const mapName = pslFieldMapName(input.fieldName, input.columnName);
  if (mapName !== undefined) {
    attributes.push(buildMapAttribute('field', mapName));
  }
  return attributes;
}

/**
 * The scalar and value-object fields of one model, one per column its storage names. Each generated
 * value written with a field is added to `writtenExecutionDefaults`.
 */
export function buildScalarFields(input: {
  readonly entry: ModelWithTable;
  readonly variant: VariantInfo | undefined;
  readonly enums: NativeEnumEmission;
  readonly domainEnums: Readonly<Record<string, ContractEnum>>;
  readonly typeMap: PslTypeMap;
  readonly context: SqlPslPrintContext;
  readonly executionDefaults: ReadonlyMap<string, ExecutionMutationDefault>;
  readonly writtenExecutionDefaults: Set<ExecutionMutationDefault>;
  readonly defaultDomainEnumNames: ReadonlySet<string>;
}): readonly PslField[] {
  const { entry, variant, enums, domainEnums, typeMap, context, executionDefaults } = input;
  const primaryKeyColumns = variant === undefined ? (entry.table.primaryKey?.columns ?? []) : [];
  const fields: PslField[] = [];

  refuseFieldsWithoutColumn(entry);

  for (const [fieldName, fieldStorage] of Object.entries(entry.storage.fields)) {
    const columnName = fieldStorage.column;
    const coordinate = `"${entry.namespaceId}"."${entry.tableName}"."${columnName}"`;
    const column = entry.table.columns[columnName];
    const field = entry.model.fields[fieldName];
    if (column === undefined || field === undefined) {
      refuseStorageWithoutFieldOrColumn({ entry, fieldName, coordinate });
    }
    refuseUnwritableName('field', fieldName);
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
    const columnType =
      column.typeRef !== undefined
        ? { typeName: column.typeRef }
        : field.type.kind === 'valueObject'
          ? buildDomainFieldType({
              field,
              coordinate,
              typeMap,
              context,
              enumBlockNames: enums.blockNamesByTypeName,
            })
          : buildColumnType({
              column,
              typeMap,
              authoringTypes: context.authoringContributions.type,
              enumBlockNames: enums.blockNamesByTypeName,
              coordinate,
            });
    let { typeName, typeConstructor } = columnType;

    const execution = executionDefaults.get(
      JSON.stringify([entry.namespaceId, entry.tableName, columnName]),
    );
    let generatedDefault: PslFieldAttribute | undefined;
    if (execution !== undefined) {
      input.writtenExecutionDefaults.add(execution);
      const built = buildExecutionDefault({
        executionDefault: execution,
        codecId: column.codecId,
        coordinate,
      });
      if (built.kind === 'temporal') {
        typeName = `temporal.${built.phases.presetName}`;
        typeConstructor = {
          kind: 'typeConstructor',
          path: ['temporal', built.phases.presetName],
          args: temporalPresetArguments({
            phases: built.phases,
            precision: column.typeParams?.['precision'],
          }),
          span: SYNTHETIC_SPAN,
        };
      } else if (column.default !== undefined) {
        refuseGeneratorWithDatabaseDefault({ coordinate, onCreate: execution.onCreate?.id });
      } else {
        generatedDefault = built.attribute;
      }
    }

    fields.push({
      kind: 'field',
      name: fieldName,
      typeName,
      ...ifDefined('typeConstructor', typeConstructor),
      optional: field.nullable,
      list: field.many === true,
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
        generatedDefault,
        context,
      }),
      span: SYNTHETIC_SPAN,
    });
  }

  return fields;
}
