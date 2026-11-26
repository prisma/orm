import { ifDefined } from '@internal/utils/defined';
import { docsUrlFor } from '@internal/utils/structured-error';
import { formatSourceDiagnostic } from '../../control-api/operations/load-contract-source';
import { CliStructuredError } from '../../utils/cli-errors';
import type { PackageManager } from './detect-package-manager';
import type { Prisma6SideBySideSetup } from './prisma6-side-by-side';
import {
  KNOWN_TARGET_PACKAGES,
  PACKAGE_NAME_PLACEHOLDER,
  PRISMA_ORM_PACKAGE_KEYWORD,
  TARGET_SHORT_NAMES,
} from './target-packages';

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
          return `--target ${[...TARGET_SHORT_NAMES, PACKAGE_NAME_PLACEHOLDER].join('|')}`;
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

const SHORT_NAME_LIST = TARGET_SHORT_NAMES.join(', ');
const SHORT_NAME_FLAGS = TARGET_SHORT_NAMES.map((name) => `--target ${name}`).join(', ');

/**
 * The target is neither a short name nor a valid package name. `answeredIn` says whether it came
 * from `--target` or from the name typed into the picker, whose wording names the answer instead.
 */
export function errorInitInvalidTarget(options: {
  readonly value: string;
  /** Why the value is not taken as a package name. */
  readonly problems: readonly string[];
  readonly answeredIn: 'flag' | 'prompt';
}): CliStructuredError {
  const problems = options.problems.join('; ');
  const wording =
    options.answeredIn === 'flag'
      ? {
          summary: 'Invalid value for --target',
          why: `\`--target ${options.value}\` is not one of the short names (${SHORT_NAME_LIST}), and init does not take it as a package name: ${problems}.`,
          fix: `Pass a short name (${SHORT_NAME_FLAGS}) or the full name of the package for your database (\`--target ${PACKAGE_NAME_PLACEHOLDER}\`).`,
        }
      : {
          summary: 'Invalid package name',
          why: `\`${options.value}\`, typed as the name of the package for your database, is not taken as a package name: ${problems}. Nothing was changed.`,
          fix: `Run \`prisma orm init\` again and type the package's name as it is published, or pass it as \`--target ${PACKAGE_NAME_PLACEHOLDER}\`.`,
        };
  return new CliStructuredError('CLI.INIT_INVALID_FLAG_VALUE', wording.summary, {
    why: wording.why,
    fix: wording.fix,
    docsUrl: docsUrlFor('CLI.INIT_INVALID_FLAG_VALUE'),
    meta: {
      flag: 'target',
      value: options.value,
      allowed: [...TARGET_SHORT_NAMES],
      acceptsPackageName: true,
      problems: options.problems,
    },
  });
}

/**
 * Said first when a value in no list turns out not to be a usable facade, so the user
 * sees why init looked for a package of that name.
 */
function takenAsPackageName(packageName: string): string {
  return `\`${packageName}\` is not one of the short names (${SHORT_NAME_LIST}), so init took it as a package name.`;
}

const LISTED_INSTEAD = `To use a database package from the list instead, pass its short name (${SHORT_NAME_FLAGS}); for any other, pass its full package name.`;

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
 * Dependency installation failed. Files scaffolded before the install step are already on disk;
 * `meta.filesWritten` carries the list so a follow-up agent can resume manually. Maps to exit code
 * `4 = INSTALL_FAILED`.
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
      ? 'The package manager exited with an error.'
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

const PRISMA7_SUPPORTED_PROVIDERS = KNOWN_TARGET_PACKAGES.map((entry) => entry.provider.name);

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

/**
 * The project does not have the facade: `--skip-install` forbade installing it, or init's
 * install command succeeded and the package still cannot be found from the project. Init takes
 * every file it writes from that package, so it stops before writing any scaffold file.
 */
