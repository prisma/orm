import type { Contract } from '@internal/contract/types';
import {
  type AggregateContractSpace,
  createAggregateContractSpace,
} from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { OnDiskMigrationPackage } from '@internal/migration-tools/package';
import type { Refs } from '@internal/migration-tools/refs';
import { describe, expect, it, vi } from 'vitest';
import {
  type DatabasePosition,
  type MigrationPlanArgument,
  migrationPlanArguments,
  migrationPlanChoice,
  migrationPlanFromRun,
  migrationPlanReplacing,
  migrationPlanTo,
  type PlanEnd,
} from '../../src/control-api/operations/plan-arguments';
import {
  type FromResolution,
  resolveFromForPlan,
  resolveToForPlan,
} from '../../src/control-api/operations/plan-resolution';

const E = EMPTY_CONTRACT_HASH;
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const OFF_GRAPH = 'd'.repeat(64);

let counter = 0;

function pkg(from: string, to: string): OnDiskMigrationPackage {
  counter += 1;
  const dirName = `2026010${counter}T0000_m${counter}`;
  return {
    dirName,
    dirPath: `/migrations/app/${dirName}`,
    metadata: {
      from: from === E ? null : from,
      to,
      migrationHash: `mig-${counter.toString().padStart(64, '0')}`,
      createdAt: `2026-03-01T09:00:00.${counter.toString().padStart(3, '0')}Z`,
      providedInvariants: [],
    },
    ops: [],
  };
}

/** A space whose contracts all resolve, as a ref's or a migration's, so only the rules decide. */
function space(packages: readonly OnDiskMigrationPackage[], refs: Refs = {}) {
  const created = createAggregateContractSpace({
    spaceId: 'app',
    packages,
    refs,
    headRef: null,
    refsDir: '/project/migrations/refs',
    migrationsDir: '/project/migrations',
    resolveContract: () => ({ storage: { storageHash: C } }) as Contract,
    deserializeContract: (json) => json as Contract,
  });
  vi.spyOn(created, 'contractAt').mockImplementation((async (
    hash: string,
    opts?: { readonly refName?: string },
  ) => ({
    hash,
    contract: { storage: { storageHash: hash } } as Contract,
    contractJson: {},
    contractDts: '',
    provenance: opts?.refName === undefined ? 'graph-node' : 'ref',
  })) as AggregateContractSpace['contractAt']);
  return created;
}

function rulesSpace(aggregateSpace: AggregateContractSpace) {
  return { graph: aggregateSpace.graph(), refs: aggregateSpace.refs };
}

/** Where `migration plan --from <argument>` starts, as its resolver reads it. */
async function resolvedStart(
  aggregateSpace: AggregateContractSpace,
  argument: MigrationPlanArgument,
): Promise<string | null> {
  if (argument.kind !== 'reference') throw new Error(`not a reference: ${argument.kind}`);
  const resolved = await resolveFromForPlan({
    optionsFrom: argument.reference,
    space: aggregateSpace,
  });
  if (!resolved.ok) throw resolved.failure;
  return resolved.value.fromHash;
}

const ref = (hash: string) => ({ hash, invariants: [] });

/** The `--from` the rule names for a database at `position`, for a plan to the emitted contract unless `end` says otherwise. */
function fromOf(
  aggregateSpace: AggregateContractSpace,
  position: DatabasePosition,
  end: PlanEnd = { kind: 'emitted' },
): MigrationPlanArgument {
  return migrationPlanArguments(rulesSpace(aggregateSpace), position, end).from;
}

