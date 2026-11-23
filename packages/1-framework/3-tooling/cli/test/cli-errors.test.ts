import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { docsUrlFor } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import {
  buildNeverPlannedFailure,
  buildPathNotFoundFailure,
} from '../src/control-api/operations/migrate';
import {
  errorDriverRequired,
  errorFamilyReadMarkerSqlRequired,
  errorPathUnreachable,
  errorPlanForgotTheFlag,
  errorPlanOriginUnknown,
  errorRefSetEmptySentinel,
  errorRefSetHashNotInGraph,
  errorSpaceNotFound,
  mapRefResolutionError,
  type PathUnreachable,
  planThenApply,
} from '../src/utils/cli-errors';
import type { CliInvocation } from '../src/utils/printed-command';
import { buildGraph, entry } from './utils/graph-helpers';
import { reference } from './utils/plan-origins';

const DEFAULT = { kind: 'default' } as const;

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

const INVOCATION: CliInvocation = { cwd: '/project', configPath: undefined, dbGiven: false };

describe('errorPathUnreachable', () => {
  const targetHash = `${'a'.repeat(64)}`;
  const fromHash = `${'b'.repeat(64)}`;

  it('emits a fully-qualified --from --to --name plan step plus a migrate apply step for the pathUnreachable runner kind', () => {
    const failure: PathUnreachable = {
      summary: 'Current contract has no planned migration path',
      why: 'Cannot reach target.',
      meta: { spaceId: 'app', kind: 'pathUnreachable', fromHash, targetHash },
    };
    const envelope = errorPathUnreachable(
      failure,
      planThenApply({ from: reference(fromHash), to: reference(targetHash) }, INVOCATION),
    ).toEnvelope();
    expect(envelope.code).toBe('MIGRATION.PATH_UNREACHABLE');
    expect(envelope.fix).toContain(`{bin} migration plan --from ${fromHash} --to ${targetHash}`);
    expect(envelope.fix).toContain(`{bin} db migrate --to ${targetHash}`);
    expect(envelope.fix).toContain('{bin} migration list');
    expect(envelope.fix).toContain('{bin} migration show');
    expect((envelope.fix ?? '').toLowerCase()).toContain('destructive');
    expect(envelope.fix ?? '').toContain('Plan a rename with --rename old:new');
  });

  it('composes buildPathNotFoundFailure why with the fix into one plan-then-apply sequence', () => {
    // Drive the real failure producer so the `why` text is the one users see,
    // not a stub — then assert it composes with the fix without both
    // independently telling the user to run `migration plan`.
    const failure = buildPathNotFoundFailure(
      'app',
      fromHash,
      targetHash,
      { from: reference(fromHash), to: reference(targetHash) },
      INVOCATION,
    );
    const envelope = failure.toEnvelope();

    // why: names both endpoints + the absence of an edge; does NOT itself
    // prescribe running the planner (that is the fix's job).
    expect(envelope.why).toContain(fromHash);
    expect(envelope.why).toContain(targetHash);
    expect(envelope.why?.toLowerCase()).toContain('no migration edge');
    expect(envelope.why).not.toContain('migration plan');

    // fix: the plan-then-apply sequence pointing at the now-working command.
    expect(envelope.fix).toContain(`{bin} migration plan --from ${fromHash} --to ${targetHash}`);
    expect(envelope.fix).toContain(`{bin} db migrate --to ${targetHash}`);
    expect((envelope.fix ?? '').toLowerCase()).toContain('destructive');
    expect(envelope.fix ?? '').toContain('Plan a rename with --rename old:new');
  });

  it('names the empty contract when the space has no marker', () => {
    const envelope = buildPathNotFoundFailure(
      'app',
      EMPTY_CONTRACT_HASH,
      targetHash,
      { from: reference(fromHash), to: reference(targetHash) },
      INVOCATION,
    ).toEnvelope();

    expect(envelope.why).toContain('No migration edge connects the empty contract to the target');
    expect(envelope.meta?.['fromHash']).toBe(EMPTY_CONTRACT_HASH);
    expect(envelope.fix).toContain(`{bin} migration plan --from ${fromHash} --to ${targetHash}`);
  });

  it('leaves --to out of both steps when the target is the emitted contract, which no migration or ref names yet', () => {
    const error = buildPathNotFoundFailure(
      'app',
      fromHash,
      targetHash,
      { from: reference(fromHash), to: DEFAULT },
      INVOCATION,
    );

    expect(error.nextActions?.slice(0, 2)).toEqual([
      {
        kind: 'run-command',
        label: 'Plan the missing edge',
        command: `{bin} migration plan --from ${fromHash}`,
      },
      { kind: 'run-command', label: 'Apply it', command: '{bin} db migrate' },
    ]);
    expect(error.toEnvelope().fix).toContain(
      [
        'Plan the missing edge, then apply it:',
        `  1. {bin} migration plan --from ${fromHash}`,
        '  2. {bin} db migrate',
      ].join('\n'),
    );
    expect(error.toEnvelope().meta).toEqual({
      spaceId: 'app',
      kind: 'pathUnreachable',
      fromHash,
      targetHash,
    });
  });

  it('names a ref target by its name in both steps', () => {
    const error = buildPathNotFoundFailure(
      'app',
      fromHash,
      targetHash,
      { from: reference(fromHash), to: reference('production') },
      INVOCATION,
    );

    expect(error.nextActions?.slice(0, 2)).toEqual([
      {
        kind: 'run-command',
        label: 'Plan the missing edge',
        command: `{bin} migration plan --from ${fromHash} --to production`,
      },
      { kind: 'run-command', label: 'Apply it', command: '{bin} db migrate --to production' },
    ]);
  });

  it('leaves out --from and --to when neither has an argument', () => {
    const error = buildPathNotFoundFailure(
      'app',
      EMPTY_CONTRACT_HASH,
      targetHash,
      { from: DEFAULT, to: DEFAULT },
      INVOCATION,
    );

    expect(error.nextActions?.slice(0, 2)).toEqual([
      {
        kind: 'run-command',
        label: 'Plan the missing edge',
        command: '{bin} migration plan',
      },
      { kind: 'run-command', label: 'Apply it', command: '{bin} db migrate' },
    ]);
  });

  it('repeats the --config and --db the CLI was given, so the commands run as printed', () => {
    const error = buildPathNotFoundFailure(
      'app',
      fromHash,
      targetHash,
      { from: reference(fromHash), to: DEFAULT },
      {
        cwd: '/project',
        configPath: 'apps/api/prisma.config.ts',
        dbGiven: true,
      },
    );

    expect(
      error.nextActions?.map((action) => (action.kind === 'run-command' ? action.command : null)),
    ).toEqual([
      `{bin} migration plan --from ${fromHash} --config apps/api/prisma.config.ts`,
      '{bin} db migrate --config apps/api/prisma.config.ts --db <url>',
      null,
      null,
      '{bin} migration list --config apps/api/prisma.config.ts',
      '{bin} migration show <bundle> --config apps/api/prisma.config.ts',
    ]);
  });

  it('applies with the db migrate the user ran, flags included', () => {
    const error = buildPathNotFoundFailure(
      'app',
      fromHash,
      targetHash,
      { from: reference(fromHash), to: reference('production') },
      {
        ...INVOCATION,
        rerunArgs: ['--to', 'production', '--permit-policy-change'],
      },
    );

    expect(error.nextActions?.slice(0, 2)).toEqual([
      {
        kind: 'run-command',
        label: 'Plan the missing edge',
        command: `{bin} migration plan --from ${fromHash} --to production`,
      },
      {
        kind: 'run-command',
        label: 'Apply it',
        command: '{bin} db migrate --to production --permit-policy-change',
      },
    ]);
  });

  it('plans to the ref the run named and applies with its flags when the space has no migrations', () => {
    const error = buildNeverPlannedFailure(
      'app',
      targetHash,
      'migrations',
      { from: reference('@empty'), to: reference('production') },
      { ...INVOCATION, rerunArgs: ['--to', 'production'] },
    );

    expect(error.nextActions?.slice(0, 2)).toEqual([
      {
        kind: 'run-command',
        label: 'Plan the missing edge',
        command: '{bin} migration plan --from @empty --to production',
      },
      { kind: 'run-command', label: 'Apply it', command: '{bin} db migrate --to production' },
    ]);
  });

  it('composes buildNeverPlannedFailure why with the fix into one plan-then-apply sequence', () => {
    const envelope = buildNeverPlannedFailure(
      'app',
      targetHash,
      'migrations-postgres',
      { from: reference('@empty'), to: DEFAULT },
      INVOCATION,
    ).toEnvelope();

    expect(envelope.why).toContain(targetHash);
    expect(envelope.why).toContain('migrations-postgres/app/');
    expect(envelope.why?.toLowerCase()).toContain('no migrations');
    expect(envelope.why).not.toContain('migration plan');

    // A never-planned space has an empty graph; the fix must not
    // prescribe a `--to <hash>` the empty graph cannot resolve.
    expect(envelope.fix).toContain('{bin} migration plan --from @empty');
    expect(envelope.fix).toContain('{bin} db migrate');
    expect(envelope.fix).not.toContain('--to');
    expect((envelope.fix ?? '').toLowerCase()).toContain('destructive');
    expect(envelope.fix ?? '').toContain('Plan a rename with --rename old:new');
  });
});

