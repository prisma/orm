import { createSqlOperationsReader } from '@internal/family-sql/control';
import { type } from 'arktype';
import { ConversionCopyJson } from './operations/tables';
import type { SqlitePlanTargetDetails } from './planner-target-details';

export const SqliteTargetDetailsJson = type({
  '+': 'reject',
  objectType: "'table' | 'column' | 'primaryKey' | 'unique' | 'index' | 'foreignKey'",
  name: 'string',
  'table?': 'string',
});

export const readSqliteOperations = createSqlOperationsReader<SqlitePlanTargetDetails>({
  targetDetails: SqliteTargetDetailsJson,
  stepMeta: type({ 'conversionCopy?': ConversionCopyJson }),
});
