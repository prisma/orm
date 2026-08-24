import { docsUrlFor } from '@internal/utils/structured-error';
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
  return new CliStructuredError('CLI.INIT_MISSING_FLAGS', 'Missing required flags', {
    why: `${options.why} Missing required flag(s): ${flagList}.`,
    fix: `Re-run with the missing flag(s) supplied, e.g. \`prisma orm init --yes ${fixList}\`. Use \`prisma orm init --help\` to see every flag.`,
    docsUrl: docsUrlFor('CLI.INIT_MISSING_FLAGS'),
    meta: { missingFlags: options.missing },
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
}): CliStructuredError {
  return new CliStructuredError('CLI.INIT_WRITE_FAILED', `Failed to write ${options.path}`, {
    why: `\`${options.path}\` could not be written: ${options.cause}`,
    fix: 'Fix what stopped the write — a directory sitting where the file goes, permissions, a full disk — then run `prisma orm init` again. Interactive runs ask before replacing the files this run already wrote (listed in `meta.filesWritten`); non-interactive runs grant that consent with `--confirm <directory name>`.',
    docsUrl: docsUrlFor('CLI.INIT_WRITE_FAILED'),
    meta: { path: options.path, cause: options.cause, filesWritten: options.filesWritten },
  });
}
