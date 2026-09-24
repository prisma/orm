import { docsUrlFor } from '@internal/utils/structured-error';
import { formatSourceDiagnostic } from '../../control-api/operations/contract-emit';
import { CliStructuredError } from '../../utils/cli-errors';

/**
 * Non-interactive mode is missing one or more required inputs. Lists every
 * missing flag in the error so an agent / CI script can react without
 * needing to parse English.
 *
 * @param missing — kebab-case flag names without leading dashes
 * @param why — additional context (e.g. "stdin is not a TTY") that helps
 *              the user understand why interactive fallback was skipped.
 */
export function errorInitMissingFlags(options: {
  readonly missing: readonly string[];
  readonly why: string;
  /** The Prisma 7 schema detection found, when the run could have adopted it instead. */
  readonly prisma7SchemaPath: string | undefined;
}): CliStructuredError {
  const flagList = options.missing.map((flag) => `--${flag}`).join(', ');
  const fixList = options.missing
    .map((flag) => {
      switch (flag) {
        case 'target':
          return '--target postgres|mongodb';
        case 'authoring':
          return '--authoring psl|typescript';
        case 'schema-path':
          return '--schema-path <path>';
        default:
          return `--${flag} <value>`;
      }
    })
    .join(' ');
  const prisma7 =
    options.prisma7SchemaPath === undefined
      ? ''
      : ` This looks like a Prisma 7 project; to use ${options.prisma7SchemaPath} as the contract source instead, pass \`--from-prisma7-schema ${options.prisma7SchemaPath}\`.`;
  return new CliStructuredError('CLI.INIT_MISSING_FLAGS', 'Missing required flags', {
    why: `${options.why} Missing required flag(s): ${flagList}.${prisma7}`,
    fix: `Re-run with the missing flag(s) supplied, e.g. \`prisma orm init --yes ${fixList}\`. Use \`prisma orm init --help\` to see every flag.`,
    docsUrl: docsUrlFor('CLI.INIT_MISSING_FLAGS'),
    meta: { missingFlags: options.missing, prisma7SchemaPath: options.prisma7SchemaPath ?? null },
  });
}

/**
 * A flag value was supplied but is not in the allowed set. Lists the
 * allowed values in `meta` for machine-readable consumption.
 */
export function errorInitInvalidFlagValue(options: {
  readonly flag: string;
  readonly value: string;
  readonly allowed: readonly string[];
}): CliStructuredError {
  return new CliStructuredError(
    'CLI.INIT_INVALID_FLAG_VALUE',
    `Invalid value for --${options.flag}`,
    {
      why: `\`--${options.flag} ${options.value}\` is not one of: ${options.allowed.join(', ')}.`,
      fix: `Use one of: ${options.allowed.map((v) => `--${options.flag} ${v}`).join(', ')}.`,
      docsUrl: docsUrlFor('CLI.INIT_INVALID_FLAG_VALUE'),
      meta: { flag: options.flag, value: options.value, allowed: options.allowed },
    },
  );
}

/**
 * `--authoring` and `--schema-path` disagree on file extension (e.g. PSL
 * authoring with a `.ts` path). Surfaces before any scaffold files are
 * written so the project tree stays untouched.
 */
export function errorInitAuthoringSchemaPathMismatch(options: {
  readonly authoring: 'psl' | 'typescript';
  readonly schemaPath: string;
  readonly actualExtension: string;
  readonly expectedExtension: string;
}): CliStructuredError {
  const expectedAuthoring = options.expectedExtension === '.ts' ? 'typescript' : 'psl';
  return new CliStructuredError(
    'CLI.INIT_AUTHORING_SCHEMA_PATH_MISMATCH',
    'Authoring and schema path do not match',
    {
      why:
        `\`--authoring ${options.authoring}\` requires a schema file ending in ${options.expectedExtension}, ` +
        `but \`--schema-path ${options.schemaPath}\` ends in ${options.actualExtension}.`,
      fix:
        `Use a matching pair, for example \`--authoring ${expectedAuthoring} --schema-path <path>${options.expectedExtension}\`, ` +
        'or change `--authoring` to match the path you supplied. ' +
        'You can also omit `--schema-path` to use the default for the chosen authoring.',
      docsUrl: docsUrlFor('CLI.INIT_AUTHORING_SCHEMA_PATH_MISMATCH'),
      meta: {
        authoring: options.authoring,
        schemaPath: options.schemaPath,
        actualExtension: options.actualExtension,
        expectedExtension: options.expectedExtension,
      },
    },
  );
}

