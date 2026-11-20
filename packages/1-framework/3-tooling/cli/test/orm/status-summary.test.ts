import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { describe, expect, it } from 'vitest';
import {
  buildNoPathSummary,
  buildStatusHeadline,
  buildStatusNextActions,
} from '../../src/orm/migration/status';

describe('buildNoPathSummary', () => {
  it('names the live contract when no --to was passed', () => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'database', marker: { storageHash: 'a'.repeat(64), invariants: [] } },
        targetHash: 'b'.repeat(64),
        target: { kind: 'app', explicitTarget: false, refName: undefined },
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
        target: { kind: 'app', explicitTarget: true, refName: 'prod' },
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
        target: { kind: 'app', explicitTarget: true, refName: undefined },
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
        target: { kind: 'app', explicitTarget: false, refName: undefined },
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
        target: { kind: 'app', explicitTarget: true, refName: undefined },
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
    markerDiverged: false,
    noPath: undefined,
    pendingCount: 0,
    targetHash: 'b'.repeat(64),
    refName: undefined,
    toArgument: undefined,
    invocation,
  };
  const atMarker = (storageHash: string) => ({
    kind: 'database' as const,
    marker: { storageHash, invariants: [] },
  });

  it('plans from the marker to the application contract, then applies, when no path reaches it', () => {
    expect(
      buildStatusNextActions({
        ...settled,
        noPath: {
          origin: atMarker('a'.repeat(64)),
          targetHash: 'b'.repeat(64),
          target: { kind: 'app', explicitTarget: false, refName: undefined },
        },
      }),
    ).toEqual([
      {
        kind: 'run-command',
        label: 'Plan the missing migration',
        command: `{bin} migration plan --from ${'a'.repeat(64)} --name <name>`,
      },
      { kind: 'run-command', label: 'Then apply it', command: '{bin} db migrate' },
    ]);
  });

  it('names the --to target in both commands and offers another target', () => {
    expect(
      buildStatusNextActions({
        ...settled,
        noPath: {
          origin: { kind: 'offline', hash: 'a'.repeat(64) },
          targetHash: 'b'.repeat(64),
          target: { kind: 'app', explicitTarget: true, refName: 'prod' },
        },
        toArgument: 'prod',
      }),
    ).toEqual([
      {
        kind: 'run-command',
        label: 'Plan the missing migration',
        command: `{bin} migration plan --from ${'a'.repeat(64)} --to prod --name <name>`,
      },
      { kind: 'run-command', label: 'Then apply it', command: '{bin} db migrate --to prod' },
      { kind: 'user-choice', label: 'Or pass `--to <contract>` to pick a reachable target' },
    ]);
  });

  it.each([
    ['no marker', { kind: 'database' as const, marker: undefined }],
    ['the empty contract', atMarker(EMPTY_CONTRACT_HASH)],
  ])('plans without --from when the database is at %s', (_, origin) => {
    expect(
      buildStatusNextActions({
        ...settled,
        noPath: {
          origin,
          targetHash: 'b'.repeat(64),
          target: { kind: 'app', explicitTarget: false, refName: undefined },
        },
      })[0],
    ).toMatchObject({ command: '{bin} migration plan --name <name>' });
  });

  it('suggests nothing for an extension space, whose migrations ship with the extension', () => {
    expect(
      buildStatusNextActions({
        ...settled,
        noPath: {
          origin: atMarker('a'.repeat(64)),
          targetHash: 'b'.repeat(64),
          target: { kind: 'extension', spaceId: 'pgvector' },
        },
      }),
    ).toEqual([]);
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

  it.each([
    ['nothing is pending', settled],
    ['no migrations exist', { ...settled, everySpaceEmpty: true, pendingCount: 1 }],
    ['the marker is off the graph', { ...settled, markerDiverged: true, pendingCount: 1 }],
    [
      "another space's marker is off the graph and no path reaches the target",
      {
        ...settled,
        markerDiverged: true,
        noPath: {
          origin: atMarker('a'.repeat(64)),
          targetHash: 'b'.repeat(64),
          target: { kind: 'app' as const, explicitTarget: false, refName: undefined },
        },
      },
    ],
  ])('suggests nothing when %s', (_, args) => {
    expect(buildStatusNextActions(args)).toEqual([]);
  });
});