export function errorInitTargetPackageNotInstalled(options: {
  readonly packageName: string;
  readonly installCommand: string;
  /** The install command init ran and that exited successfully; `undefined` under `--skip-install`. */
  readonly ranCommand: string | undefined;
  /** The package is in no list, so the value was taken as a package name. */
  readonly unlisted: boolean;
  /** The project's package manager; under Yarn the fix says what to do about Plug'n'Play. */
  readonly packageManager: PackageManager;
}): CliStructuredError {
  const { packageName, ranCommand } = options;
  const plugNPlay =
    options.packageManager === 'yarn'
      ? " `prisma orm init` does not support Yarn Plug'n'Play: set `nodeLinker: node-modules` in `.yarnrc.yml`, run `yarn install`, then run `prisma orm init` again."
      : '';
  const why =
    ranCommand !== undefined
      ? `\`${ranCommand}\` succeeded, but ${packageName} cannot be found from the project, so init cannot read its init contribution. No scaffold file was written.`
      : `init writes the project from ${packageName}, and \`--skip-install\` forbids installing it. Nothing was changed.`;
  const fix =
    ranCommand !== undefined
      ? `Check that \`${options.installCommand}\` makes ${packageName} resolvable from this directory, then run \`prisma orm init\` again.${plugNPlay}`
      : options.unlisted
        ? `Run \`prisma orm init\` again without \`--skip-install\`: it checks that ${packageName} lists the keyword \`${PRISMA_ORM_PACKAGE_KEYWORD}\` before installing it.${plugNPlay}`
        : `Install it with \`${options.installCommand}\`, then run \`prisma orm init\` again, or run it without \`--skip-install\`.${plugNPlay}`;
  return new CliStructuredError(
    'CLI.INIT_TARGET_PACKAGE_NOT_INSTALLED',
    ranCommand !== undefined
      ? `${packageName} cannot be found from the project`
      : `${packageName} is not installed`,
    {
      ...explainUnlisted(options.unlisted, packageName, { why, fix }),
      docsUrl: docsUrlFor('CLI.INIT_TARGET_PACKAGE_NOT_INSTALLED'),
      meta: {
        packageName: options.packageName,
        ...(options.unlisted && ranCommand === undefined
          ? {}
          : { installCommand: options.installCommand }),
        ...takenAsPackageNameMeta(options.unlisted),
      },
    },
  );
}

/**
 * For a package in no list, says first that the value was taken as a package name, and last how
 * to name a listed one instead.
 */
function explainUnlisted(
  unlisted: boolean,
  packageName: string,
  wording: { readonly why: string; readonly fix: string },
): { readonly why: string; readonly fix: string } {
  return unlisted
    ? {
        why: `${takenAsPackageName(packageName)} ${wording.why}`,
        fix: `${wording.fix} ${LISTED_INSTEAD}`,
      }
    : wording;
}

function takenAsPackageNameMeta(unlisted: boolean): { readonly takenAsPackageName?: true } {
  return unlisted ? { takenAsPackageName: true } : {};
}

/**
 * A package in no list does not list the keyword init requires of a facade, or init could
 * not read its keywords. Init checks before installing or loading it, so nothing was changed.
 * `registry` is set when the keywords were to come from the registry rather than the installed
 * package.
 */
