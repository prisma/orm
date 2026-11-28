import { createSqlOperationsReader } from '@internal/family-sql/control';
import { type } from 'arktype';
import type { MysqlPlanTargetDetails } from './planner-target-details';

export const MysqlTargetDetailsJson = type({
  '+': 'reject',
  objectType: "'table' | 'column' | 'unique' | 'index' | 'foreignKey'",
  name: 'string',
  'table?': 'string',
});

export const readMysqlOperations = createSqlOperationsReader<MysqlPlanTargetDetails>({
  targetDetails: MysqlTargetDetailsJson,
});