describe('migrationPlanArguments names a --from migration plan resolves to the intended start', () => {
  it.each<{
    readonly name: string;
    readonly packages: () => readonly OnDiskMigrationPackage[];
    readonly refs?: Refs;
    readonly start: DatabasePosition;
    readonly end?: PlanEnd;
    readonly startsAt: string | null;
  }>([
    {
      name: 'a contract a migration records, for a plan to a recorded contract',
      packages: () => [pkg(E, A), pkg(A, B)],
      start: { kind: 'contract', hash: A },
      end: { kind: 'contract', hash: B },
      startsAt: A,
    },
    {
      name: 'a database behind its history, for a plan to the emitted contract: where the history continues to',
      packages: () => [pkg(E, A), pkg(A, B)],
      start: { kind: 'contract', hash: A },
      startsAt: B,
    },
    {
      name: 'an empty database, from where its history ends',
      packages: () => [pkg(E, A), pkg(A, B)],
      start: { kind: 'unmarked' },
      startsAt: B,
    },
    {
      name: 'an empty database whose history starts at a baseline',
      packages: () => [pkg(A, B)],
      start: { kind: 'unmarked' },
      startsAt: null,
    },
    {
      name: 'a contract only a ref records, while the space has no migrations',
      packages: () => [],
      refs: { staging: ref(OFF_GRAPH), db: ref(OFF_GRAPH) },
      start: { kind: 'contract', hash: OFF_GRAPH },
      startsAt: OFF_GRAPH,
    },
  ])('$name', async ({ packages, refs, start, end, startsAt }) => {
    const aggregateSpace = space(packages(), refs);
    expect(await resolvedStart(aggregateSpace, fromOf(aggregateSpace, start, end))).toBe(startsAt);
  });

  it('offers @empty only as a choice for a database with no marker and no migrations, which may need adopting', async () => {
    const aggregateSpace = space([]);
    const argument = fromOf(aggregateSpace, { kind: 'unmarked' });
    expect(argument).toMatchObject({
      kind: 'ambiguous',
      candidates: ['@empty'],
      reason: expect.stringContaining('`{bin} db sign`'),
    });
    expect(await resolvedStart(aggregateSpace, { kind: 'reference', reference: '@empty' })).toBe(
      null,
    );
  });

  it('gives a database behind a history with two ends the choice of both', () => {
    const aggregateSpace = space([pkg(E, A), pkg(A, B), pkg(A, C)]);
    expect(fromOf(aggregateSpace, { kind: 'contract', hash: A })).toEqual({
      kind: 'ambiguous',
      reason:
        'The migration history that continues from where the database is has more than one end',
      candidates: [B, C],
    });
  });

  it('names each end of a history that has several, each of which resolves', async () => {
    const aggregateSpace = space([pkg(E, A), pkg(A, B), pkg(A, C)]);
    const argument = fromOf(aggregateSpace, { kind: 'unmarked' });
    if (argument.kind !== 'ambiguous') throw new Error(`expected a choice, got ${argument.kind}`);
    expect(argument.candidates).toEqual([B, C]);
    for (const candidate of argument.candidates) {
      expect(await resolvedStart(aggregateSpace, { kind: 'reference', reference: candidate })).toBe(
        candidate,
      );
    }
  });

  it('names none for a contract nothing records, which migration plan refuses', async () => {
    const aggregateSpace = space([pkg(E, A)], { db: ref(OFF_GRAPH) });
    expect(fromOf(aggregateSpace, { kind: 'contract', hash: OFF_GRAPH })).toMatchObject({
      kind: 'none',
    });
    const resolved = await resolveFromForPlan({ optionsFrom: OFF_GRAPH, space: aggregateSpace });
    expect(resolved.ok).toBe(false);
  });
});

describe('the choice where the database is cannot be read names --from values migration plan resolves', () => {
  it.each<{
    readonly name: string;
    readonly packages: () => readonly OnDiskMigrationPackage[];
    readonly refs?: Refs;
    readonly candidates: readonly string[];
  }>([
    {
      name: 'with no migrations: the empty database and each ref',
      packages: () => [],
      refs: { staging: ref(OFF_GRAPH), db: ref(A) },
      candidates: ['@empty', 'db', 'staging'],
    },
    {
      name: 'with migrations: where the history ends',
      packages: () => [pkg(E, A), pkg(A, B), pkg(A, C)],
      candidates: [B, C],
    },
    {
      name: 'with a history that starts at a baseline: the empty database',
      packages: () => [pkg(A, B)],
      candidates: ['@empty'],
    },
  ])('$name', async ({ packages, refs, candidates }) => {
    const aggregateSpace = space(packages(), refs);
    const argument = fromOf(aggregateSpace, { kind: 'unknown', reason: 'Unread' });
    expect(argument).toEqual({ kind: 'ambiguous', reason: 'Unread', candidates });
    for (const candidate of candidates) {
      const resolved = await resolveFromForPlan({ optionsFrom: candidate, space: aggregateSpace });
      expect(resolved.ok, candidate).toBe(true);
    }
  });

  it('names no candidates when the space could not be read', () => {
    expect(migrationPlanChoice(undefined, 'Unread')).toEqual({
      kind: 'ambiguous',
      reason: 'Unread',
      candidates: [],
    });
  });

  it('names none, with the empty-graph rule, for a contract no ref names while there are no migrations', () => {
    expect(fromOf(space([]), { kind: 'contract', hash: OFF_GRAPH })).toMatchObject({
      kind: 'none',
      reason: expect.stringContaining('`@empty` or a ref'),
    });
  });
});