export function errorInitTargetPackageNotVerified(
  options: {
    readonly packageName: string;
    readonly installCommand: string;
    /** The command that updates the package to its latest version. */
    readonly updateCommand: string;
  } & (
    | { readonly reason: 'keyword-missing'; readonly registry: string | undefined }
    | { readonly reason: 'not-found'; readonly registry: string }
    | {
        readonly reason: 'lookup-failed';
        /** `undefined` when the installed `package.json` could not be read. */
        readonly registry: string | undefined;
        readonly cause: string;
      }
  ),
): CliStructuredError {
  const { packageName, installCommand } = options;
  const keyword = `\`${PRISMA_ORM_PACKAGE_KEYWORD}\``;
  const required =
    'init requires that keyword of a database package before it installs or uses one';
  const runAgain = 'run `prisma orm init` again';
  const maintainer = `If you maintain ${packageName}, add ${keyword} to the keywords in its package.json and publish a new version.`;
  const wording = (() => {
    switch (options.reason) {
      case 'keyword-missing':
        return options.registry === undefined
          ? {
              summary: `${packageName} does not list the keyword ${keyword}`,
              why: `The installed ${packageName} does not list the keyword ${keyword} in its package.json. ${required}, so it did not use ${packageName}. Nothing was changed.`,
              fix: `Check the package name. If a newer version of ${packageName} lists the keyword, update it with \`${options.updateCommand}\` and ${runAgain}. ${maintainer}`,
            }
          : {
              summary: `${packageName} does not list the keyword ${keyword}`,
              why: `The latest version of ${packageName} on ${options.registry} does not list the keyword ${keyword} in its package.json. ${required}, so it did not install ${packageName}. Nothing was changed.`,
              fix: `Check the package name. ${maintainer}`,
            };
      case 'not-found':
        return {
          summary: `${packageName} was not found`,
          why: `No package named ${packageName} was found on ${options.registry}. Nothing was changed.`,
          fix: `Check the package name. init asks only ${options.registry} and sends no credentials, so a package on another registry, or one that needs credentials, is not found there: install it yourself with \`${installCommand}\` and ${runAgain}, and init reads it from disk.`,
        };
      case 'lookup-failed': {
        const from = options.registry === undefined ? '' : ` from ${options.registry}`;
        return {
          summary: `Could not read the keywords of ${packageName}`,
          why: `init requires the keyword ${keyword} of a database package before it installs or uses one, and it could not read the keywords of ${packageName}${from}: ${options.cause}. Nothing was changed.`,
          fix:
            options.registry === undefined
              ? `Check the package name. If it is right, reinstall ${packageName} with \`${installCommand}\` and ${runAgain}.`
              : `Check the package name. If it is right and ${packageName} lists ${keyword}, install it yourself with \`${installCommand}\` and ${runAgain}: init reads the keywords of an installed package from disk.`,
        };
      }
    }
  })();
  return new CliStructuredError('CLI.INIT_TARGET_PACKAGE_NOT_VERIFIED', wording.summary, {
    ...explainUnlisted(true, packageName, wording),
    docsUrl: docsUrlFor('CLI.INIT_TARGET_PACKAGE_NOT_VERIFIED'),
    meta: {
      reason: options.reason,
      packageName,
      keyword: PRISMA_ORM_PACKAGE_KEYWORD,
      ...(options.registry === undefined ? {} : { registry: options.registry }),
      ...takenAsPackageNameMeta(true),
    },
  });
}

/**
 * The facade has no `init` entrypoint, its init module cannot be loaded, or its default
 * export is not an init contribution. The package is installed and no scaffold file was written.
 */
export function errorInitContributionUnavailable(options: {
  readonly packageName: string;
  readonly reason: 'no-entrypoint' | 'unloadable' | 'invalid-shape';
  /** What went wrong, for `unloadable` and `invalid-shape`. */
  readonly detail: string | undefined;
  /** The package is in no list, so the value was taken as a package name. */
  readonly unlisted: boolean;
  /** Required peers of the package that are not installed, a likely cause of an `unloadable` module. */
  readonly missingPeers: readonly string[];
  /** The command that adds `missingPeers`; `undefined` when there are none. */
  readonly missingPeersCommand: string | undefined;
}): CliStructuredError {
  const module = `${options.packageName}/init`;
  const detail = options.detail ?? 'its shape is wrong';
  const why = {
    'no-entrypoint': `${options.packageName} has no \`${module}\` entrypoint, so it does not support \`prisma orm init\`.`,
    unloadable: `\`${module}\` could not be loaded: ${detail}.`,
    'invalid-shape': `The default export of \`${module}\` is not an init contribution: ${detail}.`,
  }[options.reason];
  const byHand = `Write prisma.config.ts by hand, with the defineConfig import the README of ${options.packageName} shows.`;
  return new CliStructuredError(
    'CLI.INIT_CONTRIBUTION_UNAVAILABLE',
    options.reason === 'unloadable'
      ? `Could not load ${module}`
      : `${options.packageName} does not support init`,
    {
      ...explainUnlisted(options.unlisted, options.packageName, {
        why: `${why} ${options.packageName} is installed; no scaffold file was written.`,
        fix:
          options.reason === 'unloadable' && options.missingPeersCommand !== undefined
            ? `${listed(options.missingPeers)}, which ${options.packageName} needs as ${options.missingPeers.length === 1 ? 'a peer, is' : 'peers, are'} not installed: a package manager that installs no peer dependencies leaves them out. Add them with \`${options.missingPeersCommand}\`, then run \`prisma orm init\` again.`
            : options.reason === 'unloadable'
              ? `Reinstall ${options.packageName} with your package manager and run \`prisma orm init\` again, or ${byHand.charAt(0).toLowerCase()}${byHand.slice(1)}`
              : byHand,
      }),
      docsUrl: docsUrlFor('CLI.INIT_CONTRIBUTION_UNAVAILABLE'),
      meta: {
        packageName: options.packageName,
        module,
        reason: options.reason,
        ...takenAsPackageNameMeta(options.unlisted),
      },
    },
  );
}

