import type { ReportedSqlType } from '@internal/sql-schema-ir/types';

/** The catalog facts of a column's element type: `format_type`, `pg_type.typtype`, `pg_namespace.nspname`, `pg_type.typname`. */
export interface CatalogElementType {
  readonly text: string;
  readonly typtype: string;
  readonly schema: string;
  readonly name: string;
}

const KIND_OF_TYPTYPE: Readonly<Record<string, string>> = {
  e: 'enum',
  d: 'domain',
  c: 'composite',
  r: 'range',
  m: 'multirange',
};

function quotedIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function withoutSchemaPrefix(text: string, schema: string): string {
  for (const prefix of [`${schema}.`, `${quotedIdentifier(schema)}.`]) {
    if (text.startsWith(prefix)) return text.slice(prefix.length);
  }
  return text;
}

/**
 * The column's element type as Postgres reports it. A base type outside `pg_catalog` loses the
 * schema `format_type` prints when that schema is off the search path, so a type an extension
 * installs in another schema, as Supabase installs `vector`, reads as it does in `public`.
 */
export function reportedSqlType(element: CatalogElementType): ReportedSqlType {
  const kind = KIND_OF_TYPTYPE[element.typtype];
  const text =
    kind === undefined && element.schema !== 'pg_catalog'
      ? withoutSchemaPrefix(element.text, element.schema)
      : element.text;
  return { text, kind, schema: element.schema, name: element.name };
}
