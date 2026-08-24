/**
 * The migration-file CLI interface: the actor invoked when the author runs
 * `node migration.ts` directly.
 *
 * Naming: this is *not* a "migration runner" in the apply-time sense. The
 * apply-time runner is the thing `prisma db migrate` uses to
 * execute migration JSON ops against a database. `MigrationCLI` is the
 * tiny CLI surface owned by an authored `migration.ts` file: parse the
 * file's argv, load the project's `prisma.config.ts`, assemble a
 * `ControlStack`, instantiate the migration class, and serialize.
 *
 * The user authors a migration class, then calls
 * `MigrationCLI.run(import.meta.url, MigrationClass)` at module scope
 * after the class definition. When the file is invoked as a node
 * entrypoint (`node migration.ts`), the CLI:
 *
 * 1. Detects whether the file is the direct entrypoint (no-op when imported).
 * 2. Parses CLI args (`--help`, `--dry-run`, `--config <path>`) via
 *    [clipanion](https://github.com/arcanis/clipanion).
 * 3. Loads the project's `prisma.config.ts` via the same
 *    `loadConfigForSections` the CLI commands use, walking up from the
 *    migration file's directory.
 * 4. Probe-instantiates the migration class without a stack so it can read
 *    `targetId` and verify it matches `config.target.targetId`
 *    (`MIGRATION.TARGET_MISMATCH` on mismatch) before any stack-driven adapter
 *    construction runs.
 * 5. Assembles a `ControlStack` from the loaded config descriptors and
 *    constructs the migration with that stack.
 * 6. Reads any previously-scaffolded `migration.json`, then calls
 *    `buildMigrationArtifacts` from `@internal/migration-tools` to
 *    produce in-memory `ops.json` + `migration.json` content. Persists
 *    the result to disk (or prints in dry-run mode).
 *
 * File I/O lives here, in `@internal/cli`: this is the only place
 * that legitimately combines config loading, stack assembly, and
 * on-disk persistence. `@internal/migration-tools` owns the pure
 * conversion from a `Migration` instance to artifact strings; `Migration`
 * stays a pure abstract class.
 *
 * Parser library: clipanion (chosen over Commander/citty/`node:util.parseArgs`
 * for its in-process testability and runtime-agnostic execution surface; see
 * `docs/architecture docs/research/commander-friction-points.md` for the
 * evaluation rubric and the durable rationale that drove the choice).
 */

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import type { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { loadConfigForSections } from '@internal/config-loader';
import {
  CliStructuredError,
  errorMigrationCliInvalidConfigArg,
  errorMigrationCliUnknownFlag,
} from '@internal/errors/control';
import { errorMigrationTargetMismatch } from '@internal/errors/migration';
import { createControlStack } from '@internal/framework-components/control';
import { errorInvalidJson } from '@internal/migration-tools/errors';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { buildMigrationArtifacts, type Migration } from '@internal/migration-tools/migration';
import { Cli, Command, Option, UsageError } from 'clipanion';
import { dirname, join } from 'pathe';

/**
 * Constructor shape accepted by `MigrationCLI.run`. `Migration` subclasses
 * accept an optional `ControlStack` in their constructor (each subclass
 * narrows the stack to its own family/target generics); the CLI always
 * passes one assembled from the loaded config. We use a rest-args `any[]`
 * constructor signature so that subclass constructors with narrower
 * parameter types remain assignable - constructor type compatibility in
 * TS is contravariant in the parameter, and a wider `unknown` parameter
 * on the alias side would reject any narrower subclass signature.
 *
 * The CLI only ever passes one argument (`new MigrationClass(stack)`);
 * the rest-arity is purely a type-compatibility concession for subclass
 * constructors that declare narrower parameter types, not an extension
 * point for additional construction arguments.
 */
// biome-ignore lint/suspicious/noExplicitAny: see JSDoc - rest args with any are the idiomatic TS pattern for accepting arbitrary subclass constructor signatures
export type MigrationConstructor = new (...args: any[]) => Migration;

/**
 * Stream surface accepted by `MigrationCLI.run`'s `options.stdout` /
 * `options.stderr`. Aliases node's `Writable` because clipanion's
 * `BaseContext.stdout`/`stderr` are typed as `Writable`, and the CLI
 * forwards the injected streams into clipanion's context.
 *
 * `process.stdout` and `process.stderr` are `Writable`-shaped, so the
 * default-fallback path remains a no-op for existing two-argument
 * callers like `MigrationCLI.run(import.meta.url, MyMigration)`.
 *
 * Tests inject a `Writable` subclass that captures chunks for
 * assertions.
 */
export type MigrationCliWritable = Writable;

/**
 * Flags exposed by the migration-file CLI.
 *
 * Must stay in sync with the `Option` declarations on
 * `MigrationFileCommand` below. This list is rendered in the
 * `errorMigrationCliUnknownFlag` envelope's `fix` text and `meta`,
 * so order matters for user-visible output (declaration order is the
 * order users see when they run `--help`).
 */
const KNOWN_FLAGS: readonly string[] = ['--help', '--dry-run', '--config'];

/**
 * The clipanion command that owns the migration-file CLI's option
 * declarations. The class is internal — `MigrationCLI.run` is the
 * stable public surface. Adding a flag here automatically updates
 * `--help` rendering and the `KNOWN_FLAGS` list (the latter must be
 * updated in tandem).
 */
class MigrationFileCommand extends Command {
  static override paths = [Command.Default];

  static override usage = Command.Usage({
    description: 'Self-emit ops.json and migration.json from a class-flow migration',
    details: `
      Loads the project's prisma.config.ts, assembles a ControlStack
      from the configured target/adapter/extensions, and serializes the
      migration's operations + metadata next to this file.
    `,
    examples: [
      ['Self-emit ops.json + migration.json next to migration.ts', '$0'],
      ['Preview without writing files', '$0 --dry-run'],
      ['Use a non-default config path', '$0 --config ./custom.config.ts'],
    ],
  });

  dryRun = Option.Boolean('--dry-run', false, {
    description: 'Print operations to stdout without writing files',
  });

  config = Option.String('--config', {
    description: 'Path to prisma.config.ts',
  });

  /**
   * Unused: orchestration runs inside `MigrationCLI.run` so error
   * routing stays under our control (clipanion's `cli.run` writes
   * error output to `context.stdout`, but our contract requires
   * structured errors on stderr). `cli.process` is used to parse
   * argv into a populated `MigrationFileCommand` instance whose
   * fields drive the orchestration directly.
   */
  override async execute(): Promise<number> {
    return 0;
  }
}

/**
 * The CLI surface invoked by an authored `migration.ts` file. Exposed as
 * a class with a static `run` method (rather than a free function) to
 * give the concept a stable identity in the ubiquitous language: this is
 * the "migration-file CLI", distinct from the apply-time runner that
 * executes migration JSON ops.
 *
 * Currently a single static method. Future surface (e.g. a programmatic
 * `MigrationCLI.serializeOnly(...)` for tests, or extra subcommands) can
 * land here without changing the import shape used by every authored
 * migration.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: see JSDoc - intentional class facade for the migration-file CLI surface; future methods will share state derived from argv/config.
export class MigrationCLI {
  /**
   * Orchestrates a class-flow `migration.ts` script run.
   *
   * The third argument is the in-process testability surface: callers
   * (and tests) may inject `argv`, `stdout`, and `stderr` instead of
   * relying on `process.argv` / `process.stdout` / `process.stderr`.
   * Each option defaults to its `process` global when omitted, so
   * existing two-argument call sites
   * (`MigrationCLI.run(import.meta.url, MyMigration)`) continue to
   * compile and behave identically.
   *
   * Returns the exit code so the caller can branch on it. Also writes
   * the same code to `process.exitCode` so script-style callers that
   * don't await the return value still surface a non-zero exit when
   * something fails.
   *
   * Exit codes:
   * - 0 — success, or `--help`, or imported-not-entrypoint no-op.
   * - 1 — runtime/orchestration error (config not found, target
   *   mismatch, etc.).
   * - 2 — usage error (unknown flag, malformed `--config`). Aligns
   *   with `docs/CLI Style Guide.md` § Exit Codes.
   */
  static async run(
    importMetaUrl: string,
    MigrationClass: MigrationConstructor,
    options: {
      readonly argv?: readonly string[];
      readonly stdout?: MigrationCliWritable;
      readonly stderr?: MigrationCliWritable;
    } = {},
  ): Promise<number> {
    if (!importMetaUrl) {
      return 0;
    }

    const argv = options.argv ?? process.argv;
    const stdout = options.stdout ?? process.stdout;
    const stderr = options.stderr ?? process.stderr;

    if (!isDirectEntrypoint(importMetaUrl, argv)) {
      return 0;
    }

    const exitCode = await orchestrate(importMetaUrl, MigrationClass, {
      argv,
      stdout,
      stderr,
    });
    // Preserve any pre-existing non-zero `process.exitCode` set by code
    // running alongside `MigrationCLI.run` (an unhandled rejection
    // upstream, an explicit `process.exitCode = N` from another
    // module). Overwriting it with our success would mask the upstream
    // failure for script-style callers that don't await the return
    // value. Failures we return here are still surfaced — non-zero
    // codes always win over the prior status — but successes never
    // clear it.
    if (exitCode !== 0 || !process.exitCode) {
      process.exitCode = exitCode;
    }
    return exitCode;
  }
}

