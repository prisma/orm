/**
 * The tables a schema has, addressed by the contract's namespace ids: the schema a plan starts
 * from, or the schema a migration's earlier renames leave behind.
 */
export interface SchemaTables {
  hasTable(namespaceId: string, table: string): boolean;
  hasColumn(namespaceId: string, table: string, column: string): boolean;
  /**
   * The namespace's tables the database takes for `table`: the table itself where names compare
   * exactly, and every table whose name differs only in case where the database ignores case.
   */
  tablesNamed(namespaceId: string, table: string): readonly string[];
  /**
   * The table's columns the database takes for `column`: the column itself where names compare
   * exactly, and every column whose name differs only in case where the database ignores case.
   */
  columnsNamed(namespaceId: string, table: string, column: string): readonly string[];
  namespacesWithTable(table: string): readonly string[];
}
