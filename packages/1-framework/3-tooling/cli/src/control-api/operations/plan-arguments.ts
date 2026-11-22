/**
 * The arguments `migration plan` takes, derived from where a plan should start and end: the inverse
 * of `resolveFromForPlan` and `resolveToForPlan` in `plan-resolution.ts`. Advice that prints a
 * `migration plan` from where a database is asks here, so it names only what those resolvers
 * accept. A few messages print a fixed command that always resolves: `--from @empty`, `--from` a
 * ref whose contract a migration records, or no `--from` when there are no migrations.
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

/** What `--to` can be: the target is never left for the user to choose. */
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

/**
 * What deriving a plan's arguments needs from the application space: its migration graph, its
 * refs, and the hash of the contract the run was given, the one contract `migration plan` targets
 * that no migration records.
 */
export interface PlanSpace {
  readonly graph: MigrationGraph;
  readonly refs: Refs;
  readonly emittedHash?: string;
}

/**
 * Where a database is, which decides where a plan for it starts: unmarked (no marker, so empty or
 * not yet adopted), at a contract by its hash, or unknown, for `reason`, when it cannot be read.
 */
export type DatabasePosition =
  | { readonly kind: 'unmarked' }
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

/** Where the history that continues from `hash` ends, as `--from` names each end. */
function historyEnds(graph: MigrationGraph, hash: string = EMPTY_CONTRACT_HASH): readonly string[] {
  return historyEndsFrom(graph, hash).map((end) => (end === EMPTY_CONTRACT_HASH ? '@empty' : end));
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

/** Why a database with no marker in a space with no migrations gets a plan from `@empty` only as a choice. */
const NO_MARKER_REASON =
  'The database has no marker, so a plan from `@empty` fits only an empty database. A database that is not empty needs adopting first: emit the contract that describes it as it is, before your change, and record it with `{bin} db sign`, then plan from there';

/**
 * The `--from` that makes `migration plan` start where a database at `position` is. A contract a
 * migration records is named by its hash. An empty database starts where its history ends, because
 * a plan from the empty contract would recreate what the existing migrations create; with no
 * migration from the empty contract it starts at `@empty`. With no migrations, a database with no
 * marker may be empty or may need adopting, so the plan from `@empty` is a choice; a database at a
 * contract a ref names starts from the ref, which `migration plan` baselines.
 */
function startAtPosition(space: PlanSpace, position: DatabasePosition): MigrationPlanArgument {
  const { graph, refs } = space;
  if (position.kind === 'unknown') return migrationPlanChoice(space, position.reason);
  if (position.kind === 'unmarked' || position.hash === EMPTY_CONTRACT_HASH) {
    if (graph.nodes.size === 0) {
      return position.kind === 'unmarked'
        ? { kind: 'ambiguous', reason: NO_MARKER_REASON, candidates: ['@empty'] }
        : reference('@empty');
    }
    return startAtEndOf(
      graph,
      EMPTY_CONTRACT_HASH,
      'The migration history an empty database replays',
    );
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

/** Where the history that continues from `hash` ends: the one end, or a choice of them. */
function startAtEndOf(graph: MigrationGraph, hash: string, history: string): MigrationPlanArgument {
  const ends = historyEnds(graph, hash);
  const [onlyEnd] = ends;
  if (ends.length === 1 && onlyEnd !== undefined) return reference(onlyEnd);
  return {
    kind: 'ambiguous',
    reason: `${history} has more than one end`,
    candidates: ends,
  };
}

/**
 * The `--to` that makes `migration plan` end at `end`: none for the emitted contract, which it
 * targets by default, nor for a contract hash that is the one the run was given; a ref by its name;
 * a contract a migration records by its hash. It does not plan to the empty contract, by its hash or
 * a ref, or to any other contract no migration records.
 */
export function migrationPlanTo(space: PlanSpace, end: PlanEnd): MigrationPlanTargetArgument {
  if (end.kind === 'emitted') return { kind: 'default' };
  const hash = end.kind === 'ref' ? space.refs[end.name]?.hash : end.hash;
  if (hash === EMPTY_CONTRACT_HASH) {
    return {
      kind: 'none',
      reason: '`migration plan` does not plan a migration to the empty contract',
    };
  }
  if (end.kind === 'ref') return reference(end.name);
  if (isGraphNode(end.hash, space.graph)) return reference(end.hash);
  if (end.hash === space.emittedHash) return { kind: 'default' };
  return {
    kind: 'none',
    reason: `No migration records contract ${end.hash}, and \`migration plan --to\` ends only at a contract a migration records, a ref, or the emitted contract`,
  };
}

/**
 * The `--from` and `--to` of the `migration plan` that takes a database at `position` to `end`. To
 * a contract the history records, the plan leaves from where the database is. To the emitted
 * contract, a new one, it extends the history: it starts where the history that continues from the
 * database's contract ends, so `db migrate` applies the migrations after it and then the new one,
 * and the plan forks nothing.
 */
export function migrationPlanArguments(
  space: PlanSpace,
  position: DatabasePosition,
  end: PlanEnd,
): MigrationPlanArguments {
  const to = migrationPlanTo(space, end);
  const extendsHistory =
    to.kind === 'default' &&
    position.kind === 'contract' &&
    position.hash !== EMPTY_CONTRACT_HASH &&
    isGraphNode(position.hash, space.graph);
  return {
    from: extendsHistory
      ? startAtEndOf(
          space.graph,
          position.hash,
          'The migration history that continues from where the database is',
        )
      : startAtPosition(space, position),
    to,
  };
}

const EMPTY_ORIGIN_STATEMENTS =
  'A plan from `@empty` creates every model, so its statements name nothing it can resolve';

/**
 * `from` for a plan that carries `--rename`, `--delete`, `--convert` or `--backfill`: such a plan
 * cannot start at `@empty`, so that start is dropped, and with no start left there is no plan.
 */
export function migrationPlanFromForStatements(from: MigrationPlanArgument): MigrationPlanArgument {
  if (from.kind === 'reference' && from.reference === '@empty') {
    return { kind: 'none', reason: EMPTY_ORIGIN_STATEMENTS };
  }
  if (from.kind !== 'ambiguous' || !from.candidates.includes('@empty')) return from;
  const candidates = from.candidates.filter((candidate) => candidate !== '@empty');
  return candidates.length === 0
    ? { kind: 'none', reason: `${from.reason}. ${EMPTY_ORIGIN_STATEMENTS}` }
    : { ...from, candidates };
}

/**
 * The `--from` that plans a failed migration again after its directory is deleted: the contract it
 * started from, as `--from` names it in the graph without that migration.
 */
export function migrationPlanReplacing(
  space: PlanSpace & { readonly packages: readonly OnDiskMigrationPackage[] },
  failed: { readonly from: string; readonly dirName: string },
): MigrationPlanArgument {
  if (failed.from === EMPTY_CONTRACT_HASH) return reference('@empty');
  const graph = reconstructGraph(
    space.packages.filter(({ dirName }) => dirName !== failed.dirName),
  );
  return startAtPosition({ graph, refs: space.refs }, { kind: 'contract', hash: failed.from });
}

/** The `migration plan` for the application space's database, at its marker in `markers`, to `end`. */
export function appMigrationPlan(
  app: PlanSpace & { readonly spaceId: string },
  markers: ReadonlyMap<string, { readonly storageHash: string } | null>,
  end: PlanEnd,
): MigrationPlanArguments {
  return migrationPlanArguments(
    app,
    databasePositionOf(markers.get(app.spaceId)?.storageHash),
    end,
  );
}

/** Where a database whose marker names `markerHash`, or that has none, is. */
export function databasePositionOf(markerHash: string | undefined): DatabasePosition {
  if (markerHash === undefined) return { kind: 'unmarked' };
  return { kind: 'contract', hash: markerHash };
}

/** The application space of `aggregate`, as a {@link PlanSpace}. */
export function appSpaceOf(aggregate: {
  readonly app: {
    readonly spaceId: string;
    readonly refs: Refs;
    graph(): MigrationGraph;
    contract(): { readonly storage: { readonly storageHash: string } };
  };
}): PlanSpace & { readonly spaceId: string } {
  return {
    spaceId: aggregate.app.spaceId,
    graph: aggregate.app.graph(),
    refs: aggregate.app.refs,
    emittedHash: aggregate.app.contract().storage.storageHash,
  };
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
