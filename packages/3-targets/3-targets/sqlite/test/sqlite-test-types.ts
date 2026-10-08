import { createDataTypeLookup } from '@internal/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { SqlTypeLookups } from '@internal/sql-contract/data-type';
import { createSqliteBuiltinCodecLookup } from '../src/core/codec-registry';
import { sqliteDataTypes } from '../src/core/data-types';
import { sqliteCodecDescriptorRegistry } from '../src/core/registry';

export const sqliteTestTypes: SqlTypeLookups = {
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
