import { describe, expect, it } from 'vitest';
import { buildNoPathSummary, buildStatusHeadline } from '../../src/orm/migration/status';

describe('buildNoPathSummary', () => {
  it('names the live contract when no --to was passed', () => {
    expect(
      buildNoPathSummary({
        markerHash: 'a'.repeat(64),
        targetHash: 'b'.repeat(64),
        explicitTarget: false,
        refName: undefined,
      }),
    ).toBe(
      "No migration path from the database state (aaaaaaaaaaaa) to the application's contract (bbbbbbbbbbbb). Run `{bin} migration plan --name <name>` to author one.",
    );
  });

  it('names the ref when --to resolved via ref', () => {
    expect(
      buildNoPathSummary({
        markerHash: 'a'.repeat(64),
        targetHash: 'b'.repeat(64),
        explicitTarget: true,
        refName: 'prod',
      }),
    ).toBe(
      'No migration path from the database state (aaaaaaaaaaaa) to the target (bbbbbbbbbbbb via `prod`). Run `{bin} migration plan --name <name>` to author one, or pass `--to <contract>` to pick a reachable target.',
    );
  });

  it('omits via ref when --to was a raw hash', () => {
    expect(
      buildNoPathSummary({
        markerHash: 'a'.repeat(64),
        targetHash: 'b'.repeat(64),
        explicitTarget: true,
        refName: undefined,
      }),
    ).toBe(
      'No migration path from the database state (aaaaaaaaaaaa) to the target (bbbbbbbbbbbb). Run `{bin} migration plan --name <name>` to author one, or pass `--to <contract>` to pick a reachable target.',
    );
  });

  it('omits the marker parenthetical when the marker hash is unknown', () => {
    expect(
      buildNoPathSummary({
        markerHash: undefined,
        targetHash: 'b'.repeat(64),
        explicitTarget: false,
        refName: undefined,
      }),
    ).toBe(
      "No migration path from the database state to the application's contract (bbbbbbbbbbbb). Run `{bin} migration plan --name <name>` to author one.",
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
