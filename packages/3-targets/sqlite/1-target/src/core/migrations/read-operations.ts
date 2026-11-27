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

/** Releases up to 8.0.0-rc.19 wrote the schema `main` into every operation's details. */
function currentTargetDetails(details: Readonly<Record<string, unknown>>): unknown {
  const { schema, ...current } = details;
  return schema === 'main' ? current : details;
}

export const readSqliteOperations = createSqlOperationsReader<SqlitePlanTargetDetails>({
  targetDetails: SqliteTargetDetailsJson,
  currentTargetDetails,
  stepMeta: type({ 'conversionCopy?': ConversionCopyJson }),
});
