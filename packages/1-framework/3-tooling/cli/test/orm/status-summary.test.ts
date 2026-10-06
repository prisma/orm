import { describe, expect, it } from 'vitest';
import { buildNoPathSummary, buildStatusHeadline } from '../../src/orm/migration/status';

describe('buildNoPathSummary', () => {
  it('names the live contract when no --to was passed', () => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'database', marker: { storageHash: 'a'.repeat(64), invariants: [] } },
        targetHash: 'b'.repeat(64),
        target: { space: 'app', explicitTarget: false, refName: undefined },
      }),
    ).toBe(
      "No migration path from the database state (aaaaaaaaaaaa) to the application's contract (bbbbbbbbbbbb). Run `{bin} migration plan --name <name>` to author one.",
    );
  });

  it('names the ref when --to resolved via ref', () => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'database', marker: { storageHash: 'a'.repeat(64), invariants: [] } },
        targetHash: 'b'.repeat(64),
        target: { space: 'app', explicitTarget: true, refName: 'prod' },
      }),
    ).toBe(
      'No migration path from the database state (aaaaaaaaaaaa) to the target (bbbbbbbbbbbb via `prod`). Run `{bin} migration plan --name <name>` to author one, or pass `--to <contract>` to pick a reachable target.',
    );
  });

  it('omits via ref when --to was a raw hash', () => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'database', marker: { storageHash: 'a'.repeat(64), invariants: [] } },
        targetHash: 'b'.repeat(64),
        target: { space: 'app', explicitTarget: true, refName: undefined },
      }),
    ).toBe(
      'No migration path from the database state (aaaaaaaaaaaa) to the target (bbbbbbbbbbbb). Run `{bin} migration plan --name <name>` to author one, or pass `--to <contract>` to pick a reachable target.',
    );
  });

  it('omits the marker parenthetical when the marker hash is unknown', () => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'database', marker: undefined },
        targetHash: 'b'.repeat(64),
        target: { space: 'app', explicitTarget: false, refName: undefined },
      }),
    ).toBe(
      "No migration path from the database state to the application's contract (bbbbbbbbbbbb). Run `{bin} migration plan --name <name>` to author one.",
    );
  });

  it('names the --from contract when the origin is offline', () => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'offline', hash: 'a'.repeat(64) },
        targetHash: 'b'.repeat(64),
        target: { space: 'app', explicitTarget: true, refName: undefined },
      }),
    ).toBe(
      'No migration path from the --from contract (aaaaaaaaaaaa) to the target (bbbbbbbbbbbb). Run `{bin} migration plan --name <name>` to author one, or pass `--to <contract>` to pick a reachable target.',
    );
  });

  it('names the head of an extension space and leaves out the app remedies', () => {
    expect(
      buildNoPathSummary({
        origin: { kind: 'database', marker: undefined },
        targetHash: 'b'.repeat(64),
        target: { space: 'extension', spaceId: 'pgvector' },
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
