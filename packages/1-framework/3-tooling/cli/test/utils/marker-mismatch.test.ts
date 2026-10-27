import type { LedgerEntryRecord } from '@internal/contract/types';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { describe, expect, it } from 'vitest';
import {
  errorMarkerMismatch,
  type MarkerOutsideGraph,
  readLedgerQuietly,
} from '../../src/utils/marker-mismatch';
import type { CliInvocation } from '../../src/utils/printed-command';
import { buildGraph, entry } from './graph-helpers';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_DELETED = 'd'.repeat(64);
const HASH_OTHER = 'e'.repeat(64);
const HASH_EMITTED = 'f'.repeat(64);

const graph = buildGraph([
  entry(EMPTY_CONTRACT_HASH, HASH_A, '20261001T0000_initial'),
  entry(HASH_A, HASH_B, '20261014T0000_request_description_again'),
]);

const invocation: CliInvocation = { cwd: '/work/app', configPath: undefined, dbGiven: true };

function applied(migrationName: string, from: string | null, to: string): LedgerEntryRecord {
  return {
    space: 'app',
    migrationName,
    migrationHash: `sha256:${migrationName}`,
    from,
    to,
    appliedAt: new Date(0),
    operationCount: 1,
  };
}

function movedByDbUpdate(from: string | null, to: string): LedgerEntryRecord {
  return { ...applied('', from, to), migrationHash: to };
}

const SUMMARY = 'The database is at a contract that is not in the migration graph';
const OPENING = `The database's marker names ${HASH_DELETED}, which no migration in migrations/app starts or ends at.`;
const AFTER_LAST = `After ${HASH_A}, the last graph contract it reached,`;
const MOVED_BY_DB_UPDATE = '`db update` or `db init` moved it outside the migration graph.';
const CAUSE_UNKNOWN =
  'A migration it applied was planned again or deleted, or `db update` moved it to a contract no migration ends at.';
const MOVE_WITH_DB_UPDATE =
  'Unless this database changes only through migrations, as production does, move it with db update; its data stays:';
const DRY_RUN = `{bin} db update --to ${HASH_B} --dry-run --db <url>`;
const RECONCILE = `{bin} db update --to ${HASH_B} --db <url>`;

function otherwise(from: string, to = HASH_B): string {
  return `Otherwise plan a migration from ${from} to its current contract, then one to ${to}, and deploy again.`;
}

function migrationsOnly(from: string, to: string): string {
  return `Plan a migration from ${from} to the database's current contract, then one to ${to}, commit them, and deploy again.`;
}

function expectedEnvelope(args: {
  readonly why: string;
  readonly from: string;
  readonly meta: Record<string, unknown>;
}) {
  return {
    ok: false,
    code: 'MIGRATION.MARKER_MISMATCH',
    severity: 'error',
    summary: SUMMARY,
    why: `${OPENING} ${args.why}`,
    fix: [MOVE_WITH_DB_UPDATE, `  ${DRY_RUN}`, `  ${RECONCILE}`, otherwise(args.from)].join('\n'),
    nextActions: [
      { kind: 'user-choice', label: MOVE_WITH_DB_UPDATE },
      { kind: 'run-command', label: 'Preview the changes', command: DRY_RUN },
      { kind: 'run-command', label: 'Reconcile the database', command: RECONCILE },
      { kind: 'user-choice', label: otherwise(args.from) },
    ],
    meta: args.meta,
  };
}

function mismatch(
  ledger: readonly LedgerEntryRecord[] | undefined,
  overrides: Partial<MarkerOutsideGraph> = {},
) {
  return errorMarkerMismatch({
    spaceId: 'app',
    owner: { kind: 'application', emittedContractHash: HASH_B },
    markerHash: HASH_DELETED,
    targetHash: HASH_B,
    graph,
    migrationsDir: '/work/app/migrations',
    ledger,
    invocation,
    ...overrides,
  }).toEnvelope();
}

const META = { spaceId: 'app', markerHash: HASH_DELETED, targetHash: HASH_B };

