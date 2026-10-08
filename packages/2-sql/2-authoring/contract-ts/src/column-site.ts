/** Where a column was declared: through a model's field, or directly on a table. Named in the errors its lowering raises. */
export type ColumnSite =
  | { readonly kind: 'field'; readonly modelName: string; readonly fieldName: string }
  | {
      readonly kind: 'column';
      readonly namespaceId: string;
      readonly tableName: string;
      readonly columnName: string;
    };

/** How an error message names the column: `Field "Model.field"` or `Column "table.column"`. */
export function columnSiteSubject(site: ColumnSite): string {
  return site.kind === 'field'
    ? `Field "${site.modelName}.${site.fieldName}"`
    : `Column "${site.tableName}.${site.columnName}"`;
}

/** The error metadata that locates the column. */
export function columnSiteMeta(site: ColumnSite): Record<string, string> {
  return site.kind === 'field'
    ? { modelName: site.modelName, fieldName: site.fieldName }
    : { namespaceId: site.namespaceId, tableName: site.tableName, columnName: site.columnName };
}
