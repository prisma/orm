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
import type { RefResolutionError } from '@internal/migration-tools/ref-resolution';
import { ifDefined } from '@internal/utils/defined';
import type { NextAction } from '@prisma/cli-engine/protocol';
import type { MigrateFailure } from '../control-api/types';
import { chooseAction, runCommandAction } from './next-actions';

export {
  ERROR_CODE_DESTRUCTIVE_CHANGES,
  errorConsentPlanMismatch,
  errorDestructiveChanges,
  errorHashMismatch,
  errorMarkerMissing,
  errorMarkerRequired,
  errorRunnerFailed,
  errorRuntime,
  errorSchemaVerificationFailed,
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
      readonly why: string;
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

export function errorRefSetHashNotInGraph(
  resolvedHash: string,
  reachableHashes: readonly string[],
  graphTipHash: string | null,
): ActionableCliError {
  const reachableList =
    reachableHashes.length > 0 ? reachableHashes.join(', ') : '(none — migration graph is empty)';
  const fix =
    reachableHashes.length > 0
      ? graphTipHash !== null
        ? `Set the ref to a graph-node hash such as ${graphTipHash}, or run \`{bin} migration plan\` to extend the graph.`
        : 'Set the ref to a hash that appears in the migration graph.'
      : 'Run `{bin} migration plan` first.';
  const nextActions =
    reachableHashes.length > 0
      ? graphTipHash !== null
        ? [
            chooseAction(`Set the ref to a graph-node hash such as ${graphTipHash}`),
            runCommandAction('Extend the migration graph', '{bin} migration plan'),
          ]
        : [chooseAction('Set the ref to a hash that appears in the migration graph')]
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
        ...(graphTipHash !== null ? { graphTipHash } : {}),
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
  graphTipHash: string | null,
  options?: { readonly cause?: unknown },
): ActionableCliError {
  const reachableList =
    reachableRefs.length > 0
      ? reachableRefs.map((r) => `${r.name} (${r.hash})`).join(', ')
      : '(none)';
  const refFix =
    reachableRefs.length > 0
      ? `Run migration plan with ${reachableRefs.map((r) => `--from ${r.name}`).join(' or ')}.`
      : graphTipHash !== null
        ? `Run migration plan --from ${graphTipHash}.`
        : 'Commit pending migrations first, then run migration plan.';
  const nextActions =
    reachableRefs.length > 0
      ? reachableRefs.map((ref) =>
          runCommandAction(`Plan from ${ref.name}`, `{bin} migration plan --from ${ref.name}`),
        )
      : graphTipHash !== null
        ? [
            runCommandAction(
              'Plan from the graph tip',
              `{bin} migration plan --from ${graphTipHash}`,
            ),
          ]
        : [chooseAction('Commit pending migrations first, then run migration plan')];
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
        ...(graphTipHash !== null ? { graphTipHash } : {}),
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

export function errorMarkerMismatch(
  markerHash: string,
  reachableHashes: readonly string[],
  graphTip: string | null,
): ActionableCliError {
  const reachableList =
    reachableHashes.length > 0 ? reachableHashes.join(', ') : '(none — migration graph is empty)';
  const planFromFix =
    graphTip !== null
      ? `Run \`{bin} migration plan --from ${graphTip}\` if the live marker is canonical and the on-disk graph needs catching up.`
      : 'Run `{bin} migration plan` if the live marker is canonical and the on-disk graph needs catching up.';
  const planCommand =
    graphTip !== null ? `{bin} migration plan --from ${graphTip}` : '{bin} migration plan';
  return new ActionableCliError(
    'MIGRATION.MARKER_MISMATCH',
    'Database marker is not reachable in the on-disk migration graph',
    {
      why: `DB marker is ${markerHash}, but the on-disk migration graph reaches: ${reachableList}.`,
      fix: [
        planFromFix,
        `Run \`{bin} migration ref set db ${markerHash}\` if the on-disk graph is canonical and the local \`db\` ref drifted.`,
        'Investigate whether the database was migrated by an out-of-band process.',
      ].join('\n'),
      nextActions: [
        runCommandAction('Catch the on-disk graph up to the live marker', planCommand),
        runCommandAction(
          'Point the local db ref at the live marker',
          `{bin} migration ref set db ${markerHash}`,
        ),
        chooseAction('Investigate whether the database was migrated by an out-of-band process'),
      ],
      meta: {
        markerHash,
        reachableHashes: [...reachableHashes],
        ...(graphTip !== null ? { graphTip } : {}),
      },
    },
  );
}

const ROLLBACK_IS_DESTRUCTIVE =
  'A rollback (reverse) plan is expected to contain destructive (DROP) operations — review them before applying';
const NARROWER_CASES_NEED_A_HINT =
  'Narrower cases (rename inference, re-adding a required field without a safe default, or a type change that needs data) may additionally need a hint in the planned migration';

export function errorPathUnreachable(failure: MigrateFailure): ActionableCliError {
  const meta = failure.meta ?? {};
  const fromHashMeta = typeof meta['fromHash'] === 'string' ? meta['fromHash'] : null;
  // `buildPathNotFoundFailure` uses this sentinel in meta when the live marker is null.
  const planFromHash = fromHashMeta === '<empty>' ? null : fromHashMeta;
  const targetHash =
    typeof meta['targetHash'] === 'string'
      ? meta['targetHash']
      : typeof meta['target'] === 'string'
        ? meta['target']
        : null;
  const deadEnds = meta['deadEnds'];
  const deadEndsSuffix =
    Array.isArray(deadEnds) && deadEnds.length > 0
      ? ` Dead-ends: ${deadEnds.map(String).join(', ')}.`
      : '';
  // Plan-then-apply recovery. The planner destination is the missing edge's
  // target; `migration plan --to` (built for arbitrary targets) makes this a
  // real command, so the diagnostic that sends you here is now honest.
  //
  // Never-planned spaces have an EMPTY migration graph, and contract-ref
  // resolution only resolves full hashes against graph nodes — a
  // `--to <hash>` remediation would reject its own input. `migration plan`
  // without `--to` targets the working contract (the same contract the app
  // space's synthesized head ref carries), so the bare form is the one that
  // runs verbatim.
  const neverPlanned = meta['kind'] === 'neverPlanned';
  const planCommand = (() => {
    if (neverPlanned) {
      return '{bin} migration plan --name <slug>';
    }
    if (planFromHash !== null && targetHash !== null) {
      return `{bin} migration plan --from ${planFromHash} --to ${targetHash} --name <slug>`;
    }
    if (targetHash !== null) {
      return `{bin} migration plan --to ${targetHash} --name <slug>`;
    }
    if (planFromHash !== null) {
      return `{bin} migration plan --from ${planFromHash} --name <slug>`;
    }
    return '{bin} migration plan';
  })();
  const applyCommand =
    targetHash !== null && !neverPlanned
      ? `{bin} db migrate --to ${targetHash}`
      : '{bin} db migrate';
  return new ActionableCliError('MIGRATION.PATH_UNREACHABLE', failure.summary, {
    why:
      failure.why ??
      `Cannot reach target "${targetHash ?? '<unknown>'}" from current marker "${fromHashMeta ?? '<unknown>'}".${deadEndsSuffix}`,
    fix: [
      'Plan the missing edge, then apply it:',
      `  1. ${planCommand}`,
      `  2. ${applyCommand}`,
      `${ROLLBACK_IS_DESTRUCTIVE}.`,
      `${NARROWER_CASES_NEED_A_HINT}.`,
      'Inspect the on-disk graph with `{bin} migration list`, or `{bin} migration show <bundle>` for any bundle in the path you expected.',
    ].join('\n'),
    nextActions: [
      runCommandAction('Plan the missing edge', planCommand),
      runCommandAction('Apply it', applyCommand),
      chooseAction(ROLLBACK_IS_DESTRUCTIVE),
      chooseAction(NARROWER_CASES_NEED_A_HINT),
      runCommandAction('Inspect the on-disk graph', '{bin} migration list'),
      runCommandAction(
        'Inspect a bundle in the path you expected',
        '{bin} migration show <bundle>',
      ),
    ],
    meta: {
      ...meta,
    },
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
