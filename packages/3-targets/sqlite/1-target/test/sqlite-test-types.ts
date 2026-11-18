import type { DataType, TypeLookups } from '@internal/framework-components/codec';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { SqlColumnIRInput } from '@internal/sql-schema-ir/types';
import { introspectedColumn as introspectedColumnOver } from '../../../../2-sql-family/1-core/contract/test/introspected-column';
import { createSqliteBuiltinCodecLookup } from '../src/core/codec-registry';
import { sqliteDataTypes } from '../src/core/data-types';
import { sqliteCodecDescriptorRegistry } from '../src/core/registry';

export const sqliteTestTypes: TypeLookups = {
  codecLookup: createSqliteBuiltinCodecLookup(),
  dataTypeLookup: createDataTypeLookup(sqliteDataTypes),
};

export const sqliteTestComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'sqlite'>> =
  [
    {
      kind: 'adapter',
      familyId: 'sql',
      targetId: 'sqlite',
      id: 'sqlite-test-types',
      version: '0.0.0',
      dataTypes: sqliteDataTypes,
      types: {
        codecTypes: { codecDescriptors: [...sqliteCodecDescriptorRegistry.values()] },
      },
    },
  ];

/** `column` as introspection builds it, over the SQLite data types unless `dataTypes` names others. */
export function introspectedColumn(
  column: SqlColumnIRInput,
  dataTypes: readonly DataType[] = sqliteDataTypes,
): SqlColumnIRInput {
  return introspectedColumnOver(column, dataTypes);
}
