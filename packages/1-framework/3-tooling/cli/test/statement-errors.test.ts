import { describe, expect, it } from 'vitest';
import {
  errorStatementNeedsMigrationFile,
  errorStatementOriginUnknown,
} from '../src/utils/cli-errors';

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
        '2. Run `{bin} db update --advance-ref <name> --dry-run`, with the same `--db` as this command if it has one, and check that it plans no operations. Then run it again without `--dry-run`: the database matches that contract, so this changes nothing in it, and it stores the contract snapshot. If the dry run plans operations, the database has drifted from that contract; settle that before you go on.',
        '3. Put the new contract source back, run `{bin} contract emit`, and run this command again with `--advance-ref <name>`.',
        'Adding --advance-ref to this command alone does not help: it would store the new contract, not the one the database is at. `migration plan --from` does not apply to `db update`.',
      ].join('\n'),
    );
  });
});

describe('errorStatementNeedsMigrationFile', () => {
  function commandOf(error: ReturnType<typeof errorStatementNeedsMigrationFile>) {
    return (error.toEnvelope().nextActions ?? []).flatMap((action) =>
      'command' in action && typeof action.command === 'string' ? [action.command] : [],
    );
  }

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
    ).toEnvelope();

    expect(envelope).toMatchObject({
      code: 'MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE',
      summary: 'db update cannot carry out "--convert User.years" and "--backfill User.email"',
      why: expect.stringContaining('db update has no migration file to fill'),
      fix: 'Plan the change with {bin} migration plan --rename User.age:User.years --convert User.years --delete Legacy --backfill User.email, fill in the migration.ts it writes, run that migration.ts with the `node` command `migration plan` prints, and apply it with {bin} db migrate. Or leave out these statements: db update then asks before it loses any data.',
      meta: {
        statements: [
          { verb: 'convert', text: 'User.years' },
          { verb: 'backfill', text: 'User.email' },
        ],
      },
    });
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
        ),
      ),
    }).toEqual({
      fix: 'Plan the change with {bin} migration plan --convert User.years --config app/prisma.config.ts, fill in the migration.ts it writes, run that migration.ts with the `node` command `migration plan` prints, and apply it with {bin} db migrate --config app/prisma.config.ts. Or leave out these statements: db update then asks before it loses any data.',
      commands: ['{bin} migration plan --convert User.years --config app/prisma.config.ts'],
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
    );

    expect(commandOf(error)).toEqual([
      `{bin} migration plan --rename 'Old'\\''s:New' --backfill 'User.$(x)'`,
    ]);
    expect(error.toEnvelope().fix).toContain(`--backfill 'User.$(x)'`);
  });
});
