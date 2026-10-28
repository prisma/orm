/**
 * Re-export all domain error factories from @internal/errors for convenience.
 * CLI-specific errors (e.g., Commander argument validation in the main CLI, or
 * clipanion parse errors in the migration-file CLI) can be added here if needed.
 */
export type { CliErrorConflict, CliErrorEnvelope } from '@internal/errors/control';

import {
  CliStructuredError,
  errorConfigFileNotFound,
  errorConfigValidation,
  errorContractConfigMissing,
  errorContractMissingExtensions,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorFamilyReadMarkerSqlRequired,
  errorFileNotFound,
  errorInvalidOutputFormat,
  errorMigrationCliInvalidConfigArg,
  errorMigrationCliUnknownFlag,
  errorMigrationPlanningFailed,
  errorOutputFormatMutex,
  errorQueryRunnerFactoryRequired,
  errorTargetMigrationNotSupported,
  errorUnexpected,
} from '@internal/errors/control';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { RefResolutionError } from '@internal/migration-tools/ref-resolution';
import { ifDefined } from '@internal/utils/defined';
import type { NextAction } from '@prisma/cli-engine/protocol';
import { statementFlag } from '../control-api/statements/statement-flag';
import type { StatementText } from '../control-api/statements/statement-text';
import { chooseAction, runCommandAction } from './next-actions';
import { type CliInvocation, cliCommand, printedPlanCommand } from './printed-command';

export {
  errorHashMismatch,
  errorMarkerMissing,
  errorMarkerRequired,
  errorRuntime,
  errorTargetMismatch,
} from '@internal/errors/execution';
export {
  errorMigrationFileMissing,
  errorMigrationInvalidDefaultExport,
  errorMigrationPlanNotArray,
  errorUnfilledPlaceholder,
  placeholder,
} from '@internal/errors/migration';
export {
  CliStructuredError,
  errorConfigFileNotFound,
  errorConfigValidation,
  errorContractConfigMissing,
  errorContractMissingExtensions,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorFamilyReadMarkerSqlRequired,
  errorFileNotFound,
  errorInvalidOutputFormat,
  errorMigrationCliInvalidConfigArg,
  errorMigrationCliUnknownFlag,
  errorMigrationPlanningFailed,
  errorOutputFormatMutex,
  errorQueryRunnerFactoryRequired,
  errorTargetMigrationNotSupported,
  errorUnexpected,
};

/**
 * A CLI-raised error that carries the typed remediation as well as the prose.
 * Only the CLI knows which invocation fixes a failure, so only errors raised
 * here spell one; the foundation classes every library also raises keep
 * carrying `code`, `why` and `fix` alone.
 *
 * Both fields are required: the `fix` prose is what the commander shell still
 * renders, and the handler boundary drops it in favour of `nextActions` when it
 * settles the engine's envelope.
 */
export class ActionableCliError extends CliStructuredError {
  override readonly nextActions: readonly NextAction[];

  constructor(
    code: `${string}.${string}`,
    summary: string,
    options: {
      readonly why?: string;
      readonly fix: string;
      readonly nextActions: readonly NextAction[];
      readonly meta?: Record<string, unknown>;
      readonly docsUrl?: string;
      readonly cause?: unknown;
    },
  ) {
    super(code, summary, options);
    this.nextActions = options.nextActions;
  }
}

/**
 * A command that accepts a contract reference both as a positional and as a
 * flag was given both. Structured rather than a bare stderr line, so a script
 * sees the same envelope every other invocation failure produces.
 */
export function errorContractArgConflict(options: {
  readonly positional: string;
  readonly flag: string;
}): ActionableCliError {
  const fix =
    'Pass the contract reference once — either as the positional argument or as --contract.';
  return new ActionableCliError(
    'CLI.CONTRACT_ARG_CONFLICT',
    'Cannot specify both a positional contract argument and --contract',
    {
      why: `The positional argument names "${options.positional}" and --contract names "${options.flag}"; there is no rule for which wins.`,
      fix,
      nextActions: [chooseAction(fix)],
      meta: { positional: options.positional, flag: options.flag },
    },
  );
}

/**
 * A command was told both which ref to advance and not to advance any ref.
 * Same envelope as the positional/flag contract conflict, so a script sees
 * every invocation conflict in one shape.
 */
export function errorAdvanceRefArgConflict(options: {
  readonly advanceRef: string;
}): ActionableCliError {
  const fix = 'Pass either --advance-ref <name> or --no-advance-ref, not both.';
  return new ActionableCliError(
    'CLI.ADVANCE_REF_ARG_CONFLICT',
    'Cannot specify both --advance-ref and --no-advance-ref',
    {
      why: `--advance-ref names "${options.advanceRef}" while --no-advance-ref asks for no ref to be written; there is no rule for which wins.`,
      fix,
      nextActions: [chooseAction(fix)],
      meta: { advanceRef: options.advanceRef },
    },
  );
}

/** A ref `db sign` meant to advance, and why writing it or its snapshot failed. */
export interface UnwrittenRef {
  readonly space: string;
  readonly name: string;
  readonly hash: string;
  readonly reason: string;
}

function quotedSpaces(spaces: readonly string[]): string {
  return spaces.map((space) => `"${space}"`).join(', ');
}