describe('errorRefSetHashNotInGraph', () => {
  const resolvedHash = `${'x'.repeat(64)}`;
  const reachableHashes = [`${'a'.repeat(64)}`, `${'b'.repeat(64)}`];

  it('emits MIGRATION.HASH_NOT_IN_GRAPH with the reachable hashes', () => {
    const envelope = errorRefSetHashNotInGraph(resolvedHash, reachableHashes).toEnvelope();
    expect(envelope.code).toBe('MIGRATION.HASH_NOT_IN_GRAPH');
    expect(envelope.meta).toEqual({ resolvedHash, reachableHashes });
    expect(envelope.fix).toContain('`to` hash of an on-disk migration');
    expect(envelope.fix).toContain('{bin} migration list');
  });

  it('describes an empty migration graph in the why line', () => {
    const envelope = errorRefSetHashNotInGraph(resolvedHash, []).toEnvelope();
    expect(envelope.why).toContain('empty');
    expect(envelope.fix).toContain('migration plan');
  });
});

const ONE_END_SPACE = {
  graph: buildGraph([entry(EMPTY_CONTRACT_HASH, 'b'.repeat(64), 'initial')]),
  refs: {},
};

describe('errorPlanOriginUnknown', () => {
  it('offers db update only for a database whose migration history does not need to be kept', () => {
    expect(errorPlanOriginUnknown([], ONE_END_SPACE).fix?.split('\n')[0]).toBe(
      `Point the db ref at the contract your database is at with \`{bin} migration ref set db <contract>\`, replacing <contract> with one of \`${'b'.repeat(64)}\`, or, on a database whose migration history does not need to be kept, advance it via \`{bin} db update\`.`,
    );
  });
});

