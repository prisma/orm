import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { invariant } from '@internal/utils/assertions';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { buildSqlContractFromDefinition } from '../src/contract-builder';
import {
  type ColumnNode,
  type ContractDefinition,
  type FieldNode,
  type IndexNode,
  isValueObjectMember,
  type ModelNode,
  type ValueObjectFieldNode,
} from '../src/contract-definition';

interface RenderInput {
  readonly tableName: string;
  readonly columnName: string;
  readonly many: boolean;
  readonly elementNullable: boolean;
  readonly memberValues: readonly (string | number)[] | undefined;
}

function renderCheckExpressions(input: RenderInput): ReadonlyArray<{
  readonly kind: 'membership' | 'elementNotNull';
  readonly columnName: string;
  readonly expression: string;
}> {
  const column = `"${input.columnName}"`;
  return [
    ...(input.memberValues !== undefined
      ? [
          {
            kind: 'membership' as const,
            columnName: input.columnName,
            expression: `${column} IN (${input.memberValues.map((v) => `'${v}'`).join(', ')})`,
          },
        ]
      : []),
    ...(input.many && !input.elementNullable
      ? [
          {
            kind: 'elementNotNull' as const,
            columnName: input.columnName,
            expression: `array_position(${column}, NULL) IS NULL`,
          },
        ]
      : []),
  ];
}

function qualifyColumnType(
  input: { readonly codecId: string; readonly typeParams?: Record<string, unknown> },
  namespaceId: string,
): { readonly typeParams?: Record<string, unknown> } {
  const typeName = input.typeParams?.['typeName'];
  if (input.codecId !== 'pg/enum@1' || typeof typeName !== 'string' || namespaceId === 'public') {
    return input;
  }
  return { typeParams: { ...input.typeParams, typeName: `${namespaceId}.${typeName}` } };
}

export const targetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  authoring: { field: {}, renderCheckExpressions, qualifyColumnType },
} as const;

export function definitionOf(
  models: readonly ModelNode[],
  rest: Partial<Omit<ContractDefinition, 'models' | 'target' | 'createNamespace'>> = {},
): ContractDefinition {
  return {
    warnings: undefined,
    target: targetPack,
    createNamespace: createTestSqlNamespace,
    ...rest,
    models,
  };
}

export function build(definition: ContractDefinition): Contract<SqlStorage> {
  return buildSqlContractFromDefinition(
    definition,
    testTypeLookups.codecLookup,
    testTypeLookups.dataTypeLookup,
  );
}

export function field(
  name: string,
  codecId = 'pg/int4@1',
  extra: Partial<FieldNode> = {},
): FieldNode {
  return {
    fieldName: name,
    columnName: name,
    descriptor: { codecId },
    nullable: false,
    many: false,
    ...extra,
  };
}

function columnNodeOf(modelField: FieldNode | ValueObjectFieldNode): ColumnNode {
  if (isValueObjectMember(modelField)) {
    return {
      columnName: modelField.columnName,
      descriptor: modelField.descriptor,
      nullable: modelField.nullable,
      ...(modelField.default !== undefined ? { default: modelField.default } : {}),
    };
  }
  const { fieldName: _f, executionDefaults: _e, ...column } = modelField;
  return column;
}

/**
 * The same definition with one field of one model removed, and its column declared instead as a column node of that model's table.
 */
export function withFieldAsColumnNode(
  definition: ContractDefinition,
  modelName: string,
  fieldName: string,
): ContractDefinition {
  const model = definition.models.find((m) => m.modelName === modelName);
  const moved = model?.fields.find((f) => f.fieldName === fieldName);
  invariant(
    model !== undefined && moved !== undefined,
    `The definition has no field ${modelName}.${fieldName}.`,
  );
  return {
    ...definition,
    models: definition.models.map((m) =>
      m === model ? { ...m, fields: m.fields.filter((f) => f !== moved) } : m,
    ),
    tables: [
      ...(definition.tables ?? []),
      {
        ...(model.namespaceId !== undefined ? { namespaceId: model.namespaceId } : {}),
        tableName: model.tableName,
        columns: [columnNodeOf(moved)],
      },
    ],
  };
}

export function columnIndex(columns: readonly string[]): IndexNode {
  return {
    columns,
    where: undefined,
    unique: undefined,
    map: undefined,
    name: undefined,
    type: undefined,
    options: undefined,
  };
}
