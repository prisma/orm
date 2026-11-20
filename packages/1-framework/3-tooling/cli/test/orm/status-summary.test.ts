import { describe, expect, it } from 'vitest';
import {
  buildNoPathSummary,
  buildStatusHeadline,
  buildStatusNextActions,
} from '../../src/orm/migration/status';
import type { PrintedPlan } from '../../src/utils/printed-command';

const PLAN = { kind: 'runs', command: '{bin} migration plan --from aaaa --name <name>' } as const;
const PLAN_TO_PROD = {
  kind: 'runs',
  command: '{bin} migration plan --from aaaa --to prod --name <name>',
} as const;
const LIST = '{bin} migration list';

describe('buildNoPathSummary', () => {
  it('names the live contract and the plan that reaches it when no --to was passed', () => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'database', marker: { storageHash: 'a'.repeat(64), invariants: [] } },
        targetHash: 'b'.repeat(64),
        target: {
          kind: 'app',
          explicitTarget: false,
          refName: undefined,
          plan: PLAN,
          listCommand: LIST,
        },
      }),
    ).toBe(
      "No migration path from the database state (aaaaaaaaaaaa) to the application's contract (bbbbbbbbbbbb).",
    );
  });

  it('names the ref when --to resolved via ref', () => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'database', marker: { storageHash: 'a'.repeat(64), invariants: [] } },
        targetHash: 'b'.repeat(64),
        target: {
          kind: 'app',
          explicitTarget: true,
          refName: 'prod',
          plan: PLAN_TO_PROD,
          listCommand: LIST,
        },
      }),
    ).toBe(
      'No migration path from the database state (aaaaaaaaaaaa) to the target (bbbbbbbbbbbb via `prod`).',
    );
  });

  it('omits via ref when --to was a raw hash', () => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'database', marker: { storageHash: 'a'.repeat(64), invariants: [] } },
        targetHash: 'b'.repeat(64),
        target: {
          kind: 'app',
          explicitTarget: true,
          refName: undefined,
          plan: PLAN,
          listCommand: LIST,
        },
      }),
    ).toBe(
      'No migration path from the database state (aaaaaaaaaaaa) to the target (bbbbbbbbbbbb).',
    );
  });

  it('omits the marker parenthetical when the marker hash is unknown', () => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'database', marker: undefined },
        targetHash: 'b'.repeat(64),
        target: {
          kind: 'app',
          explicitTarget: false,
          refName: undefined,
          plan: PLAN,
          listCommand: LIST,
        },
      }),
    ).toBe(
      "No migration path from the database state to the application's contract (bbbbbbbbbbbb).",
    );
  });

  it('names the --from contract when the origin is offline', () => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'offline', hash: 'a'.repeat(64) },
        targetHash: 'b'.repeat(64),
        target: {
          kind: 'app',
          explicitTarget: true,
          refName: undefined,
          plan: PLAN,
          listCommand: LIST,
        },
      }),
    ).toBe(
      'No migration path from the --from contract (aaaaaaaaaaaa) to the target (bbbbbbbbbbbb).',
    );
  });

  it('names the head of an extension space and leaves out the app remedies', () => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'database', marker: undefined },
        targetHash: 'b'.repeat(64),
        target: { kind: 'extension', spaceId: 'pgvector' },
      }),
    ).toBe(
      'No migration path from the database state to the head of extension space `pgvector` (bbbbbbbbbbbb).',
    );
  });
});

describe('buildNoPathSummary when the plan is not a plain command', () => {
  it.each([
    ['no plan can author the path', { kind: 'none', reason: 'No reason' }],
    [
      'the plan has a placeholder',
      {
        kind: 'fill',
        command: '{bin} migration plan --from <contract> --name <name>',
        fill: 'Two ends, so replace <contract> with one of `x`, `y`',
      },
    ],
  ] as const)('leaves the advice to next actions when %s', (_, plan) => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'database', marker: undefined },
        targetHash: 'b'.repeat(64),
        target: { kind: 'app', explicitTarget: false, refName: undefined, plan, listCommand: LIST },
      }),
    ).toBe(
      "No migration path from the database state to the application's contract (bbbbbbbbbbbb).",
    );
  });
});

describe('buildStatusHeadline', () => {
  it('reports up to date when nothing is pending', () => {
    expect(
      buildStatusHeadline({
        pendingCount: 0,
        markerDiverged: false,
        markerHash: 'abc',
      }),
    ).toBe('Up to date');
  });

  it('counts the pending migrations', () => {
    expect(
      buildStatusHeadline({
        pendingCount: 2,
        markerDiverged: false,
        markerHash: 'marker',
      }),
    ).toBe('2 pending');
  });

  it('reports divergence when the marker is not in the on-disk graph', () => {
    expect(
      buildStatusHeadline({
        pendingCount: 1,
        markerDiverged: true,
        markerHash: 'a'.repeat(64),
      }),
    ).toBe('Database marker aaaaaaaaaaaa is not in the on-disk migration graph');
  });
});

