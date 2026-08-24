import { getTestAggregates } from './helpers';
/**
 * The plans and the reader the JSON-projection tests share.
 *
 * `representativePlans` is consumed on both sides of the projection seam: the
 * emission assertions beside this file read the variants out of the plan, and
 * the renderer tests in `integration-tests` render the same plans
 * to SQL. It lives in a helper rather than in either test so neither imports
 * the other's suites.
 */

import {
  type AnyJsonValueProjection,
  CodecJsonValueProjection,
  DerivedTableSource,
  JsonArrayAggExpr,
  JsonObjectExpr,
  type SelectAst,
  SubqueryExpr,
} from '@internal/sql-relational-core/ast';
import { compileSelectWithIncludes } from '../src/query-plan-select';
import { baseContract, createCollection, createCollectionFor } from './collection-fixtures';

/** The contract the representative plans are compiled and rendered against. */
export const planContract = baseContract;

/**
 * Representative plans, one per shape that emits JSON entries: a plain
 * include, a nested include, an aggregate include, a combine, an include
 * carrying `distinct` (the ROW_NUMBER-ranked path), and a distinct non-leaf
 * include (the ranked path with grandchildren attached).
 */
export function representativePlans(): ReadonlyArray<readonly [string, SelectAst]> {
  const { collection: users } = createCollection();
  const { collection: projects } = createCollectionFor('Project');
  const cases = [
    ['plain include', 'users', users.include('posts').state],
    ['nested include', 'users', users.include('posts', (posts) => posts.include('comments')).state],
    ['aggregate include', 'users', users.include('posts', (posts) => posts.count()).state],
    [
      'aggregate include over a column',
      'users',
      users.include('posts', (posts) => posts.sum('views')).state,
    ],
    [
      'combine of a row branch and a scalar branch',
      'users',
      users.include('posts', (posts) =>
        posts.combine({
          recent: posts.orderBy((post) => post.id.desc()).limit(3),
          total: posts.count(),
        }),
      ).state,
    ],
    [
      'include with distinct',
      'users',
      users.include('posts', (posts) => posts.distinct('title')).state,
    ],
    [
      'distinct non-leaf include',
      'users',
      users.include('posts', (posts) => posts.distinct('title').include('comments')).state,
    ],
    ['many-to-many include', 'users', users.include('tags').state],
    ['self-relation many-to-many include', 'projects', projects.include('related').state],
  ] as const;

  return cases.map(([label, table, state]) => {
    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      table,
      state,
    );
    return [label, plan.ast as SelectAst] as const;
  });
}

/**
 * The SQLite arm needs a SQLite-flavoured contract of its own: the ORM
 * fixtures are PostgreSQL, and an adapter resolves codecs out of the contract
 * it is handed.
 */
/**
 * Every JSON entry a plan emits, as `<key>:<variant>` — plus the codec id
 * where the variant is `codec`, since a codec entry naming the wrong codec is
 * as wrong as the wrong variant. `json_agg`'s aggregated element has no key of
 * its own and reads as `[]`.
 */
export function jsonEntriesOf(ast: SelectAst): string[] {
  const found: string[] = [];

  const describeProjection = (key: string, projection: AnyJsonValueProjection): void => {
    found.push(
      projection instanceof CodecJsonValueProjection
        ? `${key}:codec(${projection.codec.codecId})`
        : `${key}:${projection.kind}`,
    );
    walkExpr(projection.value);
  };

  function walkExpr(expr: unknown): void {
    if (expr instanceof JsonObjectExpr) {
      for (const entry of expr.entries) describeProjection(entry.key, entry.value);
      return;
    }
    if (expr instanceof JsonArrayAggExpr) {
      describeProjection('[]', expr.expr);
      return;
    }
    if (expr instanceof SubqueryExpr) {
      walkSelect(expr.query);
    }
  }

  function walkSelect(select: SelectAst): void {
    for (const item of select.projection) walkExpr(item.expr);
    if (select.from instanceof DerivedTableSource) walkSelect(select.from.query);
    for (const join of select.joins ?? []) {
      if (join.source instanceof DerivedTableSource) walkSelect(join.source.query);
    }
  }

  walkSelect(ast);
  return found;
}

// The pack publishes its descriptors as framework ones; the PostgreSQL adapter
// takes the PostgreSQL-capable subset, which the target's own predicate picks
// out without a cast.