/**
 * Under `--skip-install`, the facade is installed but some of its required peers are not,
 * as a package manager that installs no peer dependencies leaves them. Init stops before loading
 * the package's `init` entrypoint, which would fail to resolve them. Nothing was changed. Maps to
 * exit code `2 = PRECONDITION`.
 */
export function errorInitRequiredPeersNotInstalled(options: {
  readonly packageName: string;
  readonly missing: readonly string[];
  /** The command that adds the missing peers `package.json` does not list; `undefined` when it lists them all. */
  readonly installCommand: string | undefined;
  /** The missing peers `package.json` already lists, which an install puts in place without rewriting their lines. */
  readonly listedMissing: readonly string[];
  /** The package manager's own install command, for `listedMissing`. */
  readonly restoreCommand: string;
}): CliStructuredError {
  const { packageName, missing, listedMissing } = options;
  const steps: string[] = [];
  if (listedMissing.length > 0) {
    steps.push(
      `Run \`${options.restoreCommand}\` to install ${listed(listedMissing)}, which package.json already lists`,
    );
  }
  if (options.installCommand !== undefined) {
    steps.push(
      `${listedMissing.length === 0 ? 'Add them' : 'add the others'} with \`${options.installCommand}\``,
    );
  }
  return new CliStructuredError(
    'CLI.INIT_REQUIRED_PEERS_NOT_INSTALLED',
    `${packageName} needs peer dependencies that are not installed`,
    {
      why: `${packageName} names ${listed(missing)} as required peer dependencies, and ${missing.length === 1 ? 'it cannot' : 'they cannot'} be found from the project or from where ${packageName} is installed. \`--skip-install\` forbids installing them. Nothing was changed.`,
      fix: `${steps.join(', and ')}, then run \`prisma orm init\` again.`,
      docsUrl: docsUrlFor('CLI.INIT_REQUIRED_PEERS_NOT_INSTALLED'),
      meta: {
        packageName,
        missing,
        listedMissing,
        ...ifDefined('installCommand', options.installCommand),
        ...(listedMissing.length === 0 ? {} : { restoreCommand: options.restoreCommand }),
      },
    },
  );
}

export interface RequiredPeerAtAnotherVersion {
  readonly name: string;
  /** The version of the copy the project resolves. */
  readonly found: string;
  /** The version or range the package that names it requires. */
  readonly required: string;
  /** The project's `package.json` line for it, when that line has to change. */
  readonly listed: string | undefined;
  /**
   * How to change `listed`: rewrite an exact version and install; replace a range with the
   * requirement through `command`, which adds the package at it; or, for a line that points
   * elsewhere (a catalog, a workspace), change the version where it points.
   */
  readonly lineFix:
    | { readonly kind: 'change-and-install' }
    | { readonly kind: 'add-at-requirement'; readonly command: string }
    | { readonly kind: 'resolve' }
    | undefined;
}