/**
 * The user cancelled an interactive prompt (Ctrl-C, escape, declined a
 * selection) — the generic "user said no" path. Maps to exit code
 * 3 (USER_ABORTED).
 */
export function errorInitUserAborted(): CliStructuredError {
  return new CliStructuredError('CLI.INIT_USER_ABORTED', 'Init cancelled', {
    why: 'The interactive prompt was cancelled before all required inputs were supplied. No files were modified.',
    fix: 'Re-run `prisma orm init` and complete the prompts, or pass the required inputs as flags (see `--help`) for a non-interactive run.',
    severity: 'info',
  });
}

/**
 * `--strict-probe` was supplied without `--probe-db`. Per FR8.3 / NFR9
 * (offline-by-default), `--strict-probe` is a no-op without `--probe-db` —
 * but rather than silently ignoring it we tell the user what they probably
 * meant. Without this guard, the flag combination silently does nothing,
 * which is exactly the kind of "looks like it worked" trap that a strict
 * mode is supposed to prevent.
 */
export function errorInitStrictProbeWithoutProbe(): CliStructuredError {
  return new CliStructuredError(
    'CLI.INIT_STRICT_PROBE_WITHOUT_PROBE',
    '`--strict-probe` requires `--probe-db`',
    {
      why: '`--strict-probe` only changes how a *failed* probe is reported; without `--probe-db` no probe is attempted in the first place. (`init` is offline-by-default — it never opens a connection to your database without explicit consent.)',
      fix: 'Add `--probe-db` to opt in to the probe, or drop `--strict-probe` if you do not need the version check.',
      docsUrl: docsUrlFor('CLI.INIT_STRICT_PROBE_WITHOUT_PROBE'),
    },
  );
}

/**
 * Dependency installation failed and the pnpm → npm fallback (FR7.2)
 * either did not apply (pm ≠ pnpm or stderr did not match a recognised
 * leak) or also failed. Files scaffolded before the install step are
 * already on disk; `meta.filesWritten` carries the list so a follow-up
 * agent can resume manually. Maps to exit code `4 = INSTALL_FAILED`.
 */
export function errorInitInstallFailed(options: {
  readonly addCommand: string;
  readonly addDevCommand: string;
  readonly emitCommand: string;
  readonly filesWritten: readonly string[];
  readonly stderrLines: readonly string[];
}): CliStructuredError {
  const trimmed = options.stderrLines.map((s) => s.trim()).filter(Boolean);
  const why =
    trimmed.length === 0
      ? 'The package manager exited with an error and no recoverable fallback applied.'
      : `The package manager exited with: ${trimmed[0]}`;
  return new CliStructuredError('CLI.INIT_INSTALL_FAILED', 'Failed to install dependencies', {
    why,
    fix: `Install manually:\n  ${options.addCommand}\n  ${options.addDevCommand}\nThen run \`${options.emitCommand}\` to emit the contract.`,
    docsUrl: docsUrlFor('CLI.INIT_INSTALL_FAILED'),
    meta: {
      filesWritten: options.filesWritten,
      stderr: trimmed,
    },
  });
}

/**
 * The user's project manifest (typically `package.json`) failed to parse
 * as JSON. Init reads the manifest to merge `scripts` (FR3.5) and to
 * skip `@types/node` when it is already declared (FR2.1); a malformed
 * file would otherwise surface as an `INTERNAL_ERROR` with a raw
 * `SyntaxError` stack, which violates the FR1.6 contract that every
 * documented failure mode maps to a stable exit code.
 *
 * Maps to exit code `2 = PRECONDITION` — the user can fix the manifest
 * and re-run.
 */
