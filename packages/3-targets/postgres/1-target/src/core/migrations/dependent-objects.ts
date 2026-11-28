import type { SqlMigrationPlanOperationStep } from '@internal/family-sql/control';
import type { BlockingObject } from '@internal/framework-components/control';
import { type } from 'arktype';
import type { PostgresPlanTargetDetails } from './planner-target-details';

/** Postgres's error code for a statement that would remove an object others depend on. */
export const DEPENDENT_OBJECTS_STILL_EXIST = '2BP01';

const DEPENDENCY_LINE = /^(.+) (\S+) depends on /;

/** The objects Postgres's error detail says depend on what the statement removes. */
export function dependentsOf(detail: string | undefined): readonly BlockingObject[] {
  return (detail ?? '').split('\n').flatMap((line) => {
    const match = DEPENDENCY_LINE.exec(line.trim());
    const [, kind, name] = match ?? [];
    return kind === undefined || name === undefined ? [] : [{ kind, name }];
  });
}

function listed(items: readonly string[]): string {
  if (items.length === 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** What a runner failure says when objects the contract does not know depend on what an operation removes. */
export function dependentsSummary(
  details: PostgresPlanTargetDetails,
  label: string,
  dependents: readonly BlockingObject[],
): string {
  const named = listed(dependents.map(({ kind, name }) => `${kind} ${name}`));
  const depend = dependents.length === 1 ? 'depends' : 'depend';
  return details.objectType === 'table' && details.table === undefined
    ? `Table "${details.schema}"."${details.name}" cannot be dropped while ${named} ${depend} on it.`
    : `${label} cannot run while ${named} ${depend} on what it changes.`;
}

/** What a step's `meta.tableDependents` holds in an `ops.json`: the table whose dependents the runner names when the step fails. */
export const TableDependentsJson = type({ '+': 'reject', schema: 'string', table: 'string' });

const TableDependentsMeta = type({ tableDependents: TableDependentsJson });

/** The table a step checks has no dependents, from its meta; when the check fails, the runner names them. */
export function tableDependentsOf(
  step: SqlMigrationPlanOperationStep,
): { readonly schema: string; readonly table: string } | undefined {
  const meta = TableDependentsMeta(step.meta ?? {});
  return meta instanceof type.errors ? undefined : meta.tableDependents;
}

/**
 * The objects that keep `DROP TABLE` without `CASCADE` from dropping table `$2` in schema `$1`: those that depend normally on the table, on its row type or on the array type of its rows, outside the table itself. Each comes back as the kind and the schema-qualified name PostgreSQL's `pg_identify_object` gives it. A view is named, not its rewrite rule.
 */
export const TABLE_DEPENDENTS_SQL = `WITH "table" AS (
  SELECT c.oid, c.reltype, t.typarray
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_type t ON t.oid = c.reltype
  WHERE n.nspname = $1 AND c.relname = $2
)
SELECT DISTINCT o.type AS "kind", o.identity AS "name"
FROM pg_catalog.pg_depend d
JOIN "table" t
  ON (d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = t.oid)
  OR (d.refclassid = 'pg_catalog.pg_type'::regclass AND d.refobjid IN (t.reltype, t.typarray))
LEFT JOIN pg_catalog.pg_rewrite r ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND r.oid = d.objid
CROSS JOIN LATERAL pg_catalog.pg_identify_object(
  CASE WHEN r.oid IS NULL THEN d.classid ELSE 'pg_catalog.pg_class'::regclass END,
  COALESCE(r.ev_class, d.objid),
  CASE WHEN r.oid IS NULL THEN d.objsubid ELSE 0 END
) o
WHERE d.deptype = 'n' AND NOT (d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = t.oid)
ORDER BY 1, 2`;
