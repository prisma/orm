/**
 * Where a column or a table reference was declared: by a model, or by a table node. Errors name the declaration the author wrote. A table node is named with its namespace, because only the namespace tells two table nodes of one name apart.
 */

/** The declaration of a column: a model's field, or a table node's column node. */
export type ColumnSite =
  | { readonly kind: 'field'; readonly modelName: string; readonly fieldName: string }
  | {
      readonly kind: 'tableNode';
      readonly namespaceId: string;
      readonly tableName: string;
      readonly columnName: string;
    };

/** The declaration a reference such as a foreign key starts from: a model, or a table node. */
export type ReferenceOwner =
  | { readonly kind: 'model'; readonly modelName: string }
  | { readonly kind: 'tableNode'; readonly namespaceId: string; readonly tableName: string };

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

/** How an error message names the owner: `model "User"` or `table "audit_rows" in namespace "public"`. */
export function referenceOwnerSubject(owner: ReferenceOwner): string {
  return owner.kind === 'model'
    ? `model "${owner.modelName}"`
    : `table "${owner.tableName}" in namespace "${owner.namespaceId}"`;
}

/** The error metadata that locates the owner. */
export function referenceOwnerMeta(owner: ReferenceOwner): Record<string, string> {
  return owner.kind === 'model'
    ? { sourceModel: owner.modelName }
    : { sourceTable: owner.tableName, sourceNamespaceId: owner.namespaceId };
}
