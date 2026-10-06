import type { AnyParamRef, AnyQueryAst, ProjectionItem } from './types';

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

const AGGREGATING_EXPRESSION_KINDS: ReadonlySet<string> = new Set([
  'aggregate',
  'json-array-agg',
  'window-func',
]);

/** Whether a projection item's top-level expression is an aggregate, `json_agg` or window function. Nested expressions are not inspected. */
export function isAggregateProjection(item: ProjectionItem): boolean {
  return AGGREGATING_EXPRESSION_KINDS.has(item.expr.kind);
}