function notSignedSentence(
  spaces: readonly string[],
  because: string,
  becausePlural: string,
): string {
  if (spaces.length === 0) return '';
  return spaces.length === 1
    ? ` Space ${quotedSpaces(spaces)} was not signed, because ${because}.`
    : ` Spaces ${quotedSpaces(spaces)} were not signed, because ${becausePlural}.`;
}

/**
 * `db sign` wrote the markers, then failed to write one or more refs or their snapshots. The database is signed; running the command again writes the refs. The error also names the spaces it did not sign: those whose schema failed verification, and those whose marker changed while it ran.
 */
export function errorSignRefsNotWritten(options: {
  readonly signedSpaces: readonly string[];
  readonly failedSpaces: readonly string[];
  readonly conflictSpaces: readonly string[];
  readonly unwrittenRefs: readonly UnwrittenRef[];
  readonly advancedRefs: readonly {
    readonly space: string;
    readonly name: string;
    readonly hash: string;
  }[];
  readonly rerunCommand: string;
  readonly cause: unknown;
}): ActionableCliError {
  const { signedSpaces, failedSpaces, conflictSpaces, unwrittenRefs, rerunCommand } = options;
  const markers =
    signedSpaces.length === 1
      ? `the marker of space ${quotedSpaces(signedSpaces)} holds its contract`
      : `the markers of spaces ${quotedSpaces(signedSpaces)} hold their contracts`;
  const notSigned =
    notSignedSentence(
      failedSpaces,
      'its schema does not satisfy its contract',
      'their schemas do not satisfy their contracts',
    ) +
    notSignedSentence(
      conflictSpaces,
      'its marker changed while db sign ran',
      'their markers changed while db sign ran',
    );
  const refs = unwrittenRefs
    .map((ref) => `ref "${ref.name}" of space "${ref.space}" (${ref.reason})`)
    .join('; ');
  const count = unwrittenRefs.length;
  return new ActionableCliError(
    'MIGRATION.SIGN_REFS_NOT_WRITTEN',
    `Database signed, but ${count} ${count === 1 ? 'ref was' : 'refs were'} not written`,
    {
      why: `The database was signed: ${markers}.${notSigned} These refs were not written: ${refs}.`,
      fix: `Fix what stopped the write, then run \`${rerunCommand}\` again: the markers already hold the contracts, so it writes only the refs.`,
      nextActions: [
        runCommandAction('Sign again to write the refs that were not written', rerunCommand),
      ],
      meta: {
        signedSpaces,
        failedSpaces,
        conflictSpaces,
        unwrittenRefs,
        advancedRefs: options.advancedRefs,
      },
      cause: options.cause,
    },
  );
}

export function errorRefSetHashNotInGraph(
  resolvedHash: string,
  reachableHashes: readonly string[],
): ActionableCliError {
  const reachableList =
    reachableHashes.length > 0 ? reachableHashes.join(', ') : '(none — migration graph is empty)';
  const fix =
    reachableHashes.length > 0
      ? 'Set the ref to the `to` hash of an on-disk migration; `{bin} migration list` shows them.'
      : 'Run `{bin} migration plan` first.';
  const nextActions =
    reachableHashes.length > 0
      ? [
          runCommandAction(
            'List the migrations and their destination hashes',
            '{bin} migration list',
          ),
          chooseAction('Set the ref to the `to` hash of one of them'),
        ]
      : [runCommandAction('Plan the first migration', '{bin} migration plan')];
  return new ActionableCliError(
    'MIGRATION.HASH_NOT_IN_GRAPH',
    `Resolved contract hash is not in the migration graph: ${resolvedHash}`,
    {
      why:
        reachableHashes.length > 0
          ? `The migration graph reaches ${reachableList}; resolved ${resolvedHash} isn't a graph node.`
          : 'The migration graph is empty — no hashes reachable.',
      fix,
      nextActions,
      meta: {
        resolvedHash,
        reachableHashes: [...reachableHashes],
      },
    },
  );
}

export function errorRefSetEmptySentinel(hash: string): ActionableCliError {
  return new ActionableCliError(
    'MIGRATION.REF_SET_EMPTY_SENTINEL',
    `Cannot set ref to the empty-database sentinel: ${hash}`,
    {
      why: 'The empty-database sentinel is a planner internal; it is not a valid ref target.',
      fix: 'Set the ref to a contract hash from the migration graph, or use another ref name.',
      nextActions: [
        chooseAction('Set the ref to a contract hash from the migration graph'),
        chooseAction('Or use another ref name'),
      ],
      meta: {
        hash,
      },
    },
  );
}

/**
 * `--legend` was combined with a machine-readable or silent output flag.
 * The legend is human-only decoration on stderr.
 */
export function errorLegendHumanOnly(
  conflictingFlag: '--json' | '--dot' | '--quiet',
): ActionableCliError {
  return new ActionableCliError(
    'MIGRATION.LEGEND_HUMAN_ONLY',
    '`--legend` is only available for human-readable output',
    {
      why: `\`--legend\` prints a glyph key to stderr and cannot be combined with ${conflictingFlag}.`,
      fix: `Omit ${conflictingFlag} to print the legend alongside the tree, or omit --legend when using ${conflictingFlag}.`,
      nextActions: [
        chooseAction(`Omit ${conflictingFlag} to print the legend alongside the tree`),
        chooseAction(`Or omit --legend when using ${conflictingFlag}`),
      ],
      meta: {
        conflictingFlag,
      },
    },
  );
}

