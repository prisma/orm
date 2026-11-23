import type { ContractField } from '@prisma/orm-framework/contract/types';

/** What a contract field holds, as messages name it: its codec id, `<codec id> list`, `a value object` or `a union`. */
export function describeFieldType(field: ContractField): string {
  if (field.type.kind === 'valueObject') return 'a value object';
  if (field.type.kind === 'union') return 'a union';
  return field.many ? `${field.type.codecId} list` : field.type.codecId;
}
