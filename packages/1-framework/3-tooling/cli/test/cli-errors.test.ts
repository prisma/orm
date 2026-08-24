import { docsUrlFor } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import {
  buildNeverPlannedFailure,
  buildPathNotFoundFailure,
} from '../src/control-api/operations/migrate';
import type { MigrateFailure } from '../src/control-api/types';
import {
  errorDriverRequired,
  errorFamilyReadMarkerSqlRequired,
  errorMarkerMismatch,
  errorPathUnreachable,
  errorRefSetEmptySentinel,
  errorRefSetHashNotInGraph,
  errorSpaceNotFound,
  mapRefResolutionError,
} from '../src/utils/cli-errors';

describe('CliStructuredError.toEnvelope()', () => {
  it('converts driver required error to envelope with CONFIG.DRIVER_REQUIRED', () => {
    const error = errorDriverRequired();
    const envelope = error.toEnvelope();

    expect(envelope.code).toBe('CONFIG.DRIVER_REQUIRED');
    expect(envelope.summary).toBe('Driver is required for DB-connected commands');
    expect(envelope.fix).toBe(
      'Add a control-plane driver to prisma.config.ts (e.g. import a driver descriptor and set `driver: postgresDriver`)',
    );
    expect(envelope.docsUrl).toBe(docsUrlFor('CONFIG.DRIVER_REQUIRED'));
  });

  it('converts readMarker error to envelope with CONFIG.FAMILY_READ_MARKER_REQUIRED', () => {
    const error = errorFamilyReadMarkerSqlRequired();
    const envelope = error.toEnvelope();

    expect(envelope.code).toBe('CONFIG.FAMILY_READ_MARKER_REQUIRED');
    expect(envelope.summary).toBe('Family readMarker() is required');
    expect(envelope.fix).toBe(
      'Ensure family.verify.readMarker() is exported by your family package',
    );
    expect(envelope.docsUrl).toBe(docsUrlFor('CONFIG.FAMILY_READ_MARKER_REQUIRED'));
  });
});