export function errorInitInvalidManifest(options: {
  readonly path: string;
  readonly cause: string;
}): CliStructuredError {
  return new CliStructuredError('CLI.INIT_INVALID_MANIFEST', `Failed to parse ${options.path}`, {
    why: `\`${options.path}\` is not valid JSON: ${options.cause}`,
    fix: `Fix the JSON syntax in \`${options.path}\` (a missing comma or unbalanced brace is the most common cause), then re-run \`prisma orm init\`.`,
    docsUrl: docsUrlFor('CLI.INIT_INVALID_MANIFEST'),
    meta: { path: options.path, cause: options.cause },
  });
}

/**
 * The user's existing `tsconfig.json` could not be parsed even with JSONC
 * tolerance (comments + trailing commas) enabled. Init merges the
 * minimum compiler options the scaffolded files need (FR2.2), so an
 * unparseable tsconfig is a hard precondition failure: we cannot
 * faithfully edit a file we cannot read.
 *
 * Init must surface this **before** writing any scaffold file so the
 * user's working tree stays byte-identical (FR6.2 / NFR3) — see
 * `runInit` for the precondition gate.
 *
 * Maps to exit code `2 = PRECONDITION` — the user can fix the file and
 * re-run.
 */
export function errorInitInvalidTsconfig(options: {
  readonly path: string;
  readonly cause: string;
}): CliStructuredError {
  return new CliStructuredError('CLI.INIT_INVALID_TSCONFIG', `Failed to parse ${options.path}`, {
    why: `\`${options.path}\` is not valid JSON or JSONC: ${options.cause}`,
    fix: `Fix the syntax in \`${options.path}\` and re-run \`prisma orm init\`. \`init\` accepts JSONC (comments and trailing commas) but cannot recover from unbalanced braces or missing commas.`,
    docsUrl: docsUrlFor('CLI.INIT_INVALID_TSCONFIG'),
    meta: { path: options.path, cause: options.cause },
  });
}

/**
 * `--probe-db` was supplied along with `--strict-probe` and the probe
 * could not complete (no `DATABASE_URL`, network/auth error, the target
 * driver was not installed, …). Without `--strict-probe` the probe
 * surfaces these as warnings; `--strict-probe` escalates them to
 * fatal so a CI gate can rely on "init exit code 2 means something
 * about the runtime environment is wrong" (FR8.3).
 *
 * Maps to exit code `2 = PRECONDITION`. The caller's project files
 * are already on disk by this point — the probe runs after the write
 * phase — but the install/emit steps may or may not have completed
 * depending on `--no-install` and the exact failure mode; `meta`
 * carries `filesWritten` so a follow-up agent can resume manually.
 */
export function errorInitProbeFailed(options: {
  readonly cause: string;
  readonly filesWritten: readonly string[];
}): CliStructuredError {
  return new CliStructuredError('CLI.INIT_PROBE_FAILED', 'Database probe failed', {
    why: `\`--probe-db\` could not complete and \`--strict-probe\` was set: ${options.cause}`,
    fix: 'Confirm `DATABASE_URL` points at a reachable server, or drop `--strict-probe` to treat probe failures as warnings.',
    docsUrl: docsUrlFor('CLI.INIT_PROBE_FAILED'),
    meta: {
      filesWritten: options.filesWritten,
      cause: options.cause,
    },
  });
}

/**
 * `prisma-cli contract emit` failed after a successful install. Surface
 * the underlying error so the user can fix it and re-run; files and
 * dependencies remain on disk untouched. Maps to exit code
 * `5 = EMIT_FAILED`.
 */
export function errorInitEmitFailed(options: {
  readonly emitCommand: string;
  readonly filesWritten: readonly string[];
  readonly cause: string;
}): CliStructuredError {
  return new CliStructuredError('CLI.INIT_EMIT_FAILED', 'Failed to emit contract', {
    why: `\`prisma-cli contract emit\` failed: ${options.cause}`,
    fix: `Inspect your contract file, fix the underlying issue, then re-run \`${options.emitCommand}\`. Pass \`-v\` for the full error envelope.`,
    docsUrl: docsUrlFor('CLI.INIT_EMIT_FAILED'),
    meta: {
      filesWritten: options.filesWritten,
      cause: options.cause,
    },
  });
}

/**
 * A scaffold file could not be written after earlier writes had already
 * landed. The directory is half-scaffolded, so this carries the list of what
 * did get written, the way every other post-write failure in `init` does.
 *
 * Maps to exit code `2 = PRECONDITION`: what stopped the write is something
 * about the directory the user can fix.
 */
