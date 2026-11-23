import { describe, expect, it } from 'vitest';
import { buildNoPathSummary, buildStatusHeadline } from '../../src/orm/migration/status';

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
      "No migration path from the database state (aaaaaaaaaaaa) to the application's contract (bbbbbbbbbbbb). Run `{bin} migration plan --from aaaa --name <name>` to author one.",
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
      'No migration path from the database state (aaaaaaaaaaaa) to the target (bbbbbbbbbbbb via `prod`). Run `{bin} migration plan --from aaaa --to prod --name <name>` to author one, or pass `--to <contract>` to pick a reachable target.',
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
      'No migration path from the database state (aaaaaaaaaaaa) to the target (bbbbbbbbbbbb). Run `{bin} migration plan --from aaaa --name <name>` to author one, or pass `--to <contract>` to pick a reachable target.',
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
      "No migration path from the database state to the application's contract (bbbbbbbbbbbb). Run `{bin} migration plan --from aaaa --name <name>` to author one.",
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
      'No migration path from the --from contract (aaaaaaaaaaaa) to the target (bbbbbbbbbbbb). Run `{bin} migration plan --from aaaa --name <name>` to author one, or pass `--to <contract>` to pick a reachable target.',
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

describe('buildNoPathSummary when no migration plan can author the path', () => {
  it('says why and points at the graph', () => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'database', marker: { storageHash: 'a'.repeat(64), invariants: [] } },
        targetHash: 'empty',
        target: {
          kind: 'app',
          explicitTarget: true,
          refName: undefined,
          plan: { kind: 'none', reason: 'No reason' },
          listCommand: LIST,
        },
      }),
    ).toBe(
      'No migration path from the database state (aaaaaaaaaaaa) to the target (empty). No migration plan can author one. No reason. Inspect the graph with `{bin} migration list`, or pass `--to <contract>` to pick a reachable target.',
    );
  });

  it('says what the placeholder takes', () => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'database', marker: undefined },
        targetHash: 'b'.repeat(64),
        target: {
          kind: 'app',
          explicitTarget: false,
          refName: undefined,
          plan: {
            kind: 'fill',
            command: '{bin} migration plan --from <contract> --name <name>',
            fill: 'Two ends, so replace <contract> with one of `x`, `y`',
          },
          listCommand: LIST,
        },
      }),
    ).toBe(
      "No migration path from the database state to the application's contract (bbbbbbbbbbbb). Run `{bin} migration plan --from <contract> --name <name>` to author one. Two ends, so replace <contract> with one of `x`, `y`.",
    );
  });
});

describe('buildStatusHeadline', () => {
  it('reports up to date when nothing is pending', () => {
    expect(
      buildStatusHeadline({
        pendingCount: 0,
        targetHash: 'abc',
        markerDiverged: false,
        markerHash: 'abc',
      }),
    ).toBe('Up to date');
  });

  it('names the migrate target when migrations are pending', () => {
    expect(
      buildStatusHeadline({
        pendingCount: 2,
        targetHash: 'deadbeef',
        markerDiverged: false,
        markerHash: 'marker',
      }),
    ).toBe('2 pending — run `{bin} db migrate --to deadbeef`');
  });

  it('names the ref the user gave as the migrate target, so the run compares its policies', () => {
    expect(
      buildStatusHeadline({
        pendingCount: 2,
        targetHash: 'deadbeef',
        refName: 'production',
        markerDiverged: false,
        markerHash: 'marker',
      }),
    ).toBe('2 pending — run `{bin} db migrate --to production`');
  });

  it('reports divergence when the marker is not in the on-disk graph', () => {
    expect(
      buildStatusHeadline({
        pendingCount: 1,
        targetHash: 'b'.repeat(64),
        markerDiverged: true,
        markerHash: 'a'.repeat(64),
      }),
    ).toBe('Database marker aaaaaaaaaaaa is not in the on-disk migration graph');
  });
});
