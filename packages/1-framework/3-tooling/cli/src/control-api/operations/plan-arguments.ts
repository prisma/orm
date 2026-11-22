/**
 * The arguments `migration plan` takes, derived from where a plan should start and end: the inverse
 * of `resolveFromForPlan` and `resolveToForPlan` in `plan-resolution.ts`. Advice that prints a
 * `migration plan` asks here, so it names only what those resolvers accept.
 */

import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { MigrationGraph } from '@internal/migration-tools/graph';
import {
  historyEndsFrom,
  isGraphNode,
  reconstructGraph,
} from '@internal/migration-tools/migration-graph';
import type { OnDiskMigrationPackage } from '@internal/migration-tools/package';
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

/** What a `migration plan` takes for `--from` and `--to`. */
export interface MigrationPlanArguments {
  readonly from: MigrationPlanArgument;
  readonly to: MigrationPlanTargetArgument;
}

/** The application space as the rules read it: its migration graph and its refs. */
export interface PlanSpace {
  readonly graph: MigrationGraph;
  readonly refs: Refs;
}

/**
 * Where a database is, which decides where a plan for it starts: at the empty contract (no
 * marker), at a contract by its hash, or unknown, for `reason`, when it cannot be read.
 */
export type DatabasePosition =
  | { readonly kind: 'empty' }
  | { readonly kind: 'contract'; readonly hash: string }
  | { readonly kind: 'unknown'; readonly reason: string };

/** Where a plan ends: the emitted contract, a ref, or a recorded contract by its hash. */
export type PlanEnd =
  | { readonly kind: 'emitted' }
  | { readonly kind: 'ref'; readonly name: string }
  | { readonly kind: 'contract'; readonly hash: string };

/** A `--from` or `--to` the user chooses from candidates. */
export type PlanChoice = Extract<MigrationPlanArgument, { readonly kind: 'ambiguous' }>;

function reference(value: string): RunnablePlanArgument {
  return { kind: 'reference', reference: value };
}

/** The names of `refs`, the `db` ref first. */
function refNames(refs: Refs): readonly string[] {
  return Object.keys(refs).sort((a, b) => (a === 'db' ? -1 : b === 'db' ? 1 : a.localeCompare(b)));
}

/** Where the history an empty database replays ends, as `--from` names each end. */
function historyEnds(graph: MigrationGraph): readonly string[] {
  return historyEndsFrom(graph, EMPTY_CONTRACT_HASH).map((end) =>
    end === EMPTY_CONTRACT_HASH ? '@empty' : end,
  );
}

/**
 * The `--from` the user chooses, for `reason`, when where the database is cannot be told: with no
 * migrations, `@empty` or a ref, which `migration plan` baselines; otherwise where the history ends;
 * with the space unread, none named.
 */
export function migrationPlanChoice(space: PlanSpace | undefined, reason: string): PlanChoice {
  const candidates =
    space === undefined
      ? []
      : space.graph.nodes.size === 0
        ? ['@empty', ...refNames(space.refs)]
        : historyEnds(space.graph);
  return { kind: 'ambiguous', reason, candidates };
}

/**
 * The `--from` that makes `migration plan` start where a database at `position` is. A contract a
 * migration records is named by its hash. An empty database starts where its history ends, because
 * a plan from the empty contract would recreate what the existing migrations create; with no
 * migrations, or no migration from the empty contract, it starts at `@empty`. While the space has no
 * migrations, `migration plan` also starts from a ref, which it baselines. Nothing else can be a
 * `--from`.
 */
export function migrationPlanFrom(
  space: PlanSpace,
  position: DatabasePosition,
): MigrationPlanArgument {
  const { graph, refs } = space;
  if (position.kind === 'unknown') return migrationPlanChoice(space, position.reason);
  if (position.kind === 'empty' || position.hash === EMPTY_CONTRACT_HASH) {
    if (graph.nodes.size === 0) return reference('@empty');
    const ends = historyEnds(graph);
    const [onlyEnd] = ends;
    if (ends.length === 1 && onlyEnd !== undefined) return reference(onlyEnd);
    return {
      kind: 'ambiguous',
      reason:
        ends.length === 0
          ? 'The migration history an empty database replays has no end'
          : 'The migration history an empty database replays has more than one end',
      candidates: ends,
    };
  }
  if (isGraphNode(position.hash, graph)) return reference(position.hash);
  if (graph.nodes.size === 0) {
    const [name] = refNames(refs).filter((each) => refs[each]?.hash === position.hash);
    if (name !== undefined) return reference(name);
    return {
      kind: 'none',
      reason: `No ref names contract ${position.hash}, and with no migrations \`migration plan\` starts only from \`@empty\` or a ref`,
    };
  }
  return {
    kind: 'none',
    reason: `No migration records contract ${position.hash}, and \`migration plan\` starts only from a contract a migration records`,
  };
}

/**
 * The `--to` that makes `migration plan` end at `end`: none for the emitted contract, which it
 * targets by default; a ref by its name; a contract a migration records by its hash. It does not
 * plan to the empty contract, or to any other contract no migration records.
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
  if (isGraphNode(end.hash, space.graph)) return reference(end.hash);
  return {
    kind: 'none',
    reason: `No migration records contract ${end.hash}, and \`migration plan --to\` ends only at a contract a migration records, a ref, or the emitted contract`,
  };
}

/**
 * The `--from` that plans a failed migration again after its directory is deleted: the contract it
 * started from, as the rule names it in the graph without that migration.
 */
export function migrationPlanReplacing(
  space: PlanSpace & { readonly packages: readonly OnDiskMigrationPackage[] },
  failed: { readonly from: string; readonly dirName: string },
): MigrationPlanArgument {
  if (failed.from === EMPTY_CONTRACT_HASH) return reference('@empty');
  const graph = reconstructGraph(
    space.packages.filter(({ dirName }) => dirName !== failed.dirName),
  );
  return migrationPlanFrom({ graph, refs: space.refs }, { kind: 'contract', hash: failed.from });
}

/** The `--from` a `migration plan` for the application space takes, for its marker in `markers`. */
export function appMigrationPlanOrigin(
  app: PlanSpace & { readonly spaceId: string },
  markers: ReadonlyMap<string, { readonly storageHash: string } | null>,
): MigrationPlanArgument {
  return migrationPlanFrom(app, databasePositionOf(markers.get(app.spaceId)?.storageHash));
}

/** Where a database whose marker names `markerHash`, or that has none, is. */
export function databasePositionOf(markerHash: string | undefined): DatabasePosition {
  if (markerHash === undefined || markerHash === EMPTY_CONTRACT_HASH) return { kind: 'empty' };
  return { kind: 'contract', hash: markerHash };
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