export function errorInitWriteFailed(options: {
  readonly path: string;
  readonly cause: string;
  readonly filesWritten: readonly string[];
  readonly filesRenamed: readonly { readonly from: string; readonly to: string }[];
}): CliStructuredError {
  const renamed = options.filesRenamed.map((entry) => `${entry.from} → ${entry.to}`);
  const renamedNote =
    renamed.length === 0
      ? ''
      : ` Before the failure this run renamed ${renamed.join(', ')}; that rename stays, and a re-run writes the missing files beside it.`;
  return new CliStructuredError('CLI.INIT_WRITE_FAILED', `Failed to write ${options.path}`, {
    why: `\`${options.path}\` could not be written: ${options.cause}${renamedNote}`,
    fix: 'Fix what stopped the write — a directory sitting where the file goes, permissions, a full disk — then run `prisma orm init` again. Interactive runs ask before replacing the files this run already wrote (listed in `meta.filesWritten`); non-interactive runs grant that consent with `--confirm <directory name>`.',
    docsUrl: docsUrlFor('CLI.INIT_WRITE_FAILED'),
    meta: {
      path: options.path,
      cause: options.cause,
      filesWritten: options.filesWritten,
      filesRenamed: options.filesRenamed,
    },
  });
}

/**
 * Two flags were given that ask for different things: `--from-prisma7-schema`
 * names an existing schema as the contract source, while `--schema-path` and
 * `--authoring` describe a starter schema to write. Raised before anything is
 * read or written.
 */
export function errorInitFlagConflict(options: {
  readonly flags: readonly [string, string];
}): CliStructuredError {
  const [first, second] = options.flags;
  return new CliStructuredError('CLI.INIT_FLAG_CONFLICT', 'Conflicting flags', {
    why: `\`--${first}\` and \`--${second}\` cannot be combined: the first reads an existing schema as the contract source, the second describes a starter schema to write.`,
    fix: `Pass one or the other. Use \`--${first}\` to adopt an existing Prisma 7 schema, or \`--${second}\` to scaffold a new one.`,
    docsUrl: docsUrlFor('CLI.INIT_FLAG_CONFLICT'),
    meta: { flags: [first, second] },
  });
}

// biome-ignore lint/plugin/no-family-vocabulary: names the providers on purpose — the supported list a user-facing error shows
const PRISMA7_SUPPORTED_PROVIDERS = ['postgresql', 'mongodb'] as const;

/**
 * The Prisma 7 schema's provider is one Prisma 8 has no target for, or is not
 * a string literal and no `--target` names the database instead.
 */
export function errorInitPrisma7ProviderUnsupported(options: {
  readonly schemaPath: string;
  readonly provider: string | undefined;
}): CliStructuredError {
  const declared =
    options.provider === undefined ? 'no string provider' : `\`provider = "${options.provider}"\``;
  const fix =
    options.provider === undefined
      ? 'Pass `--target` to name the database, or run `prisma orm init` without `--from-prisma7-schema` to start a fresh Prisma 8 contract.'
      : 'Run `prisma orm init` without `--from-prisma7-schema` to start a fresh Prisma 8 contract.';
  return new CliStructuredError(
    'CLI.INIT_PRISMA7_PROVIDER_UNSUPPORTED',
    'Unsupported Prisma 7 datasource provider',
    {
      why: `\`${options.schemaPath}\` declares ${declared}. Prisma 8 supports: ${PRISMA7_SUPPORTED_PROVIDERS.join(', ')}.`,
      fix,
      docsUrl: docsUrlFor('CLI.INIT_PRISMA7_PROVIDER_UNSUPPORTED'),
      meta: {
        schemaPath: options.schemaPath,
        provider: options.provider ?? null,
        supported: [...PRISMA7_SUPPORTED_PROVIDERS],
      },
    },
  );
}