/**
 * `--space <id>` was given a value that doesn't satisfy the contract-space
 * naming rule (`[a-z][a-z0-9_-]{0,63}` per `isValidSpaceId`). Fires before
 * any fs work — the input is syntactically rejected the same way an on-disk
 * directory with that name would be skipped by the enumerator.
 */
export function errorInvalidSpaceId(spaceId: string): ActionableCliError {
  return new ActionableCliError(
    'MIGRATION.INVALID_SPACE_ID',
    `Invalid contract space id: ${spaceId}`,
    {
      why: 'Contract space ids must match [a-z][a-z0-9_-]{0,63} (lowercase, starts with a letter, max 64 characters — the rule applied to every on-disk space directory).',
      fix: 'Pass a space id that matches the directory naming rule, or omit --space to list every space.',
      nextActions: [
        chooseAction('Pass a space id matching [a-z][a-z0-9_-]{0,63}'),
        runCommandAction('Or list every space', '{bin} migration list'),
      ],
      meta: {
        spaceId,
      },
    },
  );
}

/**
 * `migration list --space <id>` was given a contract-space id that has no
 * directory under `migrations/`. Distinct from "the space exists but is
 * empty" — that path renders the empty-state line and exits 0 per the
 * slice spec § Empty-state. This error fires only when `<projectMigrationsDir>/<spaceId>`
 * does not exist on disk.
 *
 * `availableSpaces` lists the contract-space directory names actually
 * present, sorted lex-asc, so the diagnostic can suggest a near match
 * without making the user reach for `ls`.
 */
export function errorSpaceNotFound(
  spaceId: string,
  availableSpaces: readonly string[],
): ActionableCliError {
  const availableList =
    availableSpaces.length > 0
      ? availableSpaces.join(', ')
      : '(none — no contract spaces on disk yet)';
  const fix =
    availableSpaces.length > 0
      ? `Pick one of: ${availableList}. Run \`{bin} migration list\` (no --space) to see every space's migrations.`
      : 'Author a migration with `{bin} migration new` to create the first contract-space directory.';
  const nextActions =
    availableSpaces.length > 0
      ? [
          chooseAction(`Pick one of: ${availableList}`),
          runCommandAction("See every space's migrations", '{bin} migration list'),
        ]
      : [
          runCommandAction(
            'Author the first migration, which creates the contract-space directory',
            '{bin} migration new',
          ),
        ];
  return new ActionableCliError('MIGRATION.SPACE_NOT_FOUND', `Unknown contract space: ${spaceId}`, {
    why: `No directory named "${spaceId}" exists under the migrations root.`,
    fix,
    nextActions,
    meta: {
      spaceId,
      availableSpaces: [...availableSpaces],
    },
  });
}

/**
 * A `migration show` target resolved to a directory or a graph node, but no
 * on-disk package was loaded for it.
 */
export function errorMigrationPackageNotFound(why: string): ActionableCliError {
  return new ActionableCliError('MIGRATION.PACKAGE_NOT_FOUND', 'Migration package not found', {
    why,
    fix: 'Pass a directory name, hash prefix, or path to an on-disk app-space migration package.',
    nextActions: [
      chooseAction(
        'Pass a directory name, hash prefix, or path to an on-disk app-space migration package',
      ),
      runCommandAction('List what is on disk', '{bin} migration list'),
    ],
  });
}

/** The app space has no migration packages at all, so no target can resolve. */
export function errorNoMigrations(appMigrationsRelative: string): ActionableCliError {
  return new ActionableCliError('MIGRATION.NO_MIGRATIONS', 'No migrations found', {
    why: `No migration packages found in ${appMigrationsRelative}`,
    fix: 'Run `{bin} migration plan` to create a migration first.',
    nextActions: [runCommandAction('Create the first migration', '{bin} migration plan')],
  });
}

export function errorRefSetBundleNotFound(hash: string): ActionableCliError {
  return new ActionableCliError(
    'MIGRATION.REF_SET_BUNDLE_NOT_FOUND',
    `No migration bundle matches graph-node hash ${hash}`,
    {
      why: `The hash is a graph node but no on-disk bundle has metadata.to = ${hash}.`,
      fix: 'Run `pnpm fixtures:check`, or re-emit the migration that produces this hash so its bundle is restored.',
      nextActions: [
        runCommandAction('Restore the checked-in fixtures', 'pnpm fixtures:check'),
        chooseAction('Or re-emit the migration that produces this hash'),
      ],
      meta: {
        hash,
      },
    },
  );
}

