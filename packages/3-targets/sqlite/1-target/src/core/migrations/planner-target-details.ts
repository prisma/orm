import { ifDefined } from '@internal/utils/defined';

export type OperationClass = 'table' | 'column' | 'primaryKey' | 'unique' | 'index' | 'foreignKey';

export interface SqlitePlanTargetDetails {
  readonly objectType: OperationClass;
  readonly name: string;
  readonly table?: string;
}

export interface PlanningMode {
  readonly includeExtraObjects: boolean;
  readonly allowWidening: boolean;
  readonly allowDestructive: boolean;
}

export function buildTargetDetails(
  objectType: OperationClass,
  name: string,
  table?: string,
): SqlitePlanTargetDetails {
  return {
    objectType,
    name,
    ...ifDefined('table', table),
  };
}
