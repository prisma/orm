import { qualifiedEnumName } from './data-types';

/**
 * The type columns introspection reads for one column: `format_type(atttypid, atttypmod)` and the
 * `information_schema.columns` type fields.
 */
export interface CatalogColumnType {
  readonly formattedType: string | null;
  /** `information_schema.columns.data_type`. */
  readonly informationSchemaType: string;
  readonly udtName: string;
  readonly characterMaximumLength: number | null;
  readonly numericPrecision: number | null;
  readonly numericScale: number | null;
  /** The enum the column, or each of its elements, is typed by. */
  readonly enumType?: { readonly schema: string; readonly name: string };
}

export interface IntrospectedTypeText {
  /** The column's type as the database reports it, or an enum's name as a contract writes it; for an array column, its element type. */
  readonly typeText: string;
  readonly many: true | undefined;
}

/** The type introspection reports for a column, from its catalog type columns. */
export function introspectedTypeText(column: CatalogColumnType): IntrospectedTypeText {
  const reported = reportedTypeText(column);
  const many = reported.endsWith('[]') ? true : undefined;
  const typeText =
    column.enumType !== undefined
      ? qualifiedEnumName(column.enumType)
      : many
        ? reported.slice(0, -2)
        : reported;
  return { typeText, many };
}

function reportedTypeText(column: CatalogColumnType): string {
  if (column.formattedType) return column.formattedType;
  if (
    column.informationSchemaType === 'character varying' ||
    column.informationSchemaType === 'character'
  ) {
    return column.characterMaximumLength
      ? `${column.informationSchemaType}(${column.characterMaximumLength})`
      : column.informationSchemaType;
  }
  if (column.informationSchemaType === 'numeric' || column.informationSchemaType === 'decimal') {
    if (column.numericPrecision && column.numericScale !== null) {
      return `${column.informationSchemaType}(${column.numericPrecision},${column.numericScale})`;
    }
    return column.numericPrecision
      ? `${column.informationSchemaType}(${column.numericPrecision})`
      : column.informationSchemaType;
  }
  return column.udtName || column.informationSchemaType;
}