export function errorPlanForgotTheFlag(
  resolvedHash: string,
  reachableRefs: ReadonlyArray<{ readonly name: string; readonly hash: string }>,
  options?: { readonly cause?: unknown },
): ActionableCliError {
  const reachableList =
    reachableRefs.length > 0
      ? reachableRefs.map((r) => `${r.name} (${r.hash})`).join(', ')
      : '(none)';
  const refFix =
    reachableRefs.length > 0
      ? `Run migration plan with ${reachableRefs.map((r) => `--from ${r.name}`).join(' or ')}.`
      : 'Pass --from <contract> naming the `to` hash of an on-disk migration (`{bin} migration list` shows them), or point the db ref at one with `{bin} migration ref set db <contract>`.';
  const nextActions =
    reachableRefs.length > 0
      ? reachableRefs.map((ref) =>
          runCommandAction(`Plan from ${ref.name}`, `{bin} migration plan --from ${ref.name}`),
        )
      : [
          runCommandAction(
            'Plan from an explicit origin',
            '{bin} migration plan --from <contract>',
          ),
          runCommandAction(
            'Point the db ref at a graph node',
            '{bin} migration ref set db <contract>',
          ),
        ];
  return new ActionableCliError(
    'MIGRATION.HASH_NOT_IN_GRAPH',
    `Resolved from-hash is not in the migration graph: ${resolvedHash}`,
    {
      why: `The migration graph reaches ${reachableList}; resolved ${resolvedHash} isn't a graph node.`,
      fix: refFix,
      nextActions,
      meta: {
        resolvedHash,
        reachableRefs: reachableRefs.map((r) => r.name),
      },
      ...ifDefined('cause', options?.cause),
    },
  );
}

/**
 * `viaRef: true` (the default) mirrors migration-tools' `errorRefNotResolvable`:
 * a ref name with no pointer file, where the fallback hash isn't a graph
 * node either — there's nothing to materialize a contract from.
 * `viaRef: false` is a distinct, ref-independent case: an explicit `--from
 * <hash>` that doesn't name a ref, on an empty migration graph, so there is
 * no graph node and no ref to resolve a contract through.
 */
export function errorSnapshotMissing(
  identifier: string,
  options?: { readonly viaRef?: boolean; readonly cause?: unknown },
): ActionableCliError {
  const viaRef = options?.viaRef !== false;
  const fix = viaRef
    ? `Create the ref with "{bin} migration ref set ${identifier} <hash>" (or advance it via "{bin} db update --advance-ref ${identifier}"), or pass a hash that is a node in the migration graph.`
    : `No contract source exists for hash "${identifier}" on an empty migration graph. Use --from with a ref name (its contract resolves through the snapshot store), or run db update first.`;
  const nextActions = viaRef
    ? [
        runCommandAction(
          `Create the ref "${identifier}"`,
          `{bin} migration ref set ${identifier} <hash>`,
        ),
        runCommandAction(
          'Or advance it from the database',
          `{bin} db update --advance-ref ${identifier}`,
        ),
        chooseAction('Or pass a hash that is a node in the migration graph'),
      ]
    : [
        chooseAction('Pass --from a ref name, whose contract resolves through the snapshot store'),
        runCommandAction('Or populate the graph first', '{bin} db update'),
      ];
  return new ActionableCliError(
    'MIGRATION.SNAPSHOT_MISSING',
    viaRef
      ? `Ref "${identifier}" is not resolvable`
      : `No contract source for from-hash "${identifier}"`,
    {
      why: viaRef
        ? `Ref "${identifier}" has no pointer file, and the hash being resolved is not a node in the migration graph either.`
        : `Hash "${identifier}" is not a node in the migration graph (the graph is empty), and it does not name a ref either.`,
      fix,
      nextActions,
      meta: {
        identifier,
        viaRef,
      },
      ...ifDefined('cause', options?.cause),
    },
  );
}

/**
 * Default origin resolution for `migration plan` found nothing (no `--from`,
 * no `db` ref) while migrations already exist on disk. Planning would silently
 * produce an empty-origin migration that ignores the existing history — almost
 * always a mistake — so the command refuses and names the three exits.
 */
export function errorPlanOriginUnknown(
  reachableRefs: ReadonlyArray<{ readonly name: string; readonly hash: string }>,
): ActionableCliError {
  const fromSuggestion =
    reachableRefs.length > 0
      ? reachableRefs.map((r) => `--from ${r.name}`).join(' or ')
      : '--from <contract>';
  const refSetCommand = '{bin} migration ref set db <contract>';
  return new ActionableCliError(
    'MIGRATION.PLAN_ORIGIN_UNKNOWN',
    'Cannot determine the plan origin: migrations exist but no origin is named',
    {
      why: 'Migrations exist on disk, but there is no `db` ref and no --from was given, so the plan origin would silently fall back to an empty database and the resulting migration would recreate everything the existing migrations already create.',
      fix: [
        `Set the \`db\` ref to the contract your database is at (\`${refSetCommand}\`), or, on a database whose migration history does not need to be kept, advance it via \`{bin} db update\`.`,
        `Or pass the origin explicitly: \`{bin} migration plan ${fromSuggestion}\`.`,
        'Or pass --from @empty to deliberately plan from an empty database.',
      ].join('\n'),
      nextActions: [
        runCommandAction('Point the db ref at the origin contract', refSetCommand),
        ...(reachableRefs.length > 0
          ? reachableRefs.map((ref) =>
              runCommandAction(`Plan from ${ref.name}`, `{bin} migration plan --from ${ref.name}`),
            )
          : [
              runCommandAction(
                'Plan from an explicit origin',
                `{bin} migration plan ${fromSuggestion}`,
              ),
            ]),
        runCommandAction(
          'Plan from an empty database deliberately',
          '{bin} migration plan --from @empty',
        ),
      ],
      meta: {
        reachableRefs: reachableRefs.map((r) => r.name),
      },
    },
  );
}

/**
 * A statement is malformed, or names two things that cannot be
 * renamed into each other (a model and a field, or fields of two models).
 */