describe('errorPathUnreachable', () => {
  const targetHash = `${'a'.repeat(64)}`;
  const fromHash = `${'b'.repeat(64)}`;

  it('emits a fully-qualified --from --to --name plan step plus a migrate apply step for the pathUnreachable runner kind', () => {
    const failure: MigrateFailure = {
      code: 'MIGRATION_PATH_NOT_FOUND',
      summary: 'Current contract has no planned migration path',
      why: 'Cannot reach target.',
      meta: { spaceId: 'app', kind: 'pathUnreachable', fromHash, targetHash },
    };
    const envelope = errorPathUnreachable(failure).toEnvelope();
    expect(envelope.code).toBe('MIGRATION.PATH_UNREACHABLE');
    expect(envelope.fix).toContain(
      `{bin} migration plan --from ${fromHash} --to ${targetHash} --name <slug>`,
    );
    expect(envelope.fix).toContain(`{bin} db migrate --to ${targetHash}`);
    expect(envelope.fix).toContain('{bin} migration list');
    expect(envelope.fix).toContain('{bin} migration show');
    expect((envelope.fix ?? '').toLowerCase()).toContain('destructive');
    expect((envelope.fix ?? '').toLowerCase()).toContain('hint');
  });

  it('prescribes a bare plan command when the runner kind is neverPlanned (no graph to resolve --to against)', () => {
    const failure: MigrateFailure = {
      code: 'MIGRATION_PATH_NOT_FOUND',
      summary: 'No on-disk migrations for contract space "app"',
      why: 'migrate is replay-only.',
      meta: { spaceId: 'app', kind: 'neverPlanned', target: targetHash },
    };
    const envelope = errorPathUnreachable(failure).toEnvelope();
    // A never-planned space has an EMPTY graph, and `--to <hash>` only
    // resolves against graph nodes — the remediation must run verbatim.
    expect(envelope.fix).toContain('{bin} migration plan --name <slug>');
    expect(envelope.fix).not.toContain('--to');
    expect(envelope.fix).not.toContain('--from');
    expect(envelope.fix).not.toContain('<unknown>');
  });

  it('falls back to a bare `migration plan` suggestion when both hashes are absent', () => {
    const failure: MigrateFailure = {
      code: 'MIGRATION_PATH_NOT_FOUND',
      summary: 'Migration runner reported an unreachable target',
      why: 'No detail available.',
      meta: { spaceId: 'app' },
    };
    const envelope = errorPathUnreachable(failure).toEnvelope();
    expect(envelope.fix).toContain('{bin} migration plan');
    expect(envelope.fix).not.toContain('--from');
    expect(envelope.fix).not.toContain('--to');
    expect(envelope.fix).not.toContain('<unknown>');
  });

  it('composes buildPathNotFoundFailure why with the fix into one plan-then-apply sequence', () => {
    // Drive the real failure producer so the `why` text is the one users see,
    // not a stub — then assert it composes with the fix without both
    // independently telling the user to run `migration plan`.
    const failure = buildPathNotFoundFailure(
      'app',
      { storageHash: fromHash, invariants: [] },
      targetHash,
    );
    const envelope = errorPathUnreachable(failure).toEnvelope();

    // why: names both endpoints + the absence of an edge; does NOT itself
    // prescribe running the planner (that is the fix's job).
    expect(envelope.why).toContain(fromHash);
    expect(envelope.why).toContain(targetHash);
    expect(envelope.why?.toLowerCase()).toContain('no migration edge');
    expect(envelope.why).not.toContain('migration plan');

    // fix: the plan-then-apply sequence pointing at the now-working command.
    expect(envelope.fix).toContain(
      `{bin} migration plan --from ${fromHash} --to ${targetHash} --name <slug>`,
    );
    expect(envelope.fix).toContain(`{bin} db migrate --to ${targetHash}`);
    expect((envelope.fix ?? '').toLowerCase()).toContain('destructive');
    expect((envelope.fix ?? '').toLowerCase()).toContain('hint');
  });

  it('omits --from in the fix when buildPathNotFoundFailure uses the empty-marker sentinel', () => {
    const failure = buildPathNotFoundFailure('app', null, targetHash);
    const envelope = errorPathUnreachable(failure).toEnvelope();

    expect(envelope.why).toContain('<empty>');
    expect(envelope.fix).toContain(`{bin} migration plan --to ${targetHash} --name <slug>`);
    expect(envelope.fix).not.toContain('--from <empty>');
    expect(envelope.fix).not.toMatch(/--from\s/);
  });

  it('composes buildNeverPlannedFailure why with the fix into one plan-then-apply sequence', () => {
    const failure = buildNeverPlannedFailure('app', targetHash, 'migrations-postgres');
    const envelope = errorPathUnreachable(failure).toEnvelope();

    expect(envelope.why).toContain(targetHash);
    expect(envelope.why).toContain('migrations-postgres/app/');
    expect(envelope.why?.toLowerCase()).toContain('no migrations');
    expect(envelope.why).not.toContain('migration plan');

    // A never-planned space has an empty graph; the fix must not
    // prescribe a `--to <hash>` the empty graph cannot resolve.
    expect(envelope.fix).toContain('{bin} migration plan --name <slug>');
    expect(envelope.fix).toContain('{bin} db migrate');
    expect(envelope.fix).not.toContain('--to');
    expect((envelope.fix ?? '').toLowerCase()).toContain('destructive');
    expect((envelope.fix ?? '').toLowerCase()).toContain('hint');
  });
});

describe('errorRefSetHashNotInGraph', () => {
  const resolvedHash = `${'x'.repeat(64)}`;
  const reachableHashes = [`${'a'.repeat(64)}`, `${'b'.repeat(64)}`];
  const graphTip = reachableHashes[1]!;

  it('emits MIGRATION.HASH_NOT_IN_GRAPH with reachable hashes and graph tip', () => {
    const envelope = errorRefSetHashNotInGraph(
      resolvedHash,
      reachableHashes,
      graphTip,
    ).toEnvelope();
    expect(envelope.code).toBe('MIGRATION.HASH_NOT_IN_GRAPH');
    expect(envelope.meta?.['resolvedHash']).toBe(resolvedHash);
    expect(envelope.meta?.['reachableHashes']).toEqual(reachableHashes);
    expect(envelope.meta?.['graphTipHash']).toBe(graphTip);
    expect(envelope.fix).toContain(graphTip);
  });

  it('describes an empty migration graph in the why line', () => {
    const envelope = errorRefSetHashNotInGraph(resolvedHash, [], null).toEnvelope();
    expect(envelope.why).toContain('empty');
    expect(envelope.fix).toContain('migration plan');
  });
});

