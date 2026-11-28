import { createSqlOperationsReader } from '@internal/family-sql/control';
import { type } from 'arktype';
import type { PostgresPlanTargetDetails } from './planner-target-details';
import { SchemaContentsJson } from './schema-contents';

export const PostgresTargetDetailsJson = type({
  '+': 'reject',
  'schema?': 'string',
  objectType:
    "'dependency' | 'type' | 'table' | 'column' | 'primaryKey' | 'unique' | 'index' | 'foreignKey' | 'checkConstraint' | 'rlsPolicy' | 'rowLevelSecurity'",
  name: 'string',
  'table?': 'string',
});

export const readPostgresOperations = createSqlOperationsReader<PostgresPlanTargetDetails>({
  targetDetails: PostgresTargetDetailsJson,
  stepMeta: type({ 'schemaContents?': SchemaContentsJson }),
});