/** A statement as the user wrote it: its verb and its text. */
interface WrittenStatement {
  readonly verb: string;
  readonly text: string;
}

export function errorStatementInvalid(
  statement: WrittenStatement,
  why: string,
  fix: string,
): ActionableCliError {
  return new ActionableCliError(
    'MIGRATION.STATEMENT_INVALID',
    `Invalid statement "--${statement.verb} ${statement.text}"`,
    {
      why,
      fix,
      nextActions: [chooseAction(fix)],
      meta: { statement: statement.text, verb: statement.verb },
    },
  );
}

/**
 * A statement is well formed, but its names do not resolve in the
 * origin and destination contracts the way a rename requires.
 */
export function errorStatementUnresolved(
  statement: WrittenStatement,
  why: string,
  fix: string,
): ActionableCliError {
  return new ActionableCliError(
    'MIGRATION.STATEMENT_UNRESOLVED',
    `Cannot resolve statement "--${statement.verb} ${statement.text}"`,
    {
      why,
      fix,
      nextActions: [chooseAction(fix)],
      meta: { statement: statement.text, verb: statement.verb },
    },
  );
}

/**
 * A rename or convert typed in answer to a data-loss question was planned, and the plan still loses
 * the subject's data: the statement does not account for the operation the question was about.
 */
export function errorStatementDidNotResolveLoss(
  statement: WrittenStatement,
  subject: string,
): ActionableCliError {
  const fix = `Answer the question about "${subject}" with ${statementFlag({ verb: 'delete', text: subject })} if its data may be lost, or give a ${statement.verb} statement that keeps that data.`;
  return new ActionableCliError(
    'MIGRATION.STATEMENT_DID_NOT_RESOLVE_LOSS',
    `"--${statement.verb} ${statement.text}" does not keep the data of "${subject}"`,
    {
      why: `The plan was made again with the statement, and it still loses the data of "${subject}".`,
      fix,
      nextActions: [chooseAction(fix)],
      meta: { statement: statement.text, verb: statement.verb, subject },
    },
  );
}

/** `--convert` and `--delete` name the same field, and each answers its type change differently. */
export function errorConvertAndDelete(field: string): ActionableCliError {
  const fix = `Give one of them: ${statementFlag({ verb: 'convert', text: field })}, or ${statementFlag({ verb: 'delete', text: field })}.`;
  return new ActionableCliError(
    'MIGRATION.STATEMENT_INVALID',
    `"--convert ${field}" and "--delete ${field}" conflict`,
    {
      why: `Both answer the type change of "${field}": --convert converts each value with code you write in migration.ts, and --delete lets the database cast each value, losing those it cannot keep.`,
      fix,
      nextActions: [chooseAction(fix)],
      meta: { statement: field, verb: 'convert' },
    },
  );
}

const MIGRATION_PLAN_VERBS: readonly string[] = ['rename', 'delete', 'convert', 'backfill'];

/**
 * `--convert` or `--backfill` statements were given to `db update`, which applies its plan
 * directly and so has no migration file whose slot the user could fill. `statements` are every
 * statement the user gave, in the order given: the `migration plan` command the error suggests
 * carries each one that command accepts, and starts from `databaseStorageHash`, the contract the
 * database is at, when it is known. Its commands repeat the `--config` of `invocation`.
 */
export function errorStatementNeedsMigrationFile(
  statements: readonly StatementText[],
  invocation: CliInvocation | undefined,
  databaseStorageHash?: string,
): ActionableCliError {
  const refused = statements.filter(({ verb }) => verb === 'convert' || verb === 'backfill');
  const written = refused.map(({ verb, text }) => `"--${verb} ${text}"`);
  const listed =
    written.length === 1 ? written[0] : `${written.slice(0, -1).join(', ')} and ${written.at(-1)}`;
  const plan = printedPlanCommand(
    invocation,
    databaseStorageHash,
    statements.filter(({ verb }) => MIGRATION_PLAN_VERBS.includes(verb)).map(statementFlag),
  );
  return new ActionableCliError(
    'MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE',
    `db update cannot carry out ${listed}`,
    {
      why: '--convert and --backfill ask for a migration file with a slot for the code that converts or fills in the values, and db update has no migration file to fill: it applies its plan directly.',
      fix: `Plan the change with ${plan}, fill in the migration.ts it writes, run that migration.ts with the \`node\` command \`migration plan\` prints, and apply it with ${cliCommand(invocation, 'db migrate')}. Or leave out these statements: db update then asks before it loses any data.`,
      nextActions: [
        runCommandAction('Plan the change into a migration file to fill in', plan),
        chooseAction('Or run db update without these statements'),
      ],
      meta: { statements: refused.map(({ verb, text }) => ({ verb, text })) },
    },
  );
}

/**
 * Consent flags the command took from the CLI engine and that answered no question: the engine's
 * own `CLI.CONSENT_UNUSED`, in its words, for values the engine no longer holds.
 */
/** A consent flag nothing used, and the flag that had already answered its question, if one did. */
export interface UnusedConsent extends WrittenStatement {
  readonly alreadyAnsweredBy:
    | { readonly kind: 'subject'; readonly subject: string; readonly flag: WrittenStatement }
    | { readonly kind: 'namespace'; readonly namespace: string }
    | undefined;
}