/**
 * Argv-aware variant of the entrypoint guard. The shared
 * `@internal/migration-tools` helper of the same name reads
 * `process.argv[1]` directly, which doesn't compose with the new
 * in-process testability surface (tests inject `argv` without mutating
 * the process global). Inlined here so the migration-file CLI's check
 * follows the injected `argv[1]` consistently.
 */
function isDirectEntrypoint(importMetaUrl: string, argv: readonly string[]): boolean {
  const argv1 = argv[1];
  if (!argv1) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

/**
 * Argv-and-stream-driven orchestration body. Pulled out of the static
 * method so the entrypoint guard / process-default plumbing stays
 * separate from the parse + load + serialize steps.
 */
async function orchestrate(
  importMetaUrl: string,
  MigrationClass: MigrationConstructor,
  ctx: {
    readonly argv: readonly string[];
    readonly stdout: MigrationCliWritable;
    readonly stderr: MigrationCliWritable;
  },
): Promise<number> {
  const cli = Cli.from([MigrationFileCommand], {
    binaryName: 'migration.ts',
    binaryLabel: 'Migration file CLI',
  });

  const input = ctx.argv.slice(2);

  // Pre-scan for malformed `--config` (no value, or value-shaped-as-flag)
  // before delegating to clipanion. The legacy parser surfaced both as
  // `errorMigrationCliInvalidConfigArg` (`CLI.CONFIG_ARG_MISSING_PATH`); pre-scanning
  // here keeps that contract independent of how clipanion classifies
  // the error internally (it variably throws `UnknownSyntaxError` or
  // accepts the flag-shaped token as the value depending on what other
  // options are registered).
  const configError = detectInvalidConfig(input);
  if (configError) {
    writeStructuredError(ctx.stderr, configError);
    return 2;
  }

  let parsed: MigrationFileCommand;
  try {
    const command = cli.process({
      input: [...input],
      context: { stdout: ctx.stdout, stderr: ctx.stderr },
    });
    if (!(command instanceof MigrationFileCommand)) {
      // The only registered command class is `MigrationFileCommand`;
      // any other concrete type indicates clipanion emitted its
      // built-in `HelpCommand`. Render usage directly so we don't
      // depend on calling `cli.run` (which routes errors to stdout —
      // wrong stream for our contract).
      ctx.stdout.write(cli.usage(MigrationFileCommand, { detailed: true }));
      return 0;
    }
    parsed = command;
  } catch (err) {
    return renderParseError(err, input, ctx.stderr);
  }

  if (parsed.help) {
    ctx.stdout.write(cli.usage(MigrationFileCommand, { detailed: true }));
    return 0;
  }

  try {
    await runMigration(importMetaUrl, MigrationClass, parsed, ctx);
    return 0;
  } catch (err) {
    if (CliStructuredError.is(err)) {
      // Migration-tools errors (e.g. `errorInvalidJson` thrown by
      // `readExistingMetadata` when migration.json is malformed) are
      // `CliStructuredError`s and render through the same surface.
      writeStructuredError(ctx.stderr, err);
    } else {
      ctx.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    }
    return 1;
  }
}

/**
 * Returns an `errorMigrationCliInvalidConfigArg` envelope when `input`
 * contains a malformed `--config`:
 *
 * - `--config` as the last token (no value follows).
 * - `--config <flag>` where `<flag>` starts with `-` (silently
 *   consuming the next flag would either drop the flag or serialize
 *   against the wrong project).
 * - `--config <empty>` where the value is the empty string. Shells
 *   expand `--config ""` (or `--config "$UNSET_VAR"`) into a real
 *   empty argv token; treating that as a usage error here surfaces
 *   `CLI.CONFIG_ARG_MISSING_PATH` instead of a less actionable loader error on an
 *   empty path.
 * - `--config=` (the equals form with an empty value). Same shape as
 *   the empty-string case above; the user expressed intent to override
 *   the config path but the override is empty.
 *
 * `--config=<value>` and `--config <value>` with a non-empty value are
 * both valid (and the equals form's value is allowed to start with
 * `-` — the `=` makes the binding explicit).
 */
function detectInvalidConfig(input: readonly string[]): CliStructuredError | null {
  for (let i = 0; i < input.length; i++) {
    const token = input[i];
    if (token === '--config') {
      const next = input[i + 1];
      if (next === undefined || next === '') {
        return errorMigrationCliInvalidConfigArg();
      }
      if (next.startsWith('-')) {
        return errorMigrationCliInvalidConfigArg({ nextToken: next });
      }
      continue;
    }
    if (token === '--config=') {
      return errorMigrationCliInvalidConfigArg();
    }
  }
  return null;
}

/**
 * Translate clipanion's parse-time errors into the project's structured
 * error envelopes.
 *
 * - `UnknownSyntaxError` covers both unknown flags (`--frobnicate`) and
 *   the bare-trailing `--config` case (where arity-1 needs a value but
 *   none was supplied). Distinguished by inspecting the input array.
 * - `UsageError` covers schema/validator failures from typanion. None
 *   of the migration-file CLI's options have validators today, but we
 *   still translate it as a usage error (exit 2) for forward-compat.
 * - Anything else re-throws — caller's outer catch will surface it as
 *   exit 1 (runtime error).
 */
function renderParseError(
  err: unknown,
  input: readonly string[],
  stderr: MigrationCliWritable,
): number {
  if (isUnknownSyntaxError(err)) {
    const flag = findOffendingFlag(input);
    writeStructuredError(stderr, errorMigrationCliUnknownFlag({ flag, knownFlags: KNOWN_FLAGS }));
    return 2;
  }
  if (err instanceof UsageError) {
    // typanion validator failures and similar usage errors. None of
    // the migration-file CLI's options have validators today, so this
    // branch is forward-compat scaffolding — kept so that a future
    // option declaration with a validator routes through the same PN
    // envelope path rather than escaping as exit 1.
    writeStructuredError(stderr, errorMigrationCliInvalidConfigArg({ nextToken: err.message }));
    return 2;
  }
  throw err;
}

/**
 * Duck-type check for clipanion's `UnknownSyntaxError`: the class is
 * thrown by the parser but is not re-exported from the package's main
 * entry (only `UsageError` is — see clipanion's `advanced/index.d.ts`).
 * Identified by `name === 'UnknownSyntaxError'` and the
 * `clipanion.type === 'none'` discriminator that clipanion's
 * `ErrorWithMeta` interface guarantees.
 */
function isUnknownSyntaxError(err: unknown): err is Error {
  if (!(err instanceof Error) || err.name !== 'UnknownSyntaxError') {
    return false;
  }
  // clipanion's `ErrorWithMeta` interface guarantees a `clipanion` field with
  // a `type` discriminator on every error it throws. Read it via a structural
  // shape rather than importing the class (it's not re-exported from the
  // package main).
  const meta = (err as { clipanion?: { type?: string } }).clipanion;
  return typeof meta === 'object' && meta !== null && meta.type === 'none';
}

/**
 * Best-effort: pull the first input token that doesn't match a known
 * flag. Falls back to the first token when we can't pinpoint it. The
 * returned name is rendered into the user-visible CLI.UNKNOWN_FLAG envelope
 * (`Unknown flag \`<name>\``) and round-tripped via `meta.flag` so
 * agent consumers can render their own "did you mean" suggestions.
 */
function findOffendingFlag(input: readonly string[]): string {
  for (const token of input) {
    if (!token.startsWith('-')) {
      continue;
    }
    const head = token.split('=', 1)[0] ?? token;
    if (!KNOWN_FLAGS.includes(head) && head !== '-h') {
      return head;
    }
  }
  return input[0] ?? '';
}

/**
 * Write a `CliStructuredError` envelope to the given stream. Format
 * matches the legacy hand-rolled writer (`message: why`) so the rest of
 * the project's error rendering stays consistent across surfaces. The
 * full PN code (`PN-<domain>-<code>`) is included so consumers can
 * grep for stable identifiers.
 */
function writeStructuredError(stream: MigrationCliWritable, err: CliStructuredError): void {
  const envelope = err.toEnvelope();
  const why = envelope.why ?? envelope.summary;
  const fix = envelope.fix ? `\n${envelope.fix}` : '';
  stream.write(`${envelope.code}: ${envelope.summary}\n${why}${fix}\n`);
}

/**
 * Read a previously-scaffolded `migration.json` from disk, returning
 * `null` when the file is missing and throwing `MIGRATION.INVALID_JSON`
 * when the file is present but cannot be parsed as JSON. The CLI feeds
 * this into `buildMigrationArtifacts` so the pure builder can preserve
 * fields owned by `migration plan` (contract bookends, `createdAt`) across
 * re-emits.
 *
 * Author-time path: this loader still does not verify the manifest hash
 * or schema — that is the apply-time loader's job. Hash mismatch is the
 * *expected* outcome of a re-author (the developer's source changes
 * invalidate the prior hash by construction), and verification here
 * would block legitimate regenerations. Syntactic JSON-parse failure,
 * however, is now surfaced rather than swallowed: a malformed
 * `migration.json` indicates either a hand-edit gone wrong or partial
 * write, and silently rebuilding from `describe()` would discard the
 * user's on-disk content (preserved bookends, `createdAt`) without any
 * indication something was wrong on disk.
 * Apply-time consumers always route through the verifying
 * `readMigrationPackage` in `@internal/migration-tools/io` instead.
 */
function readExistingMetadata(metadataPath: string): Partial<MigrationMetadata> | null {
  let raw: string;
  try {
    raw = readFileSync(metadataPath, 'utf-8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as Partial<MigrationMetadata>;
  } catch (e) {
    throw errorInvalidJson(metadataPath, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Persist a migration instance's artifacts to `migrationDir`. In
 * `dryRun` mode the artifacts are printed to stdout (with the same
 * `--- migration.json --- / --- ops.json ---` framing the legacy
 * `serializeMigration` helper used) and no files are written. Otherwise
 * `ops.json` and `migration.json` are written next to `migration.ts` and
 * a confirmation line is printed.
 *
 * File I/O lives in the CLI rather than `@internal/migration-tools`
 * so the migration-tools package stays focused on the pure
 * `Migration` → in-memory artifact conversion. The CLI is the only
 * legitimate site for combining config loading, stack assembly, and
 * filesystem persistence.
 */
async function serializeMigrationToDisk(
  instance: Migration,
  migrationDir: string,
  dryRun: boolean,
  stdout: MigrationCliWritable,
): Promise<void> {
  const metadataPath = join(migrationDir, 'migration.json');
  const existing = readExistingMetadata(metadataPath);
  const { opsJson, metadataJson } = await buildMigrationArtifacts(instance, existing);

  if (dryRun) {
    stdout.write(`--- migration.json ---\n${metadataJson}\n`);
    stdout.write('--- ops.json ---\n');
    stdout.write(`${opsJson}\n`);
    return;
  }

  writeFileSync(join(migrationDir, 'ops.json'), opsJson);
  writeFileSync(metadataPath, metadataJson);

  stdout.write(`Wrote ops.json + migration.json to ${migrationDir}\n`);
}

/**
 * Inner orchestration: load config, probe-construct the migration,
 * verify target, assemble the stack, construct with the stack, persist.
 *
 * Throws `CliStructuredError` for known failure modes (config not
 * found, target mismatch); the outer `orchestrate` translates those to
 * exit 1.
 */
async function runMigration(
  importMetaUrl: string,
  MigrationClass: MigrationConstructor,
  parsed: MigrationFileCommand,
  ctx: {
    readonly stdout: MigrationCliWritable;
    readonly stderr: MigrationCliWritable;
  },
): Promise<void> {
  const migrationFile = fileURLToPath(importMetaUrl);
  const migrationDir = dirname(migrationFile);

  const configResult = await loadConfigForSections(parsed.config, [
    'family',
    'target',
    'adapter',
    'driver',
    'extensions',
  ]);
  if (!configResult.ok) {
    throw configResult.failure;
  }
  const config = configResult.value;

  // Probe-instantiate without a stack so we can read `targetId` before
  // any target-specific constructor side effects (e.g.
  // `PostgresMigration`'s `stack.adapter.create(stack)`) run. Concrete
  // subclasses are required to accept the no-arg form; the abstract
  // `Migration` constructor declares `stack?` and target subclasses
  // (Postgres, Mongo) propagate that optionality. This makes the
  // target-mismatch guard fail fast with `MIGRATION.TARGET_MISMATCH` before any
  // stack-driven adapter construction begins, even if the wrong-target
  // adapter's `create` would otherwise succeed and silently misshapen
  // the stored adapter cast.
  const probe = new MigrationClass();

  if (probe.targetId !== config.target.targetId) {
    throw errorMigrationTargetMismatch({
      migrationTargetId: probe.targetId,
      configTargetId: config.target.targetId,
    });
  }

  const stack = createControlStack(config);
  const instance = new MigrationClass(stack);

  await serializeMigrationToDisk(instance, migrationDir, parsed.dryRun, ctx.stdout);
  void ctx.stderr;
}