/** Under `--skip-install`, a required peer is installed at a version its requirement does not admit. */
export function errorInitRequiredPeersAtAnotherVersion(options: {
  readonly packageName: string;
  readonly packages: readonly RequiredPeerAtAnotherVersion[];
  /** The command that adds those `package.json` does not list; `undefined` when it lists them all. */
  readonly installCommand: string | undefined;
  /** Those `package.json` lists at a line that stands for the requirement; reported in `meta`. */
  readonly listedAtRequired: readonly string[];
  /**
   * Those of `listedAtRequired` whose installed copy the listed line does not admit. An install may
   * put the listed version in place, or an override, a resolution or the lockfile may keep the copy.
   */
  readonly outsideListedLine: readonly { readonly name: string; readonly found: string }[];
  /** The package manager's own install command. */
  readonly restoreCommand: string;
}): CliStructuredError {
  const { packageName, packages, outsideListedLine } = options;
  const steps: string[] = packages.flatMap((pkg) => {
    const fix = pkg.lineFix;
    if (fix === undefined) return [];
    if (fix.kind === 'change-and-install') {
      return [
        `Change the line for ${pkg.name} in package.json from ${pkg.listed} to ${pkg.required} and run \`${options.restoreCommand}\``,
      ];
    }
    if (fix.kind === 'resolve') {
      return [
        `Make the line for ${pkg.name} in package.json resolve to ${pkg.required} (it is \`${pkg.listed}\` now, so change the version where it points, such as the catalog entry or the workspace package) and run \`${options.restoreCommand}\``,
      ];
    }
    return [
      `package.json lists ${pkg.name} at ${pkg.listed}, which does not keep it within ${pkg.required}, the range ${packageName} requires, and ${pkg.found} is installed: change the line to ${pkg.required} with \`${fix.command}\``,
    ];
  });
  for (const outside of outsideListedLine) {
    steps.push(
      `package.json already lists ${outside.name} at a version ${packageName} accepts, but ${outside.found} is installed: run \`${options.restoreCommand}\`, and if ${outside.name} is still at another version, an override, a resolution or the lockfile pins it, so remove that and run \`${options.restoreCommand}\` again`,
    );
  }
  if (options.installCommand !== undefined) {
    steps.push(
      `${steps.length === 0 ? 'Add them' : 'add the others'} with \`${options.installCommand}\``,
    );
  }
  const found = packages.map(
    (pkg) => `${pkg.name} at ${pkg.found}, where ${pkg.required} is required`,
  );
  return new CliStructuredError(
    'CLI.INIT_REQUIRED_PEERS_AT_ANOTHER_VERSION',
    `${packageName} needs peer dependencies at versions that are not installed`,
    {
      why: `${packageName} needs its required peer dependencies at the versions it names, and the project has ${listed(found)}. A copy at another version does not stand for the one required, and init cannot tell which peers the required version needs in turn. \`--skip-install\` forbids installing them. Nothing was changed.`,
      fix: `${steps.join(', and ')}, then run \`prisma orm init\` again.`,
      docsUrl: docsUrlFor('CLI.INIT_REQUIRED_PEERS_AT_ANOTHER_VERSION'),
      meta: {
        packageName,
        packages: packages.map((pkg) => ({
          name: pkg.name,
          found: pkg.found,
          required: pkg.required,
          ...ifDefined('listed', pkg.listed),
        })),
        listedAtRequired: options.listedAtRequired,
        ...ifDefined('installCommand', options.installCommand),
        restoreCommand: options.restoreCommand,
      },
    },
  );
}