describe('migrationPlanReplacing names the --from that plans a failed migration again', () => {
  it('names where it started, when another migration still records it', async () => {
    const failed = pkg(A, B);
    const packages = [pkg(E, A), failed];
    const aggregateSpace = space(packages);
    const argument = migrationPlanReplacing(
      { ...rulesSpace(aggregateSpace), packages },
      { from: A, dirName: failed.dirName },
    );
    const remaining = space([packages[0]!]);
    expect(await resolvedStart(remaining, argument)).toBe(A);
  });

  it('names @empty for a first migration', async () => {
    const failed = pkg(E, A);
    expect(
      migrationPlanReplacing(
        { ...rulesSpace(space([failed])), packages: [failed] },
        { from: E, dirName: failed.dirName },
      ),
    ).toEqual({ kind: 'reference', reference: '@empty' });
  });

  it('names none when deleting it leaves its start recorded by nothing', () => {
    const failed = pkg(A, B);
    const packages = [pkg(E, C), failed];
    expect(
      migrationPlanReplacing(
        { ...rulesSpace(space(packages)), packages },
        { from: A, dirName: failed.dirName },
      ),
    ).toMatchObject({ kind: 'none' });
  });
});

describe('migrationPlanTo names a --to migration plan resolves to the intended end', () => {
  it('leaves --to out for a contract hash that is the one the run was given', () => {
    expect(
      migrationPlanTo(
        { ...rulesSpace(space([pkg(E, A)])), emittedHash: OFF_GRAPH },
        { kind: 'contract', hash: OFF_GRAPH },
      ),
    ).toEqual({ kind: 'default' });
  });

  it('names none for a contract no migration records, which migration plan refuses', async () => {
    const aggregateSpace = space([pkg(E, A)]);
    expect(
      migrationPlanTo(rulesSpace(aggregateSpace), { kind: 'contract', hash: OFF_GRAPH }),
    ).toMatchObject({ kind: 'none' });
    expect((await resolveToForPlan(OFF_GRAPH, { space: aggregateSpace })).ok).toBe(false);
  });

  it.each<{ readonly name: string; readonly end: PlanEnd; readonly endsAt: string }>([
    { name: 'a ref', end: { kind: 'ref', name: 'production' }, endsAt: B },
    { name: 'a contract a migration records', end: { kind: 'contract', hash: A }, endsAt: A },
  ])('$name', async ({ end, endsAt }) => {
    const aggregateSpace = space([pkg(E, A)], { production: ref(B) });
    const argument = migrationPlanTo(rulesSpace(aggregateSpace), end);
    if (argument.kind !== 'reference') throw new Error(`not a reference: ${argument.kind}`);
    const resolved = await resolveToForPlan(argument.reference, { space: aggregateSpace });
    expect(resolved.ok && resolved.value.hash).toBe(endsAt);
  });

  it('leaves --to out for the emitted contract', () => {
    expect(migrationPlanTo(rulesSpace(space([pkg(E, A)])), { kind: 'emitted' })).toEqual({
      kind: 'default',
    });
  });

  it('names none for the empty contract, which migration plan refuses', async () => {
    const aggregateSpace = space([pkg(E, A)]);
    expect(
      migrationPlanTo(rulesSpace(aggregateSpace), { kind: 'contract', hash: E }),
    ).toMatchObject({ kind: 'none' });
    expect((await resolveToForPlan('@empty', { space: aggregateSpace })).ok).toBe(false);
  });
});

describe('migrationPlanFromRun names the start a run of migration plan resolved', () => {
  it.each<{
    readonly name: string;
    readonly packages: () => readonly OnDiskMigrationPackage[];
    readonly refs?: Refs;
  }>([
    { name: 'from the db ref it baselines', packages: () => [], refs: { db: ref(OFF_GRAPH) } },
    { name: 'from the empty database', packages: () => [] },
    { name: 'from the db ref on the graph', packages: () => [pkg(E, A)], refs: { db: ref(A) } },
  ])('$name', async ({ packages, refs }) => {
    const aggregateSpace = space(packages(), refs);
    const run = await resolveFromForPlan({ optionsFrom: undefined, space: aggregateSpace });
    if (!run.ok) throw run.failure;
    const resolution: FromResolution = run.value;
    const argument = migrationPlanFromRun(undefined, resolution);
    expect(await resolvedStart(aggregateSpace, argument)).toBe(resolution.fromHash);
  });
});
