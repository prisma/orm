import {
  type AnyCodecDescriptor,
  type CodecLookupWithDescriptors,
  createDataTypeLookup,
} from '@internal/framework-components/codec';
import type { TargetPackRef } from '@internal/framework-components/components';
import { sqlDataType } from '@internal/sql-contract/data-type';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { buildSqlContractFromDefinition } from '../src/contract-builder';
import type { ContractDefinition, FieldNode } from '../src/contract-definition';
import { documentScopedTypes } from './cross-ref-helpers';
import { unboundTables } from './unbound-tables';

const int4 = sqlDataType('t/int4', {
  texts: [
    { text: 'int4', written: true },
    { text: 'integer', catalog: true },
  ],
});
const varchar = sqlDataType('t/varchar', {
  params: type({ 'length?': 'number.integer >= 1' }),
  texts: [
    { text: 'character varying', written: true },
    { text: 'character varying({length})', written: true },
  ],
});
const enumType = sqlDataType('t/enum', {
  params: type({ typeName: 'string > 0' }),
  claimsKind: 'enum',
  render: ({ typeName }) => `"${typeName}"`,
});

const codecDataTypes: Readonly<Record<string, AnyCodecDescriptor['dataType']>> = {
  't/int4@1': int4.id,
  't/varchar@1': varchar.id,
  't/enum@1': enumType.id,
};

const codecLookup: CodecLookupWithDescriptors = {
  get: () => undefined,
  descriptorFor: (codecId) => {
    const dataType = codecDataTypes[codecId];
    if (dataType === undefined) return undefined;
    return {
      codecId,
      dataType,
      traits: [],
      paramsSchema: undefined,
      isParameterized: false,
      factory: () => () => {
        throw new Error('not used');
      },
    };
  },
  renderOutputTypeFor: () => undefined,
};

const dataTypeLookup = createDataTypeLookup([int4, varchar, enumType]);

const targetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

function definitionWith(
  fields: readonly FieldNode[],
  storageTypes: ContractDefinition['storageTypes'] = {},
): ContractDefinition {
  return {
    warnings: undefined,
    target: targetPack,
    createNamespace: createTestSqlNamespace,
    storageTypes,
    models: [
      {
        modelName: 'Item',
        tableName: 'item',
        fields: [
          {
            fieldName: 'id',
            columnName: 'id',
            descriptor: { codecId: 't/int4@1' },
            nullable: false,
          },
          ...fields,
        ],
        id: { columns: ['id'] },
      },
    ],
  };
}

function columnsOf(definition: ContractDefinition) {
  const contract = buildSqlContractFromDefinition(definition, codecLookup, dataTypeLookup);
  return unboundTables(contract.storage)['item']?.columns;
}

describe('the type name a built contract stores', () => {
  it('is the base name of the codec’s data type, whatever name the descriptor carries', () => {
    expect(
      columnsOf(
        definitionWith([
          {
            fieldName: 'count',
            columnName: 'count',
            descriptor: { codecId: 't/int4@1', nativeType: 'wrong' },
            nullable: false,
          },
          {
            fieldName: 'name',
            columnName: 'name',
            descriptor: { codecId: 't/varchar@1', typeParams: { length: 255 } },
            nullable: false,
          },
        ]),
      ),
    ).toMatchObject({
      id: { nativeType: 'int4' },
      count: { nativeType: 'int4' },
      name: { nativeType: 'character varying', typeParams: { length: 255 } },
    });
  });

  it('is the unquoted type name of a type that claims a kind', () => {
    expect(
      columnsOf(
        definitionWith([
          {
            fieldName: 'status',
            columnName: 'status',
            descriptor: { codecId: 't/enum@1', typeParams: { typeName: 'app.status' } },
            nullable: false,
          },
        ]),
      )?.['status'],
    ).toMatchObject({ nativeType: 'app.status' });
  });

  it('names a column that references a storage type from the storage type’s codec', () => {
    expect(
      columnsOf(
        definitionWith(
          [
            {
              fieldName: 'code',
              columnName: 'code',
              descriptor: { codecId: 't/varchar@1', typeRef: 'Code' },
              nullable: false,
            },
          ],
          {
            Code: {
              kind: 'codec-instance',
              codecId: 't/varchar@1',
              nativeType: 'wrong',
              typeParams: { length: 8 },
            },
          },
        ),
      )?.['code'],
    ).toMatchObject({ nativeType: 'character varying', typeRef: 'Code' });
  });

  it('names each storage type from its codec’s data type', () => {
    const contract = buildSqlContractFromDefinition(
      definitionWith([], {
        Code: {
          kind: 'codec-instance',
          codecId: 't/varchar@1',
          nativeType: 'wrong',
          typeParams: { length: 8 },
        },
      }),
      codecLookup,
      dataTypeLookup,
    );
    expect(documentScopedTypes(contract)?.['Code']).toEqual({
      kind: 'codec-instance',
      codecId: 't/varchar@1',
      nativeType: 'character varying',
      typeParams: { length: 8 },
    });
  });

  it('refuses a column whose type parameters its data type does not accept, naming the field', () => {
    expect(() =>
      columnsOf(
        definitionWith([
          {
            fieldName: 'name',
            columnName: 'name',
            descriptor: { codecId: 't/varchar@1', typeParams: { length: 0 } },
            nullable: false,
          },
        ]),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.TYPE_PARAMS_INVALID',
        message: expect.stringContaining('Field "Item.name"'),
        meta: {
          dataType: 't/varchar',
          parameters: ['length'],
          modelName: 'Item',
          fieldName: 'name',
        },
      }),
    );
  });

  it('refuses a column whose referenced storage type has parameters its data type does not accept', () => {
    expect(() =>
      columnsOf(
        definitionWith(
          [
            {
              fieldName: 'code',
              columnName: 'code',
              descriptor: { codecId: 't/varchar@1', typeRef: 'Code' },
              nullable: false,
            },
          ],
          {
            Code: {
              kind: 'codec-instance',
              codecId: 't/varchar@1',
              nativeType: 'character varying',
              typeParams: { length: 0 },
            },
          },
        ),
      ),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.TYPE_PARAMS_INVALID' }));
  });

  it('builds a storage type no column references without checking its parameters', () => {
    expect(() =>
      buildSqlContractFromDefinition(
        definitionWith([], {
          Code: {
            kind: 'codec-instance',
            codecId: 't/varchar@1',
            nativeType: 'character varying',
            typeParams: { length: 0 },
          },
        }),
        codecLookup,
        dataTypeLookup,
      ),
    ).not.toThrow();
  });

  it('refuses a column whose codec is not registered', () => {
    expect(() =>
      columnsOf(
        definitionWith([
          {
            fieldName: 'other',
            columnName: 'other',
            descriptor: { codecId: 't/unknown@1' },
            nullable: false,
          },
        ]),
      ),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.CODEC_DESCRIPTOR_MISSING' }));
  });
});
