/**
 * The tables a schema has, addressed by the contract's namespace ids: the schema a plan starts
 * from, or the schema a migration's earlier renames leave behind.
 */
export interface SchemaTables {
  hasTable(namespaceId: string, table: string): boolean;
  hasColumn(namespaceId: string, table: string, column: string): boolean;
  namespacesWithTable(table: string): readonly string[];
}