/** `--target` names a different database than the Prisma 7 schema's provider. */
export function errorInitPrisma7TargetMismatch(options: {
  readonly schemaPath: string;
  readonly provider: string;
  readonly target: string;
}): CliStructuredError {
  return new CliStructuredError(
    'CLI.INIT_PRISMA7_TARGET_MISMATCH',
    '--target does not match the Prisma 7 schema',
    {
      why: `\`--target ${options.target}\` does not match \`${options.schemaPath}\`, which declares \`provider = "${options.provider}"\`.`,
      fix: 'Drop `--target` to use the database the schema declares, or run `prisma orm init` without `--from-prisma7-schema` to start a fresh Prisma 8 contract.',
      docsUrl: docsUrlFor('CLI.INIT_PRISMA7_TARGET_MISMATCH'),
      meta: { schemaPath: options.schemaPath, provider: options.provider, target: options.target },
    },
  );
}

/** The path given as a Prisma 7 schema does not exist or has no `datasource` block. */
export function errorInitPrisma7SchemaInvalid(options: {
  readonly schemaPath: string;
  readonly reason: 'absent' | 'no-datasource';
}): CliStructuredError {
  const why =
    options.reason === 'absent'
      ? `\`${options.schemaPath}\` does not exist.`
      : `\`${options.schemaPath}\` has no \`datasource\` block, so it is not a Prisma 7 schema.`;
  return new CliStructuredError('CLI.INIT_PRISMA7_SCHEMA_INVALID', 'Not a Prisma 7 schema', {
    why,
    fix: 'Point `--from-prisma7-schema` at the `schema.prisma` file (or schema directory) whose `datasource` block names your database, or run `prisma orm init` without it.',
    docsUrl: docsUrlFor('CLI.INIT_PRISMA7_SCHEMA_INVALID'),
    meta: { schemaPath: options.schemaPath, reason: options.reason },
  });
}

/**
 * A Prisma 7 `prisma.config.*` sits beside a `prisma7.config.*`, so neither can be renamed onto the
 * other.
 */
export function errorInitPrisma7ConfigCollision(options: {
  readonly prismaConfigPath: string;
  readonly prisma7ConfigPath: string;
}): CliStructuredError {
  return new CliStructuredError('CLI.INIT_PRISMA7_CONFIG_COLLISION', 'Two Prisma 7 config files', {
    why: `\`${options.prismaConfigPath}\` is a Prisma 7 config and \`${options.prisma7ConfigPath}\` already exists. Init renames the Prisma 7 config to \`prisma7.config.*\` so Prisma 8 can write its own, and cannot rename onto an existing file.`,
    fix: `Keep one of them: delete \`${options.prisma7ConfigPath}\` if \`${options.prismaConfigPath}\` is the config Prisma 7 should use, or delete \`${options.prismaConfigPath}\` if the move to \`${options.prisma7ConfigPath}\` is already done. Then re-run \`prisma orm init\`.`,
    docsUrl: docsUrlFor('CLI.INIT_PRISMA7_CONFIG_COLLISION'),
    meta: {
      prismaConfigPath: options.prismaConfigPath,
      prisma7ConfigPath: options.prisma7ConfigPath,
    },
  });
}

/**
 * `prisma.config.*` exists but did not evaluate, so init cannot tell whether
 * it is Prisma 7's (to rename) or its own (to replace). Refused rather than
 * guessed: replacing a Prisma 7 config would destroy the user's file.
 */
export function errorInitPrisma7ConfigUnreadable(options: {
  readonly path: string;
  readonly why: string;
  /** A `prisma7.config.*` already beside it: the unreadable file is then Prisma 8's own. */
  readonly prisma7ConfigPath: string | undefined;
}): CliStructuredError {
  const extension = options.path.slice(options.path.lastIndexOf('.') + 1);
  const versioned = options.prisma7ConfigPath;
  const why =
    versioned === undefined
      ? `\`${options.path}\` failed to evaluate, so init cannot tell whether it is a Prisma 7 config to rename or a Prisma 8 config to replace: ${options.why}`
      : `\`${options.path}\` failed to evaluate: ${options.why}. \`${versioned}\` already exists, so init leaves \`${options.path}\` alone.`;
  const fix =
    versioned === undefined
      ? `Install the project's dependencies so \`${options.path}\` can be evaluated (a Prisma 7 config imports \`prisma/config\`), or rename it to \`prisma7.config.${extension}\` by hand, then re-run \`prisma orm init\`.`
      : `Install the project's dependencies and fix the error in \`${options.path}\` (a missing export usually means the package it imports from needs updating), then re-run \`prisma orm init\`.`;
  return new CliStructuredError(
    'CLI.INIT_PRISMA7_CONFIG_UNREADABLE',
    `Could not evaluate ${options.path}`,
    {
      why,
      fix,
      docsUrl: docsUrlFor('CLI.INIT_PRISMA7_CONFIG_UNREADABLE'),
      meta: { path: options.path, why: options.why, prisma7ConfigPath: versioned ?? null },
    },
  );
}