describe('errorPlanOriginUnknown and errorPlanForgotTheFlag with no ref to plan from', () => {
  const END = 'b'.repeat(64);

  it.each([
    ['errorPlanOriginUnknown', () => errorPlanOriginUnknown([], ONE_END_SPACE)],
    ['errorPlanForgotTheFlag', () => errorPlanForgotTheFlag('c'.repeat(64), [], ONE_END_SPACE)],
  ] as const)('%s gives the explicit plan as a choice from where the history ends', (_, make) => {
    const action = make().nextActions?.find(({ label }) =>
      label.startsWith('Plan from an explicit origin'),
    );
    expect(action).toMatchObject({
      kind: 'user-choice',
      label: expect.stringContaining(`with \`{bin} migration plan --from ${END}\`. `),
    });
  });
});

describe('errorPlanOriginUnknown and errorPlanForgotTheFlag under --config', () => {
  const END = 'b'.repeat(64);
  const CONFIG = 'apps/api/prisma.config.ts';
  const invocation = { cwd: '/work', configPath: CONFIG, dbGiven: false };
  const STAGING = [{ name: 'staging', hash: END }];

  it('repeat the --config in every command they print', () => {
    const unknown = errorPlanOriginUnknown([], ONE_END_SPACE, invocation);
    const forgot = errorPlanForgotTheFlag('c'.repeat(64), [], ONE_END_SPACE, { invocation });
    const withRef = errorPlanOriginUnknown(STAGING, ONE_END_SPACE, invocation);
    const forgotWithRef = errorPlanForgotTheFlag('c'.repeat(64), STAGING, ONE_END_SPACE, {
      invocation,
    });
    expect({
      unknown: unknown.nextActions,
      forgot: forgot.nextActions,
      withRef: withRef.fix?.split('\n')[1],
      withRefActions: withRef.nextActions?.filter(({ kind }) => kind === 'run-command'),
      forgotWithRef: forgotWithRef.nextActions,
    }).toEqual({
      unknown: [
        {
          kind: 'user-choice',
          label: `Point the db ref at the contract your database is at with \`{bin} migration ref set db <contract> --config ${CONFIG}\`, replacing <contract> with one of \`${END}\``,
        },
        {
          kind: 'user-choice',
          label: `Plan from an explicit origin with \`{bin} migration plan --from ${END} --config ${CONFIG}\`. No \`db\` ref and no --from say where the plan starts.`,
        },
        {
          kind: 'run-command',
          label: 'Plan from an empty database deliberately',
          command: `{bin} migration plan --from @empty --config ${CONFIG}`,
        },
      ],
      forgot: [
        {
          kind: 'user-choice',
          label: `Plan from an explicit origin with \`{bin} migration plan --from ${END} --config ${CONFIG}\`. No migration records contract ${'c'.repeat(64)}.`,
        },
        {
          kind: 'user-choice',
          label: `Point the db ref at the contract your database is at with \`{bin} migration ref set db <contract> --config ${CONFIG}\`, replacing <contract> with one of \`${END}\``,
        },
      ],
      withRef: `Or pass the origin explicitly: \`{bin} migration plan --from staging --config ${CONFIG}\`.`,
      withRefActions: [
        {
          kind: 'run-command',
          label: 'Plan from staging',
          command: `{bin} migration plan --from staging --config ${CONFIG}`,
        },
        {
          kind: 'run-command',
          label: 'Plan from an empty database deliberately',
          command: `{bin} migration plan --from @empty --config ${CONFIG}`,
        },
      ],
      forgotWithRef: [
        {
          kind: 'run-command',
          label: 'Plan from staging',
          command: `{bin} migration plan --from staging --config ${CONFIG}`,
        },
      ],
    });
  });

  it('names a contract migration list shows with the --config when the history has no end to name', () => {
    const unread = { graph: buildGraph([]), refs: {} };
    expect(errorPlanOriginUnknown([], unread, invocation).nextActions?.[0]).toEqual({
      kind: 'user-choice',
      label: `Point the db ref at the contract your database is at with \`{bin} migration ref set db <contract> --config ${CONFIG}\`, replacing <contract> with a contract \`{bin} migration list --config ${CONFIG}\` shows`,
    });
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
  it('sends the ref-set remediation through migration list', () => {
    const error = errorRefSetHashNotInGraph('x'.repeat(64), ['a'.repeat(64)]);

    expect(error.nextActions).toEqual([
      {
        kind: 'run-command',
        label: 'List the migrations and their destination hashes',
        command: '{bin} migration list',
      },
      { kind: 'user-choice', label: 'Set the ref to the `to` hash of one of them' },
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

  it('keeps the plan-then-apply sequence in order as two run-command actions', () => {
    const targetHash = 'a'.repeat(64);
    const fromHash = 'b'.repeat(64);
    const failure: PathUnreachable = {
      summary: 'Current contract has no planned migration path',
      why: 'Cannot reach target.',
      meta: { spaceId: 'app', kind: 'pathUnreachable', fromHash, targetHash },
    };

    const actions = errorPathUnreachable(
      failure,
      planThenApply({ from: reference(fromHash), to: reference(targetHash) }, INVOCATION),
    ).nextActions;

    expect(actions.slice(0, 2)).toEqual([
      {
        kind: 'run-command',
        label: 'Plan the missing edge',
        command: `{bin} migration plan --from ${fromHash} --to ${targetHash}`,
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