function unusedConsentSentence({
  verb,
  text,
  alreadyAnsweredBy: answeredBy,
}: UnusedConsent): string {
  if (answeredBy === undefined) {
    return `--${verb} ${text} was given but nothing in this run asked about ${text}.`;
  }
  if (answeredBy.kind === 'namespace') {
    return `--${verb} ${text} was given, but every question about namespace "${answeredBy.namespace}" was already answered by another flag.`;
  }
  return `--${verb} ${text} was given, but the question about ${answeredBy.subject} was already answered by --${answeredBy.flag.verb} ${answeredBy.flag.text}.`;
}

export function errorConsentUnused(
  unused: readonly UnusedConsent[],
  asked: readonly string[],
): CliStructuredError {
  const actions = [
    ...(unused.some(({ alreadyAnsweredBy }) => alreadyAnsweredBy === undefined)
      ? ['Remove the flag, or spell the subject the way the command names it.']
      : []),
    ...(unused.some(({ alreadyAnsweredBy }) => alreadyAnsweredBy !== undefined)
      ? ['Give one flag per question.']
      : []),
  ];
  return new CliStructuredError('CLI.CONSENT_UNUSED', unused.map(unusedConsentSentence).join(' '), {
    ...ifDefined(
      'why',
      asked.length === 0 ? undefined : `The run asked about ${asked.join(', ')}.`,
    ),
    nextActions: actions.map((label) => ({ kind: 'user-choice', label })),
    meta: {
      unused: unused.map(({ verb, text }) => ({ verb, values: [text] })),
      ...(asked.length === 0 ? {} : { asked }),
    },
  });
}

/**
 * `delete` or `allow` statements given to a programmatic call match no question the plan asks,
 * so they consent to nothing.
 */
export function errorStatementAnswersNoQuestion(
  statements: readonly WrittenStatement[],
  subjects: readonly string[],
): ActionableCliError {
  const written = statements.map(({ verb, text }) => `"--${verb} ${text}"`);
  const listed =
    written.length === 1
      ? `Statement ${written[0]} answers`
      : `Statements ${written.slice(0, -1).join(', ')} and ${written.at(-1)} answer`;
  const fix =
    subjects.length === 0
      ? 'Leave the statements out: the plan asks no question.'
      : `Leave them out, or name a subject the plan asks about: ${subjects.join(', ')}.`;
  return new ActionableCliError(
    'MIGRATION.STATEMENT_ANSWERS_NO_QUESTION',
    `${listed} no question of the plan`,
    {
      why: 'A delete or allow statement consents to an operation the plan asks about, and these name no subject the plan would lose data from or change access to.',
      fix,
      nextActions: [chooseAction(fix)],
      meta: {
        statements: statements.map(({ verb, text }) => ({ verb, text })),
        subjects,
      },
    },
  );
}

/**
 * Without statements, `db update` drops a renamed table or column and creates it again under the
 * new name, so any advice to run without them says so.
 */
const WITHOUT_STATEMENTS_DROPS =
  'A plan made without statements drops the storage of each renamed model or field with its data and creates it again under the new name, and asks for consent before it does.';

/** How to store the snapshot of the contract the database is at, so statements can resolve. */
export const STORE_ORIGIN_SNAPSHOT_STEPS = [
  '1. Put the contract source back to the version the database is at, and run `{bin} contract emit`.',
  '2. Run `{bin} db update --advance-ref <name> --dry-run`, with the same `--db` as this command if it has one, and check that it plans no operations. Then run it again without `--dry-run`: the database matches that contract, so this changes nothing in it, and it stores the contract snapshot. If the dry run plans operations, the database has drifted from that contract; settle that before you go on.',
  '3. Put the new contract source back, run `{bin} contract emit`, and run this command again with `--advance-ref <name>`.',
];

/**
 * Statements were given, but there is no origin contract to resolve their old
 * names against.
 */