/** Packages init installed before it found out it could not continue. */
export interface PackagesAdded {
  readonly packages: readonly string[];
  readonly removeCommand: string;
}

/** The next action that tells the user how to undo what the Prisma 7 check installed. */
export function packagesAddedAction(added: PackagesAdded): string {
  const pronoun = added.packages.length === 1 ? 'it' : 'them';
  return `init added ${added.packages.join(' and ')} to package.json before checking; remove ${pronoun} with \`${added.removeCommand}\`.`;
}

function packagesAddedNote(added: PackagesAdded | undefined): string {
  return added === undefined ? '' : `\n${packagesAddedAction(added)}`;
}

/**
 * The target package init loads to read the Prisma 7 schema cannot be loaded
 * from the project, or it has no Prisma 7 contract source while
 * `--from-prisma7-schema` asked for one.
 */
export function errorInitPrisma7SourceUnavailable(options: {
  readonly schemaPath: string;
  readonly packageName: string;
  readonly reason: 'not-resolvable' | 'no-prisma7-source';
  readonly added: PackagesAdded | undefined;
}): CliStructuredError {
  const { packageName, schemaPath } = options;
  const wording =
    options.reason === 'not-resolvable'
      ? {
          summary: `Could not load ${packageName} from the project`,
          why: `${packageName} was installed but could not be loaded from the project, so init cannot check that Prisma 8 reads ${schemaPath}.`,
          fix: `Check that ${packageName} is installed and resolves from this directory (Yarn Plug'n'Play hides packages from Node), then run \`prisma orm init\` again.`,
        }
      : {
          summary: 'No Prisma 7 contract source for this database',
          why: `${packageName} does not provide a Prisma 7 contract source, so it cannot read ${schemaPath}.`,
          fix: 'Choose a database whose Prisma 8 package reads Prisma 7 schemas, or run `prisma orm init` without `--from-prisma7-schema`.',
        };
  return new CliStructuredError('CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE', wording.summary, {
    why: wording.why,
    fix: `${wording.fix}${packagesAddedNote(options.added)}`,
    docsUrl: docsUrlFor('CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE'),
    meta: {
      schemaPath: options.schemaPath,
      packageName: options.packageName,
      reason: options.reason,
      packagesAdded: options.added?.packages ?? [],
    },
  });
}

/**
 * The target package's Prisma 7 contract source refused the schema. Nothing but the check's install
 * happened.
 */
export function errorInitPrisma7SchemaRefused(options: {
  readonly schemaPath: string;
  readonly packageName: string;
  readonly summary: string;
  readonly diagnostics: readonly unknown[];
  readonly added: PackagesAdded | undefined;
}): CliStructuredError {
  const findings = options.diagnostics.map(
    (diagnostic) => `\n  ${formatSourceDiagnostic(diagnostic)}`,
  );
  return new CliStructuredError(
    'CLI.INIT_PRISMA7_SCHEMA_REFUSED',
    `Prisma 8 cannot read ${options.schemaPath}`,
    {
      why: `${options.summary}${findings.join('')}`,
      fix: `Edit ${options.schemaPath} as each finding says (see the Prisma 7 contract source section of the ${options.packageName} README), or run \`prisma orm init\` without \`--from-prisma7-schema\`.${packagesAddedNote(options.added)}`,
      docsUrl: docsUrlFor('CLI.INIT_PRISMA7_SCHEMA_REFUSED'),
      meta: {
        schemaPath: options.schemaPath,
        summary: options.summary,
        diagnostics: options.diagnostics,
        packagesAdded: options.added?.packages ?? [],
      },
    },
  );
}