/** `--authoring` names a way to write the contract the facade does not offer. */
export function errorInitAuthoringUnsupported(options: {
  readonly packageName: string;
  readonly authoring: string;
  readonly offered: readonly string[];
}): CliStructuredError {
  return new CliStructuredError(
    'CLI.INIT_AUTHORING_UNSUPPORTED',
    `${options.packageName} does not offer --authoring ${options.authoring}`,
    {
      why: `${options.packageName} offers: ${options.offered.join(', ')}. No scaffold file was written.`,
      fix: `Use one of: ${options.offered.map((mode) => `--authoring ${mode}`).join(', ')}.`,
      docsUrl: docsUrlFor('CLI.INIT_AUTHORING_UNSUPPORTED'),
      meta: {
        packageName: options.packageName,
        authoring: options.authoring,
        offered: options.offered,
      },
    },
  );
}

/**
 * What init's install changed in `package.json` before it found out it could not continue: the
 * packages it declared, and the declarations whose range it rewrote.
 */
export interface PackagesAdded {
  readonly packages: readonly string[];
  readonly removeCommand: string;
  readonly rewritten: readonly { readonly name: string; readonly before: string }[];
}

function listed(items: readonly string[]): string {
  const last = items.at(-1) ?? '';
  return items.length <= 1 ? last : `${items.slice(0, -1).join(', ')} and ${last}`;
}

/** Why init installed the packages it then has to tell the user how to remove. */
export type InstallReason =
  | { readonly kind: 'prisma7-check' }
  | { readonly kind: 'init-contribution'; readonly packageName: string };

export const PRISMA7_CHECK: InstallReason = { kind: 'prisma7-check' };

/** The next action that tells the user how to undo what init installed. */
export function packagesAddedAction(added: PackagesAdded, reason: InstallReason): string {
  const rewritten = listed(
    added.rewritten.map(({ name, before }) => `${name}, which was \`${before}\``),
  );
  const rangeNote =
    added.rewritten.length === 0
      ? ''
      : `changed the declared range of ${rewritten}; set it back in package.json.`;
  if (added.packages.length === 0) {
    return `init ${rangeNote}`;
  }
  const pronoun = added.packages.length === 1 ? 'it' : 'them';
  const packages = listed(added.packages);
  const remove = `remove ${pronoun} with \`${added.removeCommand}\`.`;
  const sentence =
    reason.kind === 'prisma7-check'
      ? `init added ${packages} to package.json before checking; ${remove}`
      : `init installed ${packages} to read the init contribution of ${reason.packageName}; ${remove}`;
  return rangeNote === '' ? sentence : `${sentence} It also ${rangeNote}`;
}

/**
 * The facade init loads to read the Prisma 7 schema cannot be loaded
 * from the project, it has no Prisma 7 contract source while
 * `--from-prisma7-schema` asked for one, or it is in no list, and only a
 * listed package can keep a Prisma 7 schema.
 */
export function errorInitPrisma7SourceUnavailable(
  options: {
    readonly schemaPath: string;
    readonly packageName: string;
  } & (
    | { readonly reason: 'no-prisma7-source' }
    | { readonly reason: 'unlisted' }
    | {
        readonly reason: 'not-resolvable';
        /** The config module the contribution names. */
        readonly module: string;
      }
    | {
        readonly reason: 'unloadable';
        /** The config module the contribution names. */
        readonly module: string;
        readonly cause: string;
      }
  ),
): CliStructuredError {
  const { packageName, schemaPath } = options;
  const wording =
    options.reason === 'unloadable'
      ? {
          summary: `Could not load ${options.module}`,
          why: `\`${options.module}\` could not be loaded: ${options.cause}. init cannot check that Prisma 8 reads ${schemaPath}.`,
          fix: `Reinstall ${packageName} with your package manager, then run \`prisma orm init\` again.`,
        }
      : options.reason === 'not-resolvable'
        ? {
            summary: `Could not load ${options.module} from the project`,
            why: `${packageName} was installed, but the project cannot find \`${options.module}\`, the config module its init contribution names, so init cannot check that Prisma 8 reads ${schemaPath}.`,
            fix: `Check that ${packageName} is installed and exports ${options.module}, resolvable from this directory (Yarn Plug'n'Play hides packages from Node), then run \`prisma orm init\` again.`,
          }
        : options.reason === 'unlisted'
          ? {
              summary: `${packageName} cannot keep a Prisma 7 schema`,
              why: `${packageName} is not one of the database packages in Prisma's list (${SHORT_NAME_LIST}), and only a package in that list can keep ${schemaPath} as the contract source. Nothing was changed.`,
              fix: `Run \`prisma orm init\` without \`--from-prisma7-schema\` to start a fresh contract on ${packageName}. To keep ${schemaPath}, name a database package from the list instead.`,
            }
          : {
              summary: 'No Prisma 7 contract source for this database',
              why: `${packageName} does not provide a Prisma 7 contract source, so it cannot read ${schemaPath}.`,
              fix: 'Choose a database whose Prisma 8 package reads Prisma 7 schemas, or run `prisma orm init` without `--from-prisma7-schema`.',
            };
  return new CliStructuredError('CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE', wording.summary, {
    why: wording.why,
    fix: wording.fix,
    docsUrl: docsUrlFor('CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE'),
    meta: {
      schemaPath: options.schemaPath,
      packageName: options.packageName,
      reason: options.reason,
      ...(options.reason === 'no-prisma7-source' || options.reason === 'unlisted'
        ? {}
        : { module: options.module }),
    },
  });
}