describe('buildStatusNextActions', () => {
  const invocation = { cwd: '/project', configPath: undefined, dbGiven: false };
  const settled = {
    everySpaceEmpty: false,
    firstPlan: undefined,
    markerDiverged: false,
    noPath: undefined,
    pendingCount: 0,
    targetHash: 'b'.repeat(64),
    refName: undefined,
    toArgument: undefined,
    invocation,
  };
  const origin = {
    kind: 'database' as const,
    marker: { storageHash: 'a'.repeat(64), invariants: [] },
  };
  const appNoPath = (plan: PrintedPlan, explicitTarget = false) => ({
    origin,
    targetHash: 'b'.repeat(64),
    target: {
      kind: 'app' as const,
      explicitTarget,
      refName: explicitTarget ? 'prod' : undefined,
      plan,
      listCommand: LIST,
    },
  });

  it('plans the missing migration, then applies, when no path reaches the application contract', () => {
    expect(buildStatusNextActions({ ...settled, noPath: appNoPath(PLAN) })).toEqual([
      { kind: 'run-command', label: 'Plan the missing migration', command: PLAN.command },
      { kind: 'run-command', label: 'Then apply it', command: '{bin} db migrate' },
    ]);
  });

  it('names the --to target when applying and offers another target', () => {
    expect(
      buildStatusNextActions({
        ...settled,
        noPath: appNoPath(PLAN_TO_PROD, true),
        toArgument: 'prod',
      }),
    ).toEqual([
      { kind: 'run-command', label: 'Plan the missing migration', command: PLAN_TO_PROD.command },
      { kind: 'run-command', label: 'Then apply it', command: '{bin} db migrate --to prod' },
      { kind: 'user-choice', label: 'Or pass `--to <contract>` to pick a reachable target' },
    ]);
  });

  it('leaves the --from choice to the user when the plan has a placeholder', () => {
    const fill = {
      kind: 'fill',
      command: '{bin} migration plan --from <contract> --name <name>',
      fill: 'The history has more than one end, so replace <contract> with one of `x`, `y`',
    } as const;
    expect(buildStatusNextActions({ ...settled, noPath: appNoPath(fill) })[0]).toEqual({
      kind: 'user-choice',
      label: `Plan the missing migration with \`${fill.command}\`. ${fill.fill}.`,
    });
  });

  it('says why no plan can author the path and points at the graph', () => {
    expect(
      buildStatusNextActions({
        ...settled,
        noPath: appNoPath({ kind: 'none', reason: 'No reason' }),
      }),
    ).toEqual([
      { kind: 'user-choice', label: 'No reason' },
      { kind: 'run-command', label: 'Inspect the graph', command: LIST },
    ]);
  });

  it('suggests nothing for an extension space, whose migrations ship with the extension', () => {
    expect(
      buildStatusNextActions({
        ...settled,
        noPath: {
          origin,
          targetHash: 'b'.repeat(64),
          target: { kind: 'extension', spaceId: 'pgvector' },
        },
      }),
    ).toEqual([]);
  });

  it('plans the first migration when none exist', () => {
    expect(buildStatusNextActions({ ...settled, everySpaceEmpty: true, firstPlan: PLAN })).toEqual([
      { kind: 'run-command', label: 'Plan the first migration', command: PLAN.command },
    ]);
  });

  it('applies pending migrations to the target hash', () => {
    expect(buildStatusNextActions({ ...settled, pendingCount: 2, targetHash: 'deadbeef' })).toEqual(
      [
        {
          kind: 'run-command',
          label: 'Apply the pending migrations',
          command: '{bin} db migrate --to deadbeef',
        },
      ],
    );
  });

  it('applies pending migrations to the ref the user gave, so the run compares its policies', () => {
    expect(buildStatusNextActions({ ...settled, pendingCount: 2, refName: 'production' })).toEqual([
      expect.objectContaining({ command: '{bin} db migrate --to production' }),
    ]);
  });

  it('repeats --config and --db so the command runs against the same project and database', () => {
    expect(
      buildStatusNextActions({
        ...settled,
        pendingCount: 1,
        targetHash: 'deadbeef',
        invocation: { cwd: '/project', configPath: 'prisma.config.ts', dbGiven: true },
      }),
    ).toEqual([
      expect.objectContaining({
        command: '{bin} db migrate --to deadbeef --config prisma.config.ts --db <url>',
      }),
    ]);
  });

  it('suggests no plan or apply while an extension marker diverges and the app has no path', () => {
    expect(
      buildStatusNextActions({ ...settled, markerDiverged: true, noPath: appNoPath(PLAN) }),
    ).toEqual([]);
  });

  it.each([
    ['nothing is pending', settled],
    [
      'no migrations exist and no plan was worked out',
      { ...settled, everySpaceEmpty: true, pendingCount: 1 },
    ],
    ['the marker is off the graph', { ...settled, markerDiverged: true, pendingCount: 1 }],
  ])('suggests nothing when %s', (_, args) => {
    expect(buildStatusNextActions(args)).toEqual([]);
  });
});
