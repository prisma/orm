import type { DataType, TypeLookups } from '@internal/framework-components/codec';
import type { AdapterDescriptor } from '@internal/framework-components/components';
import type { SqlColumnIRInput } from '@internal/sql-schema-ir/types';
import { introspectedColumn as introspectedColumnOver } from '../../../../2-sql-family/1-core/contract/test/introspected-column';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-registry';
import { codecDescriptors } from '../src/core/codecs';
import { createPostgresBuiltinDataTypeLookup, postgresDataTypes } from '../src/core/data-types';

export const postgresTypeLookups: TypeLookups = {
  codecLookup: createPostgresBuiltinCodecLookup(),
  dataTypeLookup: createPostgresBuiltinDataTypeLookup(),
};

const postgresTypesComponent: AdapterDescriptor<'sql', 'postgres'> = {
  kind: 'adapter',
  id: 'postgres-test-types',
  version: '0.0.0-test',
  familyId: 'sql',
  targetId: 'postgres',
  dataTypes: postgresDataTypes,
  types: { codecTypes: { codecDescriptors } },
};

/** Framework components that register the Postgres codecs and data types, for planner and diff tests. */
export const postgresTypeComponents: readonly AdapterDescriptor<'sql', 'postgres'>[] = [
  postgresTypesComponent,
];

/** `column` as introspection builds it, over the Postgres data types unless `dataTypes` names others. */
export function introspectedColumn(
  column: SqlColumnIRInput,
  dataTypes: readonly DataType[] = postgresDataTypes,
): SqlColumnIRInput {
  return introspectedColumnOver(column, dataTypes);
}
