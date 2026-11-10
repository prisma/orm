import { TableSource } from '@internal/sql-relational-core/ast';

export function tableSourceForProxy(
  tableName: string,
  alias: string,
  namespaceId: string,
): TableSource {
  return TableSource.named(tableName, alias !== tableName ? alias : undefined, namespaceId);
}
