import { crossRef } from '@internal/contract/types';
import { assembleDataTypes } from '@internal/framework-components/codec';
import {
  buildSqlContractFromDefinition,
  type ModelNode,
} from '@internal/sql-contract-ts/contract-builder';
import { assemblePostgresCodecRegistryWithBuiltins } from '@internal/target-postgres/codecs';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';
import { getModelAndEveryVariantFieldColumns } from '../src/collection-contract';

const int4 = { codecId: 'pg/int4@1' } as const;
const text = { codecId: 'pg/text@1' } as const;

function polymorphicContract(variantFieldName: string) {
  const dataTypeLookup = assembleDataTypes([postgresPack]).lookup;
  const codecLookup = assemblePostgresCodecRegistryWithBuiltins([], dataTypeLookup);
  const models: readonly ModelNode[] = [
    {
      modelName: 'Task',
      tableName: 'task',
      namespaceId: 'public',
      fields: [
        { fieldName: 'id', columnName: 'id', descriptor: int4, nullable: false },
        { fieldName: 'type', columnName: 'type', descriptor: text, nullable: false },
      ],
      id: { columns: ['id'] },
      discriminator: { field: 'type' },
      variants: { bug: crossRef('Bug', 'public') },
    },
    {
      modelName: 'Bug',
      tableName: 'bug',
      namespaceId: 'public',
      fields: [
        { fieldName: 'id', columnName: 'id', descriptor: int4, nullable: false },
        { fieldName: variantFieldName, columnName: 'ctor', descriptor: text, nullable: false },
      ],
      id: { columns: ['id'] },
      base: crossRef('Task', 'public'),
    },
  ];
  return buildSqlContractFromDefinition(
    {
      warnings: undefined,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
      models,
    },
    codecLookup,
    dataTypeLookup,
  );
}

describe('the columns of a model and every variant', () => {
  it('holds a variant field named like a property every object has', () => {
    expect(
      getModelAndEveryVariantFieldColumns(polymorphicContract('constructor'), 'public', 'Task'),
    ).toEqual({ id: ['id'], type: ['type'], constructor: ['ctor'] });
  });
});
