import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { describe, expect, it } from 'vitest';
import { migrationPlanForDatabase } from '../src/control-api/operations/plan-arguments';
import {
  errorStatementNeedsMigrationFile,
  errorStatementOriginUnknown,
} from '../src/utils/cli-errors';
import { buildGraph, entry } from './utils/graph-helpers';
import { NOT_RECORDED, reference, toEmitted } from './utils/plan-origins';

const HASH = 'sha256:abc';
const DIR = 'migrations/snapshots/sha256:abc';

function adviceOf(error: ReturnType<typeof errorStatementOriginUnknown>): readonly string[] {
  const envelope = error.toEnvelope();
  return [envelope.fix ?? '', ...(envelope.nextActions ?? []).map((action) => action.label)];
}

describe('errorStatementOriginUnknown', () => {
  const variants = {
    'no marker': errorStatementOriginUnknown({
      hash: null,
      snapshotDirectory: DIR,
      unreadable: undefined,
    }),
    'unreadable snapshot': errorStatementOriginUnknown({
      hash: HASH,
      snapshotDirectory: DIR,
      unreadable: 'Failed to parse',
    }),
    'missing snapshot': errorStatementOriginUnknown({
      hash: HASH,
      snapshotDirectory: DIR,
      unreadable: undefined,
    }),
  };

  it.each(Object.entries(variants))(
    'advises no plan without statements unless it says the plan drops data (%s)',
    (_, error) => {
      for (const advice of adviceOf(error)) {
        if (/without (the )?statements|leave out the statements/i.test(advice)) {
          expect(advice).toContain(
            'drops the storage of each renamed model or field with its data',
          );
        }
      }
    },
  );

  it('never offers migration plan --from as a route for db update', () => {
    for (const error of Object.values(variants)) {
      expect(error.toEnvelope().nextActions ?? []).not.toContainEqual(
        expect.objectContaining({ command: expect.stringContaining('migration plan') }),
      );
    }
  });

  it('says why the snapshot is missing and gives the route that stores it first', () => {
    const envelope = variants['missing snapshot'].toEnvelope();
    expect(envelope.why).toContain(
      'stores the snapshot of the contract it applies only when it advances a ref',
    );
    expect(envelope.fix).toBe(
      [
        'Store the snapshot of the contract the database is at, then run the rename:',
        '1. Put the contract source back to the version the database is at, and run `{bin} contract emit`.',
        '2. Run `{bin} db update --advance-ref db --dry-run` (`db` is the name of the ref that tracks the database; give another ref name if you use one), with the same `--db` as this command if it has one, and check that it plans no operations. Then run it again without `--dry-run`: the database matches that contract, so this changes nothing in it, and it stores the contract snapshot. If the dry run plans operations, the database has drifted from that contract; settle that before you go on.',
        '3. Put the new contract source back, run `{bin} contract emit`, and run this command again with `--advance-ref db`.',
        'Adding --advance-ref to this command alone does not help: it would store the new contract, not the one the database is at. `migration plan --from` does not apply to `db update`.',
      ].join('\n'),
    );
  });

  it('names the same ref in its actions as in its steps', () => {
    const envelope = variants['missing snapshot'].toEnvelope();
    expect(
      (envelope.nextActions ?? []).map((action) =>
        'command' in action ? [action.label, action.command] : [action.label],
      ),
    ).toEqual([
      ['Put the contract source back to the version the database is at, and emit it'],
      [
        'Check that it plans no operations (with the same --db as this command, if any)',
        '{bin} db update --advance-ref db --dry-run',
      ],
      [
        'Then store its snapshot, which changes nothing in the database',
        '{bin} db update --advance-ref db',
      ],
      [
        'Put the new contract source back, emit it, and run this command again with --advance-ref db',
      ],
    ]);
  });
});