describe('errorRefSetEmptySentinel', () => {
  it('emits MIGRATION.REF_SET_EMPTY_SENTINEL', () => {
    const envelope = errorRefSetEmptySentinel('empty').toEnvelope();
    expect(envelope.code).toBe('MIGRATION.REF_SET_EMPTY_SENTINEL');
    expect(envelope.summary).toContain('empty-database sentinel');
  });
});

describe('typed next actions on the CLI factories', () => {
  it('spells the ref-set remediation as a runnable command', () => {
    const error = errorRefSetHashNotInGraph('x'.repeat(64), ['a'.repeat(64)], 'a'.repeat(64));

    expect(error.nextActions).toEqual([
      { kind: 'user-choice', label: `Set the ref to a graph-node hash such as ${'a'.repeat(64)}` },
      {
        kind: 'run-command',
        label: 'Extend the migration graph',
        command: '{bin} migration plan',
      },
    ]);
  });

  it('offers the listing command when a space id does not exist', () => {
    const error = errorSpaceNotFound('billing', ['app', 'pgvector']);

    expect(error.nextActions).toEqual([
      { kind: 'user-choice', label: 'Pick one of: app, pgvector' },
      {
        kind: 'run-command',
        label: "See every space's migrations",
        command: '{bin} migration list',
      },
    ]);
  });

  it('turns each marker-mismatch remedy into its own action', () => {
    const markerHash = 'c'.repeat(64);
    const graphTip = 'd'.repeat(64);

    const error = errorMarkerMismatch(markerHash, [graphTip], graphTip);

    expect(error.nextActions).toEqual([
      {
        kind: 'run-command',
        label: 'Catch the on-disk graph up to the live marker',
        command: `{bin} migration plan --from ${graphTip}`,
      },
      {
        kind: 'run-command',
        label: 'Point the local db ref at the live marker',
        command: `{bin} migration ref set db ${markerHash}`,
      },
      {
        kind: 'user-choice',
        label: 'Investigate whether the database was migrated by an out-of-band process',
      },
    ]);
  });

  it('keeps the plan-then-apply sequence in order as two run-command actions', () => {
    const targetHash = 'a'.repeat(64);
    const fromHash = 'b'.repeat(64);
    const failure: MigrateFailure = {
      code: 'MIGRATION_PATH_NOT_FOUND',
      summary: 'Current contract has no planned migration path',
      why: 'Cannot reach target.',
      meta: { spaceId: 'app', kind: 'pathUnreachable', fromHash, targetHash },
    };

    const actions = errorPathUnreachable(failure).nextActions;

    expect(actions.slice(0, 2)).toEqual([
      {
        kind: 'run-command',
        label: 'Plan the missing edge',
        command: `{bin} migration plan --from ${fromHash} --to ${targetHash} --name <slug>`,
      },
      {
        kind: 'run-command',
        label: 'Apply it',
        command: `{bin} db migrate --to ${targetHash}`,
      },
    ]);
  });

  it('carries the resolver fix through as an action', () => {
    const error = mapRefResolutionError({
      kind: 'wrong-grammar',
      input: 'head',
      expectedGrammar: 'migration',
      message: '"head" is a contract reference, not a migration reference',
      fix: 'Pass a migration directory name or migration hash.',
    });

    expect(error.nextActions).toEqual([
      { kind: 'user-choice', label: 'Pass a migration directory name or migration hash.' },
    ]);
  });

  it('keeps the fix prose alongside the typed actions', () => {
    const error = errorSpaceNotFound('billing', []);

    expect(error.fix).toBeDefined();
    expect(error.nextActions.length).toBeGreaterThan(0);
  });
});
