/**
 * The arguments `migration plan` takes, derived from where a plan should start and end: the inverse
 * of `resolveFromForPlan` and `resolveToForPlan` in `plan-resolution.ts`. Advice that prints a
 * `migration plan` asks here, so it names only what those resolvers accept.
 */

import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { MigrationGraph } from '@internal/migration-tools/graph';
import { historyEndsFrom, isGraphNode } from '@internal/migration-tools/migration-graph';
import type { Refs } from '@internal/migration-tools/refs';
import type { FromResolution } from './plan-resolution';

/**
 * What `migration plan` takes for `--from` or `--to`:
 * - `reference`: a contract reference it resolves (a hash, a ref name, or `@empty`);
 * - `default`: leave the flag out;
 * - `ambiguous`: the user has to choose, for `reason`, from `candidates` when they are known;
 * - `none`: no value makes `migration plan` start or end there, for `reason`.
 */
export type MigrationPlanArgument =
  | { readonly kind: 'reference'; readonly reference: string }
  | { readonly kind: 'default' }
  | {
      readonly kind: 'ambiguous';
      readonly reason: string;
      readonly candidates: readonly string[];
    }
  | { readonly kind: 'none'; readonly reason: string };

/** What `--to` can be: no rule leaves the target for the user to choose. */
export type MigrationPlanTargetArgument = Exclude<
  MigrationPlanArgument,
  { readonly kind: 'ambiguous' }
>;

/** A value `migration plan` resolves as printed. */
export type RunnablePlanArgument = Extract<
  MigrationPlanArgument,
  { readonly kind: 'reference' | 'default' }
>;

/** The application space as the rules read it: its migration graph and its refs. */
export interface PlanSpace {
  readonly graph: MigrationGraph;
  readonly refs: Refs;
}

/** Where a plan starts: the empty contract (a database with no marker), or a contract by its hash. */
export type PlanStart =
  | { readonly kind: 'empty' }
  | { readonly kind: 'contract'; readonly hash: string };

/** Where a plan ends: the emitted contract, a ref, or a contract by its hash. */
export type PlanEnd =
  | { readonly kind: 'emitted' }
  | { readonly kind: 'ref'; readonly name: string }
  | { readonly kind: 'contract'; readonly hash: string };

export function reference(value: string): RunnablePlanArgument {
  return { kind: 'reference', reference: value };
}

/**
 * The `--from` that makes `migration plan` start at `start`. A contract a migration records is
 * named by its hash. An empty database starts where its history ends, because a plan from the
 * empty contract would recreate what the existing migrations create; with no migrations, or no
 * migration from the empty contract, it starts at `@empty`. While the space has no migrations,
 * `migration plan` also starts from a ref, which it baselines. Nothing else can be a `--from`.
 */
export function migrationPlanFrom(space: PlanSpace, start: PlanStart): MigrationPlanArgument {
  const { graph, refs } = space;
  if (start.kind === 'empty' || start.hash === EMPTY_CONTRACT_HASH) {
    if (graph.nodes.size === 0) return reference('@empty');
    const ends = historyEndsFrom(graph, EMPTY_CONTRACT_HASH);
    const [onlyEnd] = ends;
    if (ends.length === 1 && onlyEnd !== undefined) {
      return reference(onlyEnd === EMPTY_CONTRACT_HASH ? '@empty' : onlyEnd);
    }
    return {
      kind: 'ambiguous',
      reason:
        ends.length === 0
          ? 'The migration history an empty database replays has no end'
          : 'The migration history an empty database replays has more than one end',
      candidates: ends,
    };
  }
  if (isGraphNode(start.hash, graph)) return reference(start.hash);
  if (graph.nodes.size === 0) {
    const names = Object.keys(refs)
      .filter((name) => refs[name]?.hash === start.hash)
      .sort((a, b) => (a === 'db' ? -1 : b === 'db' ? 1 : a.localeCompare(b)));
    if (names[0] !== undefined) return reference(names[0]);
  }
  return {
    kind: 'none',
    reason: `No migration records contract ${start.hash}, and \`migration plan\` starts only from a contract a migration records`,
  };
}

/**
 * The `--to` that makes `migration plan` end at `end`: none for the emitted contract, which it
 * targets by default; a ref by its name; a contract a migration records by its hash. Any other
 * hash can only be the emitted contract. `migration plan` does not plan to the empty contract.
 */
export function migrationPlanTo(space: PlanSpace, end: PlanEnd): MigrationPlanTargetArgument {
  if (end.kind === 'emitted') return { kind: 'default' };
  if (end.kind === 'ref') return reference(end.name);
  if (end.hash === EMPTY_CONTRACT_HASH) {
    return {
      kind: 'none',
      reason: '`migration plan` does not plan a migration to the empty contract',
    };
  }
  return isGraphNode(end.hash, space.graph) ? reference(end.hash) : { kind: 'default' };
}

/** The `--from` a `migration plan` for the application space takes, for its marker in `markers`. */
export function appMigrationPlanOrigin(
  app: PlanSpace & { readonly spaceId: string },
  markers: ReadonlyMap<string, { readonly storageHash: string } | null>,
): MigrationPlanArgument {
  return migrationPlanFrom(app, databasePlanStart(markers.get(app.spaceId)?.storageHash));
}

/** The start of a plan for a database whose marker names `markerHash`, or that has none. */
export function databasePlanStart(markerHash: string | undefined): PlanStart {
  return markerHash === undefined ? { kind: 'empty' } : { kind: 'contract', hash: markerHash };
}

/** The application space of `aggregate` as the rules read it. */
export function appSpaceOf(aggregate: {
  readonly app: {
    readonly spaceId: string;
    readonly refs: Refs;
    graph(): MigrationGraph;
  };
}): PlanSpace & { readonly spaceId: string } {
  return { spaceId: aggregate.app.spaceId, graph: aggregate.app.graph(), refs: aggregate.app.refs };
}

/**
 * The `--from` that makes `migration plan` start where a run of it started: the `--from` it was
 * given, or the origin it resolved by default, which is `@empty`, the `db` ref it baselined from, or
 * the hash the `db` ref names.
 */
export function migrationPlanFromRun(
  optionsFrom: string | undefined,
  resolution: FromResolution,
): RunnablePlanArgument {
  if (optionsFrom !== undefined) return reference(optionsFrom);
  switch (resolution.kind) {
    case 'greenfield':
      return reference('@empty');
    case 'auto-baseline':
      return reference('db');
    case 'graph-node':
    case 'ref':
      return reference(resolution.fromHash);
  }
}
