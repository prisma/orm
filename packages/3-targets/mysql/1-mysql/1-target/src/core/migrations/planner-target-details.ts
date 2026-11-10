import { ifDefined } from '@internal/utils/defined';

export type MysqlObjectType = 'table' | 'column' | 'unique' | 'index' | 'foreignKey';

/** What a MySQL migration operation addresses. A MySQL database holds no schemas, so it names none. */
export interface MysqlPlanTargetDetails {
  readonly objectType: MysqlObjectType;
  readonly name: string;
  readonly table?: string;
}

export function buildTargetDetails(
  objectType: MysqlObjectType,
  name: string,
  table?: string,
): MysqlPlanTargetDetails {
  return { objectType, name, ...ifDefined('table', table) };
}