describe('errorMarkerMismatch', () => {
  it('names the last graph contract and the migration no longer on disk', () => {
    const ledger = [
      applied('20261001T0000_initial', null, HASH_A),
      applied('20261013T0910_request_description', HASH_A, HASH_DELETED),
    ];

    expect(mismatch(ledger)).toEqual(
      expectedEnvelope({
        why: `${AFTER_LAST} it applied 20261013T0910_request_description, which is no longer on disk.`,
        from: HASH_A,
        meta: {
          ...META,
          lastGraphHash: HASH_A,
          missingMigrations: ['20261013T0910_request_description'],
        },
      }),
    );
  });

  it('lists every migration applied after the last graph contract, oldest first', () => {
    const ledger = [
      applied('20261001T0000_initial', null, HASH_A),
      applied('20261013T0910_first', HASH_A, HASH_OTHER),
      applied('20261013T0911_second', HASH_OTHER, HASH_DELETED),
    ];

    expect(mismatch(ledger)).toEqual(
      expectedEnvelope({
        why: `${AFTER_LAST} it applied 20261013T0910_first, 20261013T0911_second, which are no longer on disk.`,
        from: HASH_A,
        meta: {
          ...META,
          lastGraphHash: HASH_A,
          missingMigrations: ['20261013T0910_first', '20261013T0911_second'],
        },
      }),
    );
  });

  it('names five missing migrations and counts the rest, keeping all of them in meta', () => {
    const names = Array.from({ length: 7 }, (_, index) => `20261013T091${index}_change`);
    const ledger = [
      applied('20261001T0000_initial', null, HASH_A),
      ...names.map((name) => applied(name, HASH_A, HASH_DELETED)),
    ];

    expect(mismatch(ledger)).toEqual(
      expectedEnvelope({
        why: `${AFTER_LAST} it applied ${names.slice(0, 5).join(', ')}, and 2 more, which are no longer on disk.`,
        from: HASH_A,
        meta: { ...META, lastGraphHash: HASH_A, missingMigrations: names },
      }),
    );
  });

  it('says a migration whose directory is still on disk was planned again, and does not list it as missing', () => {
    const ledger = [
      applied('20261001T0000_initial', null, HASH_A),
      applied('20261014T0000_request_description_again', HASH_A, HASH_DELETED),
    ];

    expect(mismatch(ledger)).toEqual(
      expectedEnvelope({
        why: `${AFTER_LAST} it applied 20261014T0000_request_description_again, which has since been planned again with different content.`,
        from: HASH_A,
        meta: { ...META, lastGraphHash: HASH_A, missingMigrations: [] },
      }),
    );
  });

  it('names the missing migrations, then the ones planned again', () => {
    const ledger = [
      applied('20261001T0000_initial', null, HASH_A),
      applied('20261013T0910_first', HASH_A, HASH_OTHER),
      applied('20261014T0000_request_description_again', HASH_OTHER, HASH_DELETED),
    ];

    expect(mismatch(ledger)).toEqual(
      expectedEnvelope({
        why: `${AFTER_LAST} it applied 20261013T0910_first, which is no longer on disk, and 20261014T0000_request_description_again, which has since been planned again with different content.`,
        from: HASH_A,
        meta: { ...META, lastGraphHash: HASH_A, missingMigrations: ['20261013T0910_first'] },
      }),
    );
  });

  it('says db update moved the database when the rows after the last graph contract name no migration', () => {
    const ledger = [
      applied('20261001T0000_initial', null, HASH_A),
      movedByDbUpdate(HASH_A, HASH_DELETED),
    ];

    expect(mismatch(ledger)).toEqual(
      expectedEnvelope({
        why: `${AFTER_LAST} ${MOVED_BY_DB_UPDATE}`,
        from: HASH_A,
        meta: { ...META, lastGraphHash: HASH_A, missingMigrations: [] },
      }),
    );
  });

  it('names the missing migrations and the db update move when both followed the last graph contract', () => {
    const ledger = [
      applied('20261001T0000_initial', null, HASH_A),
      applied('20261013T0910_request_description', HASH_A, HASH_OTHER),
      movedByDbUpdate(HASH_OTHER, HASH_DELETED),
    ];

    expect(mismatch(ledger)).toEqual(
      expectedEnvelope({
        why: `${AFTER_LAST} it applied 20261013T0910_request_description, which is no longer on disk. After that, ${MOVED_BY_DB_UPDATE}`,
        from: HASH_A,
        meta: {
          ...META,
          lastGraphHash: HASH_A,
          missingMigrations: ['20261013T0910_request_description'],
        },
      }),
    );
  });

  it('says the marker moved without a migration when nothing followed the last graph contract', () => {
    const ledger = [applied('20261001T0000_initial', null, HASH_A)];

    expect(mismatch(ledger)).toEqual(
      expectedEnvelope({
        why: `${AFTER_LAST} its marker was moved without a migration, for example by \`db sign\`.`,
        from: HASH_A,
        meta: { ...META, lastGraphHash: HASH_A, missingMigrations: [] },
      }),
    );
  });

  it.each([
    { case: 'the ledger is empty', ledger: [] },
    {
      case: 'no ledger entry ends in the graph',
      ledger: [
        applied('20261013T0910_first', null, HASH_OTHER),
        applied('20261013T0911_second', HASH_OTHER, HASH_DELETED),
      ],
    },
  ])(
    'leaves the history out and starts from the nearest graph contract when $case',
    ({ ledger }) => {
      expect(mismatch(ledger)).toEqual(
        expectedEnvelope({
          why: CAUSE_UNKNOWN,
          from: 'the nearest contract in the migration graph',
          meta: { ...META, missingMigrations: [] },
        }),
      );
    },
  );

  it('leaves the history and missingMigrations out when the ledger could not be read', () => {
    expect(mismatch(undefined)).toEqual(
      expectedEnvelope({
        why: CAUSE_UNKNOWN,
        from: 'the nearest contract in the migration graph',
        meta: META,
      }),
    );
  });

  it('reconciles to the emitted contract with no --to when no migration ends at the target', () => {
    const envelope = mismatch([], {
      owner: { kind: 'application', emittedContractHash: HASH_EMITTED },
      targetHash: HASH_EMITTED,
    });

    expect(envelope.nextActions).toEqual([
      { kind: 'user-choice', label: MOVE_WITH_DB_UPDATE },
      {
        kind: 'run-command',
        label: 'Preview the changes',
        command: '{bin} db update --dry-run --db <url>',
      },
      {
        kind: 'run-command',
        label: 'Reconcile the database',
        command: '{bin} db update --db <url>',
      },
      {
        kind: 'user-choice',
        label: otherwise('the nearest contract in the migration graph', HASH_EMITTED),
      },
    ]);
  });

  it('prints no db update when neither a migration nor the emitted contract names the target', () => {
    const envelope = mismatch([], { targetHash: HASH_OTHER });

    expect({ fix: envelope.fix, nextActions: envelope.nextActions }).toEqual({
      fix: migrationsOnly('the nearest contract in the migration graph', HASH_OTHER),
      nextActions: [
        {
          kind: 'user-choice',
          label: migrationsOnly('the nearest contract in the migration graph', HASH_OTHER),
        },
      ],
    });
  });

  it('asks for one migration ending at the target when the database is already there', () => {
    const envelope = mismatch([applied('20261001T0000_initial', null, HASH_A)], {
      targetHash: HASH_DELETED,
    });
    const authorOne = `The database is already at the target, but no migration ends there: author a migration from ${HASH_A} to ${HASH_DELETED}, commit it, and deploy again.`;

    expect({ fix: envelope.fix, nextActions: envelope.nextActions }).toEqual({
      fix: authorOne,
      nextActions: [{ kind: 'user-choice', label: authorOne }],
    });
  });

  it('starts the authored migrations from the empty contract when the space has no migrations', () => {
    const envelope = mismatch([], { graph: buildGraph([]) });

    expect(envelope.nextActions.at(-1)).toEqual({
      kind: 'user-choice',
      label: otherwise('the empty contract'),
    });
  });

  it('sends an extension space to the extension package, not to db update or authored migrations', () => {
    const ledger = [
      { ...applied('20260101T0000_ext_initial', null, HASH_A), space: 'pgvector' },
      { ...applied('20260102T0000_ext_newer', HASH_A, HASH_DELETED), space: 'pgvector' },
    ];
    const install = `Install a version of the extension whose migrations include the contract the database is at (${HASH_DELETED}), or ask the extension's maintainers for one.`;
    const list = '{bin} migration list --space pgvector';

    expect(mismatch(ledger, { spaceId: 'pgvector', owner: { kind: 'extension' } })).toEqual({
      ok: false,
      code: 'MIGRATION.MARKER_MISMATCH',
      severity: 'error',
      summary: SUMMARY,
      why: `The database's marker names ${HASH_DELETED}, which no migration in migrations/pgvector starts or ends at. The migrations of extension space "pgvector" come with the extension; it was changed to a version whose migrations do not include that contract.`,
      fix: [install, `List the space's migrations with \`${list}\`.`].join('\n'),
      nextActions: [
        { kind: 'user-choice', label: install },
        {
          kind: 'run-command',
          label: 'List the migrations of extension space "pgvector"',
          command: list,
        },
      ],
      meta: {
        spaceId: 'pgvector',
        markerHash: HASH_DELETED,
        targetHash: HASH_B,
        lastGraphHash: HASH_A,
        missingMigrations: ['20260102T0000_ext_newer'],
      },
    });
  });

  it('prints the commands with the --config the CLI was given and no --db when it was not given', () => {
    const envelope = mismatch([], {
      invocation: { cwd: '/work/app', configPath: 'config/prisma.config.ts', dbGiven: false },
    });

    expect(
      envelope.nextActions.flatMap((action) =>
        action.command === undefined ? [] : [action.command],
      ),
    ).toEqual([
      `{bin} db update --to ${HASH_B} --dry-run --config config/prisma.config.ts`,
      `{bin} db update --to ${HASH_B} --config config/prisma.config.ts`,
    ]);
  });
});

describe('readLedgerQuietly', () => {
  it('returns the ledger the read gives', async () => {
    const ledger = [applied('20261001T0000_initial', null, HASH_A)];

    expect(await readLedgerQuietly(async () => ledger)).toEqual(ledger);
  });

  it('returns undefined when the read fails', async () => {
    expect(
      await readLedgerQuietly(async () => {
        throw new Error('permission denied for table _prisma_ledger');
      }),
    ).toBeUndefined();
  });
});
