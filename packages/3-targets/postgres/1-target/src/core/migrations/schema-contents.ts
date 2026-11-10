import type { SqlMigrationPlanOperationStep } from '@internal/family-sql/control';
import type { BlockingObject } from '@internal/framework-components/control';
import { type } from 'arktype';

const SchemaContentsMeta = type({ schemaContents: { schema: 'string' } });

/** The meta of a step that fails while a schema still holds objects; the runner then names them. */
export function schemaContentsMeta(schema: string): {
  readonly schemaContents: { readonly schema: string };
} {
  return { schemaContents: { schema } };
}

export function schemaContentsOf(step: SqlMigrationPlanOperationStep): string | undefined {
  const meta = SchemaContentsMeta(step.meta ?? {});
  return meta instanceof type.errors ? undefined : meta.schemaContents.schema;
}

export const SCHEMA_OBJECTS_SQL = `SELECT kind, name FROM (
  SELECT CASE c.relkind
      WHEN 'v' THEN 'view'
      WHEN 'm' THEN 'materialized view'
      WHEN 'S' THEN 'sequence'
      WHEN 'f' THEN 'foreign table'
      WHEN 'c' THEN 'type'
      ELSE 'table'
    END AS kind, c.relname::text AS name
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
  UNION ALL
  SELECT 'type', t.typname::text
  FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = $1 AND t.typrelid = 0 AND t.typelem = 0
  UNION ALL
  SELECT 'function', p.proname::text
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = $1
) AS objects ORDER BY name, kind`;

const NAMED_OBJECTS = 10;

function listed(items: readonly string[]): string {
  if (items.length === 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

const UNQUOTED_IDENTIFIER = /^[a-z_][a-z0-9_$]*$/;

/** An identifier as Postgres writes it in its messages: quoted only where it must be. */
function identifierText(identifier: string): string {
  return UNQUOTED_IDENTIFIER.test(identifier)
    ? identifier
    : `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * The objects a schema query found, each named with its schema as Postgres names objects in its
 * messages, such as a view that depends on a table: the form a blocked drop reports everywhere.
 */
export function schemaBlockingObjects(
  schema: string,
  objects: readonly BlockingObject[],
): readonly BlockingObject[] {
  return objects.map(({ kind, name }) => ({
    kind,
    name: `${identifierText(schema)}.${identifierText(name)}`,
  }));
}

/** What a runner failure says of the objects that keep a schema from being dropped. */
export function schemaObjectsSummary(schema: string, objects: readonly BlockingObject[]): string {
  const named = objects.slice(0, NAMED_OBJECTS).map(({ kind, name }) => `${kind} ${name}`);
  const more = objects.length - named.length;
  const items = more > 0 ? [...named, `${more} more`] : named;
  return `Schema "${schema}" still holds ${listed(items)}, so it cannot be dropped.`;
}