export function errorStatementOriginUnknown(origin: {
  readonly hash: string | null;
  readonly snapshotDirectory: string;
  readonly unreadable: string | undefined;
}): ActionableCliError {
  if (origin.hash === null) {
    return new ActionableCliError(
      'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
      'Cannot resolve statements: the database has no marker',
      {
        why: 'The database has no marker: Prisma has never initialised or updated it, so there is no earlier contract whose names a statement could rename.',
        fix: `Leave out the statements. If the database already holds data under the old names, preview the plan with --dry-run first. ${WITHOUT_STATEMENTS_DROPS}`,
        nextActions: [
          chooseAction(
            `Leave out the statements, and preview the plan with --dry-run first. ${WITHOUT_STATEMENTS_DROPS}`,
          ),
        ],
        meta: { hash: null, snapshotDirectory: origin.snapshotDirectory },
      },
    );
  }
  const meta = {
    hash: origin.hash,
    snapshotDirectory: origin.snapshotDirectory,
    ...ifDefined('unreadable', origin.unreadable),
  };
  if (origin.unreadable !== undefined) {
    return new ActionableCliError(
      'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
      'Cannot resolve statements: the origin contract snapshot cannot be read',
      {
        why: `The contract snapshot for hash "${origin.hash}" in ${origin.snapshotDirectory} could not be read: ${origin.unreadable}`,
        fix: [
          'Restore migrations/snapshots/ from version control. If no good copy exists, store the snapshot again:',
          ...STORE_ORIGIN_SNAPSHOT_STEPS,
        ].join('\n'),
        nextActions: [
          chooseAction('Restore migrations/snapshots/ from version control'),
          chooseAction('Or store the snapshot again from the contract the database is at'),
        ],
        meta,
      },
    );
  }
  return new ActionableCliError(
    'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
    'Cannot resolve statements: the origin contract is unknown',
    {
      why: `No contract snapshot for hash "${origin.hash}" was found in ${origin.snapshotDirectory}. Statements name things in the contract the database is at, so the command needs that contract. \`db update\` stores the snapshot of the contract it applies only when it advances a ref: the \`db\` ref by default, or with \`--db <url>\` only the ref named by \`--advance-ref <name>\`. Most likely the run that brought the database to this contract advanced no ref.`,
      fix: [
        'Store the snapshot of the contract the database is at, then run the rename:',
        ...STORE_ORIGIN_SNAPSHOT_STEPS,
        'Adding --advance-ref to this command alone does not help: it would store the new contract, not the one the database is at. `migration plan --from` does not apply to `db update`.',
      ].join('\n'),
      nextActions: [
        chooseAction('Put the contract source back to the version the database is at, and emit it'),
        runCommandAction(
          'Check that it plans no operations (with the same --db as this command, if any)',
          '{bin} db update --advance-ref <name> --dry-run',
        ),
        runCommandAction(
          'Then store its snapshot, which changes nothing in the database',
          '{bin} db update --advance-ref <name>',
        ),
        chooseAction(
          'Put the new contract source back, emit it, and run this command again with --advance-ref <name>',
        ),
      ],
      meta,
    },
  );
}

/** Where a `migration plan` leg plans to; only the emitted contract can be the destination of `migration new`. */
export interface PlanDestination {
  readonly hash: string;
  readonly isEmitted: boolean;
}

/**
 * `migration plan` refuses a first migration whose planner produced no operations: the contract
 * describes nothing to create.
 */
export function errorPlanProducedNoOperations(destination: PlanDestination): CliStructuredError {
  return errorMigrationPlanningFailed({
    conflicts: [
      {
        kind: 'nothingToCreate',
        summary:
          'This contract describes nothing migration plan can create, so there is no first migration to plan.',
        why: destination.isEmitted
          ? 'If the database needs something the contract does not describe, run `prisma migration new`, add its operations to the new `migration.ts`, then run that `migration.ts` with `node` to write `ops.json`.'
          : '`prisma migration new` writes a migration only to the emitted contract. If the database needs something this contract does not describe, emit it, run `prisma migration new`, add its operations to the new `migration.ts`, then run that `migration.ts` with `node` to write `ops.json`.',
      },
    ],
  });
}

const ROLLBACK_IS_DESTRUCTIVE =
  'A rollback (reverse) plan is expected to contain destructive (DROP) operations — review them before applying';
const RENAMES_AND_DATA_NEED_MORE =
  'Plan a rename with --rename old:new; re-adding a required field without a safe default, or a type change that needs data, may need you to fill in the planned migration.ts';

/**
 * The `meta` of `MIGRATION.PATH_UNREACHABLE`: no path joins the two hashes in the space's graph
 * (`pathUnreachable`, where a space with no marker starts from the empty contract's hash), or the
 * space has no migrations at all (`neverPlanned`).
 */
export type PathUnreachableMeta =
  | {
      readonly kind: 'pathUnreachable';
      readonly spaceId: string;
      readonly fromHash: string;
      readonly targetHash: string;
    }
  | { readonly kind: 'neverPlanned'; readonly spaceId: string; readonly targetHash: string };

/** What a replay found when no migration path reaches its target. */
export interface PathUnreachable {
  readonly summary: string;
  readonly why: string;
  readonly meta: PathUnreachableMeta;
}

/** The advice for a `PATH_UNREACHABLE` the caller knows better than a plan-then-apply of the app space. */
export interface PathUnreachableAdvice {
  readonly fix: string;
  readonly nextActions: readonly NextAction[];
}

function planThenApply(meta: PathUnreachableMeta): PathUnreachableAdvice {
  // Never-planned spaces have an EMPTY migration graph, and contract-ref
  // resolution only resolves full hashes against graph nodes — a
  // `--to <hash>` remediation would reject its own input. `migration plan`
  // without `--to` targets the working contract (the same contract the app
  // space's synthesized head ref carries), so the bare form is the one that
  // runs verbatim. With no marker, the live origin `migration plan` uses
  // without `--from` is the empty contract, so the printed command leaves
  // `--from` out.
  const planCommand =
    meta.kind === 'neverPlanned'
      ? '{bin} migration plan --name <slug>'
      : meta.fromHash === EMPTY_CONTRACT_HASH
        ? `{bin} migration plan --to ${meta.targetHash} --name <slug>`
        : `{bin} migration plan --from ${meta.fromHash} --to ${meta.targetHash} --name <slug>`;
  const applyCommand =
    meta.kind === 'neverPlanned' ? '{bin} db migrate' : `{bin} db migrate --to ${meta.targetHash}`;
  return {
    fix: [
      'Plan the missing edge, then apply it:',
      `  1. ${planCommand}`,
      `  2. ${applyCommand}`,
      `${ROLLBACK_IS_DESTRUCTIVE}.`,
      `${RENAMES_AND_DATA_NEED_MORE}.`,
      'Inspect the on-disk graph with `{bin} migration list`, or `{bin} migration show <bundle>` for any bundle in the path you expected.',
    ].join('\n'),
    nextActions: [
      runCommandAction('Plan the missing edge', planCommand),
      runCommandAction('Apply it', applyCommand),
      chooseAction(ROLLBACK_IS_DESTRUCTIVE),
      chooseAction(RENAMES_AND_DATA_NEED_MORE),
      runCommandAction('Inspect the on-disk graph', '{bin} migration list'),
      runCommandAction(
        'Inspect a bundle in the path you expected',
        '{bin} migration show <bundle>',
      ),
    ],
  };
}

