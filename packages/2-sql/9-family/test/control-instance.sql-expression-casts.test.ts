import { type DataType, dataType } from '@internal/framework-components/codec';
import type {
  ControlFamilyDescriptor,
  ControlStack,
  ControlTargetDescriptor,
} from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import {
  SQL_EXPRESSION_DATA_TYPE_ID,
  sqlExpressionAuthoringEntry,
  sqlExpressionDataType,
} from '@internal/sql-contract/sql-expression';
import { describe, expect, it } from 'vitest';
import { createSqlFamilyInstance } from '../src/core/control-instance';
import type { SqlControlExtensionDescriptor } from '../src/core/migrations/types';

function makeStack(extensionDataTypes: readonly DataType[]): ControlStack<'sql', 'postgres'> {
  const extension: SqlControlExtensionDescriptor<'postgres'> = {
    kind: 'extension',
    id: 'geometry-pack',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    dataTypes: extensionDataTypes,
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
  };
  return createControlStack({
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      dataTypes: [sqlExpressionDataType],
      authoring: { dataTypes: { [SQL_EXPRESSION_DATA_TYPE_ID]: sqlExpressionAuthoringEntry } },
      create: (() => ({})) as unknown as ControlFamilyDescriptor<'sql'>['create'],
      emission: {
        id: 'sql',
        generateStorageType: () => '{ readonly storageHash: StorageHash }',
        generateModelStorageType: () => 'Record<string, never>',
        getFamilyImports: () => [],
        getFamilyTypeAliases: () => '',
        getTypeMapsExpression: () => 'unknown',
        getContractWrapper: (base: string) => `export type Contract = ${base};`,
      },
    },
    target: {
      kind: 'target',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      contractSerializer: {
        deserializeContract: (json) => json as never,
        serializeContract: (contract) => contract as never,
      },
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    } as ControlTargetDescriptor<'sql', 'postgres'>,
    adapter: {
      kind: 'adapter',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    extensions: [extension],
  });
}

describe('createSqlFamilyInstance and casts from sql/expression', () => {
  it('accepts a stack whose data types do not cast from sql/expression', () => {
    const geometry = dataType('postgis/geometry', {});
    expect(() => createSqlFamilyInstance(makeStack([geometry]))).not.toThrow();
  });

  it('refuses a stack in which an extension type casts from sql/expression', () => {
    const geometry = dataType('postgis/geometry', {
      casts: { [SQL_EXPRESSION_DATA_TYPE_ID]: (value) => value },
    });
    const stack = makeStack([geometry]);
    expect(() => createSqlFamilyInstance(stack)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION',
        message:
          'Data type "postgis/geometry" from "geometry-pack" declares a cast from sql/expression. No data type may cast from sql/expression: a sql literal is SQL the database runs, not a value of another type.',
        details: { dataType: 'postgis/geometry', contributedBy: 'geometry-pack' },
      }),
    );
  });

  it('refuses a stack in which an extension type has a list cast from sql/expression', () => {
    const points = dataType('postgis/points', {
      listCast: { of: [SQL_EXPRESSION_DATA_TYPE_ID], cast: (elements) => elements },
    });
    expect(() => createSqlFamilyInstance(makeStack([points]))).toThrow(
      expect.objectContaining({ code: 'CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION' }),
    );
  });
});