describe('errorStatementNeedsMigrationFile', () => {
  function commandOf(error: ReturnType<typeof errorStatementNeedsMigrationFile>) {
    return (error.toEnvelope().nextActions ?? []).flatMap((action) =>
      'command' in action && typeof action.command === 'string' ? [action.command] : [],
    );
  }

  it('plans to the ref db update was given, and applies to it', () => {
    const envelope = errorStatementNeedsMigrationFile(
      [{ verb: 'backfill', text: 'User.email' }],
      [{ verb: 'backfill', text: 'User.email' }],
      undefined,
      { from: reference('db'), to: reference('production') },
    ).toEnvelope();

    expect(envelope.fix).toContain(
      '`{bin} migration plan --from db --to production --backfill User.email`',
    );
    expect(envelope.fix).toContain('apply it with `{bin} db migrate --to production`');
  });

  it('lists the edit of the migration on disk before the command that applies it', () => {
    const envelope = errorStatementNeedsMigrationFile(
      [{ verb: 'convert', text: 'User.years' }],
      [{ verb: 'convert', text: 'User.years' }],
      undefined,
      { ...toEmitted(reference('db')), migrationsToTarget: { kind: 'on-disk' } },
    ).toEnvelope();

    expect(envelope.nextActions).toEqual([
      {
        kind: 'user-choice',
        label:
          'Write what these statements ask for in the migration.ts of the migration on disk that changes the field, and run that migration.ts with `node`',
      },
      {
        kind: 'run-command',
        label: 'Then apply the migrations on disk',
        command: '{bin} db migrate',
      },
      { kind: 'user-choice', label: 'Or run db update without these statements' },
    ]);
  });

  it('for a database with no marker, lists how to adopt it before the command that applies the migrations on disk', () => {
    const A = 'a'.repeat(64);
    const envelope = errorStatementNeedsMigrationFile(
      [{ verb: 'convert', text: 'User.years' }],
      [{ verb: 'convert', text: 'User.years' }],
      undefined,
      migrationPlanForDatabase(
        { graph: buildGraph([entry(EMPTY_CONTRACT_HASH, A, 'm1')]), refs: {}, emittedHash: A },
        null,
        { kind: 'emitted' },
      ),
    ).toEnvelope();

    const adopt =
      'The database has no marker, so `db migrate` applies every migration on disk from the first, which fits only an empty database. A database that is not empty needs adopting first: record the contract it is at with `{bin} db sign <contract>`, naming the migration whose result it matches (`{bin} migration list` shows them), and `db migrate` then applies only the migrations after it';
    expect((envelope.nextActions ?? []).map(({ kind, label }) => [kind, label])).toEqual([
      [
        'user-choice',
        'Write what these statements ask for in the migration.ts of the migration on disk that changes the field, and run that migration.ts with `node`',
      ],
      ['user-choice', adopt],
      ['run-command', 'Then apply the migrations on disk'],
      ['user-choice', 'Or run db update without these statements'],
    ]);
    expect(envelope.fix).toBe(
      `Write what these statements ask for in the migration.ts of the migration on disk that changes the field, and run that migration.ts with \`node\`. ${adopt}. Then apply the migrations with \`{bin} db migrate\`. Or leave out these statements: db update then asks before it loses any data.`,
    );
  });

  it('for a database behind its migrations, gives applying them first as the fix and the first next action', () => {
    const A = 'a'.repeat(64);
    const B = 'b'.repeat(64);
    const envelope = errorStatementNeedsMigrationFile(
      [{ verb: 'convert', text: 'User.years' }],
      [{ verb: 'convert', text: 'User.years' }],
      undefined,
      migrationPlanForDatabase(
        { graph: buildGraph([entry(A, B, 'm1')]), refs: {}, emittedHash: 'c'.repeat(64) },
        { storageHash: A, invariants: [] },
        { kind: 'emitted' },
      ),
    ).toEnvelope();
    const reason = `Migrations on disk that the database has not applied come before where a plan for this change would start, and one of them may already make the change, so the plan could not carry it. Apply them first with \`{bin} db migrate --to ${B}\`, which names the migration.ts to change if one of them fails, then run the command again`;

    expect({ fix: envelope.fix, nextActions: envelope.nextActions }).toEqual({
      fix: `${reason}. Or leave out these statements: db update then asks before it loses any data.`,
      nextActions: [
        {
          kind: 'run-command',
          label:
            'Apply the migrations on disk the database has not applied, then run the command again',
          command: `{bin} db migrate --to ${B}`,
        },
        { kind: 'user-choice', label: 'Or run db update without these statements' },
      ],
    });
  });

  it('names the refused statements, and gives migration plan every statement it accepts, in the order given', () => {
    const envelope = errorStatementNeedsMigrationFile(
      [
        { verb: 'rename', text: 'User.age:User.years' },
        { verb: 'allow', text: 'User' },
        { verb: 'convert', text: 'User.years' },
        { verb: 'delete', text: 'Legacy' },
        { verb: 'backfill', text: 'User.email' },
      ],
      [
        { verb: 'convert', text: 'User.years' },
        { verb: 'backfill', text: 'User.email' },
      ],
      undefined,
      toEmitted(reference('db')),
    ).toEnvelope();

    expect(envelope).toMatchObject({
      code: 'MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE',
      summary: 'db update cannot carry out "--convert User.years" and "--backfill User.email"',
      why: expect.stringContaining('db update has no migration file to fill'),
      fix: 'Plan the change with `{bin} migration plan --from db --rename User.age:User.years --convert User.years --delete Legacy --backfill User.email`, fill in the migration.ts it writes, run `node <migration directory>/migration.ts` for the directory it writes, and apply it with `{bin} db migrate`. Or leave out these statements: db update then asks before it loses any data.',
      meta: {
        statements: [
          { verb: 'convert', text: 'User.years' },
          { verb: 'backfill', text: 'User.email' },
        ],
      },
    });
  });

  it('prints no migration plan when no plan can start where the database is', () => {
    const envelope = errorStatementNeedsMigrationFile(
      [{ verb: 'convert', text: 'User.years' }],
      [{ verb: 'convert', text: 'User.years' }],
      undefined,
      toEmitted(NOT_RECORDED),
    ).toEnvelope();

    expect({
      why: envelope.why,
      fix: envelope.fix,
      commands: commandOf(
        errorStatementNeedsMigrationFile(
          [{ verb: 'convert', text: 'User.years' }],
          [{ verb: 'convert', text: 'User.years' }],
          undefined,
          toEmitted(NOT_RECORDED),
        ),
      ),
    }).toEqual({
      why: `--convert of a field asks for a migration file with a slot for the code that converts its values, and db update has no migration file to fill: it applies its plan directly. No migration can be planned for them either. ${NOT_RECORDED.kind === 'none' ? NOT_RECORDED.reason : ''}.`,
      fix: 'Leave out these statements: db update then asks before it loses any data.',
      commands: [],
    });
  });

  it('gives the reason of each statement it refuses, and only those', () => {
    const why = (refused: readonly { verb: 'convert' | 'backfill'; text: string }[]) =>
      errorStatementNeedsMigrationFile(
        refused,
        refused,
        undefined,
        toEmitted(reference('db')),
      ).toEnvelope().why;

    expect([
      why([{ verb: 'backfill', text: 'GeoPoint.seen' }]),
      why([{ verb: 'convert', text: 'User.age' }]),
    ]).toEqual([
      '--backfill asks for a migration file with a slot for the value that fills the field, and db update has no migration file to fill: it applies its plan directly.',
      '--convert of a field asks for a migration file with a slot for the code that converts its values, and db update has no migration file to fill: it applies its plan directly.',
    ]);
  });

  it('repeats the --config the CLI was given in each command it prints', () => {
    const envelope = errorStatementNeedsMigrationFile(
      [{ verb: 'convert', text: 'User.years' }],
      [{ verb: 'convert', text: 'User.years' }],
      {
        cwd: '/work',
        configPath: 'app/prisma.config.ts',
        dbGiven: false,
      },
      toEmitted(reference('db')),
    ).toEnvelope();

    expect({
      fix: envelope.fix,
      commands: commandOf(
        errorStatementNeedsMigrationFile(
          [{ verb: 'convert', text: 'User.years' }],
          [{ verb: 'convert', text: 'User.years' }],
          {
            cwd: '/work',
            configPath: 'app/prisma.config.ts',
            dbGiven: false,
          },
          toEmitted(reference('db')),
        ),
      ),
    }).toEqual({
      fix: 'Plan the change with `{bin} migration plan --from db --convert User.years --config app/prisma.config.ts`, fill in the migration.ts it writes, run `node <migration directory>/migration.ts --config app/prisma.config.ts` for the directory it writes, and apply it with `{bin} db migrate --config app/prisma.config.ts`. Or leave out these statements: db update then asks before it loses any data.',
      commands: [
        '{bin} migration plan --from db --convert User.years --config app/prisma.config.ts',
      ],
    });
  });

  it('quotes a value a shell would read', () => {
    const error = errorStatementNeedsMigrationFile(
      [
        { verb: 'rename', text: "Old's:New" },
        { verb: 'backfill', text: 'User.$(x)' },
      ],
      [{ verb: 'backfill', text: 'User.$(x)' }],
      undefined,
      toEmitted(reference('db')),
    );

    expect(commandOf(error)).toEqual([
      `{bin} migration plan --from db --rename 'Old'\\''s:New' --backfill 'User.$(x)'`,
    ]);
    expect(error.toEnvelope().fix).toContain(`--backfill 'User.$(x)'`);
  });
});
