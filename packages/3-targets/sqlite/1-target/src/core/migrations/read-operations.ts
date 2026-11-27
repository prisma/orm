import { createSqlOperationsReader } from '@internal/family-sql/control';
import { type } from 'arktype';
import { ConversionCopyJson } from './operations/tables';
import type { SqlitePlanTargetDetails } from './planner-target-details';

export const SqliteTargetDetailsJson = type({
  '+': 'reject',
  objectType: "'table' | 'column' | 'primaryKey' | 'unique' | 'index' | 'foreignKey'",
  name: 'string',
  'table?': 'string',
  /** Written by releases up to 8.0.0-rc.19, always as `main`. */
  'schema?': "'main'",
});

export const readSqliteOperations = createSqlOperationsReader<SqlitePlanTargetDetails>({
  targetDetails: SqliteTargetDetailsJson,
  stepMeta: type({ 'conversionCopy?': ConversionCopyJson }),
});