/** `MIGRATION.PATH_UNREACHABLE`, advising to plan the missing edge and apply it unless `advice` says otherwise. */
export function errorPathUnreachable(
  failure: PathUnreachable,
  advice: PathUnreachableAdvice = planThenApply(failure.meta),
): ActionableCliError {
  return new ActionableCliError('MIGRATION.PATH_UNREACHABLE', failure.summary, {
    why: failure.why,
    fix: advice.fix,
    nextActions: advice.nextActions,
    meta: failure.meta,
  });
}

/**
 * Shared "needs a live database" precondition for read verbs that consult the
 * marker/ledger (`migration log`, `migration status`). A command needs both a
 * connection string and a control-plane driver; either missing yields the same
 * `CONFIG.DB_CONNECTION_REQUIRED` envelope with `meta.missingFlags` (canonical long-form flags
 * per CLI Style Guide §Errors) so callers can react programmatically. Returns
 * `null` when both are present.
 */
export function requireLiveDatabase(args: {
  readonly dbConnection: unknown;
  readonly hasDriver: boolean;
  readonly why: string;
  readonly commandName?: string;
  readonly retryCommand?: string;
}): CliStructuredError | null {
  if (args.dbConnection && args.hasDriver) {
    return null;
  }
  const missingFlags = args.dbConnection ? [] : ['--db'];
  return errorDatabaseConnectionRequired({
    why: args.why,
    missingFlags,
    ...ifDefined('commandName', args.commandName),
    ...ifDefined('retryCommand', args.retryCommand),
  });
}

/**
 * Maps a `RefResolutionError` from the contract/migration reference
 * resolver into a CLI structured error envelope.
 */
/**
 * A migration ref (dirName or hash-prefix) resolves in more than one contract
 * space. The user must qualify with `--space <id>` to disambiguate.
 */
export function errorAmbiguousMigrationRef(
  ref: string,
  spaceIds: readonly string[],
): ActionableCliError {
  const spaceList = spaceIds.join(', ');
  return new ActionableCliError(
    'MIGRATION.AMBIGUOUS_MIGRATION_REF',
    `Ambiguous migration reference: "${ref}" resolves in multiple spaces — qualify with --space <id>`,
    {
      why: `"${ref}" matches migrations in spaces: ${spaceList}.`,
      fix: `Qualify with --space <id> to select one space. Available matching spaces: ${spaceList}.`,
      nextActions: [chooseAction(`Qualify with --space <id>, one of: ${spaceList}`)],
      meta: {
        ref,
        spaceIds: [...spaceIds],
      },
    },
  );
}

export function mapRefResolutionError(error: RefResolutionError): ActionableCliError {
  switch (error.kind) {
    case 'not-found': {
      const fix =
        error.grammar === 'contract'
          ? 'Provide a valid contract hash, ref name, or migration directory name.'
          : 'Provide a valid migration directory name or migration hash.';
      return new ActionableCliError(
        'MIGRATION.REF_NOT_FOUND',
        `Not a known ${error.grammar} reference: "${error.input}"`,
        {
          why: `No ${error.grammar} matching "${error.input}" exists in the migration graph or refs index.`,
          fix,
          nextActions: [chooseAction(fix)],
          meta: { input: error.input, grammar: error.grammar },
        },
      );
    }
    case 'ambiguous':
      return new ActionableCliError(
        'MIGRATION.REF_AMBIGUOUS',
        `Ambiguous ${error.grammar} reference: "${error.input}"`,
        {
          why: `"${error.input}" matches multiple ${error.grammar}s: ${error.candidates.join(', ')}`,
          fix: 'Provide a longer prefix or use the full hash to disambiguate.',
          nextActions: [
            chooseAction('Provide a longer prefix or use the full hash to disambiguate'),
          ],
          meta: { input: error.input, candidates: error.candidates, grammar: error.grammar },
        },
      );
    case 'wrong-grammar':
      return new ActionableCliError('MIGRATION.REF_WRONG_GRAMMAR', error.message, {
        why: error.message,
        fix: error.fix,
        nextActions: [chooseAction(error.fix)],
        meta: { input: error.input, expectedGrammar: error.expectedGrammar },
      });
    case 'invalid-format':
      return new ActionableCliError(
        'MIGRATION.REF_INVALID_FORMAT',
        `Invalid reference format: "${error.input}"`,
        {
          why: error.reason,
          fix: 'Provide a valid contract hash, ref name, or migration directory name.',
          nextActions: [
            chooseAction('Provide a valid contract hash, ref name, or migration directory name'),
          ],
          meta: { input: error.input },
        },
      );
  }
}
