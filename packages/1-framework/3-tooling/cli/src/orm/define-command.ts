import type { PrismaNextConfig } from '@internal/config/config-types';
import { finalizeConfig } from '@internal/config-loader';
import { blindCast } from '@internal/utils/casts';
import { isInternalError } from '@internal/utils/internal-error';
import type {
  ArgsSpec,
  CommandDefinition,
  FlagSpec,
  Handler,
  HelpSpec,
  NeedsSpec,
  PositionalSpec,
  SpawnDeclarations,
} from '@prisma/cli-engine';
import { defineCommand } from '@prisma/cli-engine';
import { notOk } from '@prisma/cli-engine/protocol';
import { normalizeError } from './normalize-error';

/**
 * `defineCommand` with the ORM's error boundary already attached. Every ORM command is defined
 * through this rather than through `defineCommand` directly.
 *
 * Without it, an error a handler throws reaches the engine, whose duck test accepts
 * prisma/prisma's `CliStructuredError` — both classes carry that name — and then settles it
 * through fields the engine's own class has and this one does not. The envelope that results is
 * off-protocol. Catching here means every handler settles through the single conversion instead.
 *
 * An `InternalError` is the one thing this boundary does not convert. Its own contract says never
 * to catch it outside the outermost boundary: it means an invariant broke, which is a bug in
 * Prisma ORM rather than something the user did. Re-throwing lets the engine settle it as a bug
 * at exit 1, where converting it would report the same number as a bad connection string.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Hands the handler a config whose paths are absolute. The engine's own
 * loader evaluates `prisma.config.ts` without touching the paths inside it, so
 * a command mounted in the unified host receives `contract.output` and
 * `migrations.dir` exactly as authored — usually relative — while this repo's
 * bin finalizes them in its loader. Anchoring here, on the section every ORM
 * command reads, makes both hosts hand handlers the same absolute paths.
 *
 * The anchor is the working directory: the engine discovers the config in the
 * working directory only, so that is the file's own directory. (A `--config`
 * pointing into another directory is not visible from a command context; a
 * relative path inside such a file resolves against the invocation directory,
 * which is also what the file's author sees the command run from.)
 * Finalization is idempotent — an already-absolute path resolves to itself —
 * so a config that arrived finalized passes through unchanged.
 */
function finalizedConfigContext<TCtx extends { readonly cwd: string; readonly config: unknown }>(
  ctx: TCtx,
): TCtx {
  if (!isRecord(ctx.config)) {
    return ctx;
  }
  const config = blindCast<
    PrismaNextConfig,
    'every ORM command that declares needs.config reads the orm section, whose validated value is PrismaNextConfig'
  >(ctx.config);
  return { ...ctx, config: finalizeConfig(config, ctx.cwd) };
}

export function defineOrmCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = Record<never, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>> = Record<
    never,
    PositionalSpec<unknown>
  >,
  TConfig = undefined,
  TCode extends number = never,
  TInstallsPackages extends boolean = false,
>(
  def: {
    readonly help: HelpSpec;
    readonly args?: ArgsSpec<TFlags, TPositionals>;
    readonly needs?: NeedsSpec<TConfig>;
    readonly exitCodes?: Readonly<Record<TCode, string>>;
    readonly installsPackages?: TInstallsPackages;
    readonly handler: Handler<TFlags, TPositionals, TConfig, TCode, false, TInstallsPackages>;
  } & SpawnDeclarations,
): CommandDefinition<TFlags, TPositionals, TConfig, TCode, false, TInstallsPackages> {
  return defineCommand<TFlags, TPositionals, TConfig, TCode, false, TInstallsPackages>({
    ...def,
    handler: async (args, ctx) => {
      try {
        return await def.handler(args, finalizedConfigContext(ctx));
      } catch (error) {
        if (isInternalError(error)) {
          throw error;
        }
        return notOk(normalizeError(error));
      }
    },
  });
}
