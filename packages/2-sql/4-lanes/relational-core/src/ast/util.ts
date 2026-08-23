import type { AnyParamRef, AnyQueryAst, OrderByItem } from './types';

/**
 * The dialect-independent ` ASC`/` DESC` tail of a rendered order item,
 * including ` NULLS FIRST`/` NULLS LAST` when the item carries an explicit
 * placement. Shared by adapter renderers so the order-suffix grammar cannot
 * drift between targets.
 */
export function renderOrderBySuffix(item: OrderByItem): string {
  const nulls = item.nulls === undefined ? '' : ` NULLS ${item.nulls.toUpperCase()}`;
  return ` ${item.dir.toUpperCase()}${nulls}`;
}

export function compact<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}

/**
 * Walks an AST's parameter references in first-encounter order and dedupes
 * by ParamRef identity. The single canonical helper used by every consumer
 * that aligns `plan.params` with metadata-by-index — the SQL builder lane,
 * the SQL ORM client, the SQL runtime encoder, and the Postgres renderer's
 * `$N` index map — so the four walks cannot drift in dedupe semantics.
 *
 * SQLite's `?`-placeholder renderer intentionally does NOT use this helper
 * because it needs one params entry per occurrence in the SQL.
 */
export function collectOrderedParamRefs(ast: AnyQueryAst): ReadonlyArray<AnyParamRef> {
  const seen = new Set<AnyParamRef>();
  const ordered: AnyParamRef[] = [];
  for (const ref of ast.collectParamRefs()) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    ordered.push(ref);
  }
  return Object.freeze(ordered);
}