/**
 * The facade's Prisma 7 contract source refused the schema. Nothing but the check's install
 * happened.
 */
export function errorInitPrisma7SchemaRefused(options: {
  readonly schemaPath: string;
  readonly packageName: string;
  readonly summary: string;
  readonly diagnostics: readonly unknown[];
}): CliStructuredError {
  const findings = options.diagnostics.map(
    (diagnostic) => `\n  ${formatSourceDiagnostic(diagnostic)}`,
  );
  return new CliStructuredError(
    'CLI.INIT_PRISMA7_SCHEMA_REFUSED',
    `Prisma 8 cannot read ${options.schemaPath}`,
    {
      why: `${options.summary}${findings.join('')}`,
      fix: `Edit ${options.schemaPath} as each finding says (see the Prisma 7 contract source section of the ${options.packageName} README), or run \`prisma orm init\` without \`--from-prisma7-schema\`.`,
      docsUrl: docsUrlFor('CLI.INIT_PRISMA7_SCHEMA_REFUSED'),
      meta: {
        schemaPath: options.schemaPath,
        summary: options.summary,
        diagnostics: options.diagnostics,
      },
    },
  );
}

/**
 * The project's schema names a provider only Prisma 6 wrote, so it is a Prisma 6 schema. Init stops before changing anything and gives
 * the side-by-side setup as its next actions: set up by init, Prisma 8 would take the `prisma`
 * package name and `prisma.config.ts` from the Prisma 6 CLI the app still runs.
 */
export function errorInitPrisma6SchemaFound(options: {
  readonly schemaPath: string;
  /** The database the schema is for, as the user knows it. */
  readonly database: string;
  readonly setup: Prisma6SideBySideSetup;
}): CliStructuredError {
  const { database } = options;
  return new CliStructuredError(
    'CLI.INIT_PRISMA6_SCHEMA_FOUND',
    `Prisma 6 ${database} schema found`,
    {
      why: `${options.schemaPath} is a Prisma 6 ${database} schema. Prisma 8 can read it as its contract source through prisma6Schema while Prisma 6 keeps running the app, but init does not set that up: both CLIs are published as \`prisma\`, and the Prisma 6 CLI also reads prisma.config.ts. Nothing was changed. Follow the steps below. Passing --target and --authoring instead sets up a Prisma 8 starter in this same project, which breaks the Prisma 6 CLI: it writes prisma.config.ts, so every Prisma 6 command fails until Prisma 6 gets its own config file, and its install step replaces the Prisma 6 CLI with prisma@latest.`,
      nextActions: options.setup.steps,
      docsUrl: docsUrlFor('CLI.INIT_PRISMA6_SCHEMA_FOUND'),
      meta: {
        schemaPath: options.schemaPath,
        prismaConfig: options.setup.prismaConfig,
        prisma6Config: options.setup.prisma6Config,
      },
    },
  );
}
