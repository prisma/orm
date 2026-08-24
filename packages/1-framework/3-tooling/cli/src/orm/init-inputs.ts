import { existsSync, readFileSync } from 'node:fs';
import type { PromptSurface } from '@prisma/cli-engine';
import { basename, join } from 'pathe';
import {
  errorInitMissingFlags,
  errorInitStrictProbeWithoutProbe,
  errorInitUserAborted,
} from '../commands/init/errors';
import { resolveAuthoring, resolveTarget, validateSchemaPath } from '../commands/init/input-values';
import {
  type AuthoringId,
  defaultSchemaPath,
  scaffoldSpecifierResolverFor,
  type TargetId,
  targetLabel,
  targetPackageName,
} from '../commands/init/templates/code-templates';
import { generatedFilesInitReplaces } from './init-scaffold';

/** The flag values `init` reads, after the engine has parsed them. */
export interface InitFlagValues {
  readonly target: string | undefined;
  readonly authoring: string | undefined;
  readonly schemaPath: string | undefined;
  readonly writeEnv: boolean;
  readonly probeDb: boolean;
  readonly strictProbe: boolean;
  readonly skipInstall: boolean;
  readonly keepPreviousFacade: boolean;
}

/** Every decision the scaffold phase operates on. */
export interface ResolvedInitInputs {
  readonly target: TargetId;
  readonly authoring: AuthoringId;
  readonly schemaPath: string;
  readonly install: boolean;
  readonly writeEnv: boolean;
  readonly probeDb: boolean;
  readonly strictProbe: boolean;
  /** True when this run replaces generated files a previous one wrote. */
  readonly reinit: boolean;
  /**
   * The facade package a previous run installed for the other target, when the
   * user consented to dropping it; `null` when there is nothing to drop or the
   * user kept it.
   */
  readonly removePreviousFacade: string | null;
}

const REQUIRED_FLAG_PROMPTS = new Set(['target', 'authoring']);

function formatFileList(files: readonly string[]): string {
  const last = files.at(-1) ?? '';
  return files.length <= 1 ? last : `${files.slice(0, -1).join(', ')} and ${last}`;
}

/**
 * Names the files at stake rather than the category they belong to: the user
 * knows `contract.prisma`, not "every generated file".
 */
function consentQuestion(replaced: readonly string[]): string {
  const written = replaced.length === 1 ? 'it' : 'them';
  return `Re-initializing replaces ${formatFileList(replaced)} with a fresh scaffold, losing anything you wrote in ${written}.`;
}

/**
 * The engine raises this when a prompt has no default and the session cannot
 * show it. For the two prompts that stand in for a required flag, that is the
 * same condition `init` has always reported as a missing flag.
 */
function isPromptRequired(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'CLI.PROMPT_REQUIRED';
}

/**
 * `--confirm` matches a token, so the token has to be something the user can
 * see and type. The working directory's name is it; a directory with no name
 * of its own (the filesystem root) falls back to its path.
 *
 * Trimmed, because the engine compares the typed answer trimmed: an untrimmed
 * token from a directory named `my app ` is one no keystroke sequence matches.
 */
export function consentToken(cwd: string): string {
  const name = basename(cwd).trim();
  return name.length > 0 ? name : cwd.trim();
}

async function askTarget(prompt: PromptSurface): Promise<TargetId> {
  return prompt.select<TargetId>('What database are you using?', [
    // biome-ignore lint/plugin/no-family-vocabulary: names a target on purpose — the interactive picker showing the user what they can choose
    { value: 'postgres', label: 'PostgreSQL' },
    // biome-ignore lint/plugin/no-family-vocabulary: names a target on purpose — the interactive picker showing the user what they can choose
    { value: 'mongo', label: 'MongoDB' },
  ]);
}

async function askAuthoring(prompt: PromptSurface): Promise<AuthoringId> {
  return prompt.select<AuthoringId>('How do you want to write your schema?', [
    { value: 'psl', label: 'Prisma Schema Language (.prisma)' },
    { value: 'typescript', label: 'TypeScript (.ts)' },
  ]);
}

/**
 * The schema path the user typed goes through the same validator the flag
 * does, so an answer the engine accepted still has to agree with the authoring
 * style.
 */
async function askSchemaPath(prompt: PromptSurface, authoring: AuthoringId): Promise<string> {
  const fallback = defaultSchemaPath(authoring);
  const answer = await prompt.text('Where should the schema file go?', {
    placeholder: fallback,
    default: fallback,
  });
  return validateSchemaPath(answer, authoring);
}

/**
 * The facade a previous `init` installed for the other target, when this run
 * switches targets and one is still declared. Reads every name a previous run
 * could have written, because older versions scaffolded the workspace name.
 */
function previousFacade(cwd: string, target: TargetId): string | undefined {
  const manifestPath = join(cwd, 'package.json');
  if (!existsSync(manifestPath)) {
    return undefined;
  }
  const otherTarget: TargetId = target === 'postgres' ? 'mongo' : 'postgres';
  const candidates = [
    targetPackageName(otherTarget, scaffoldSpecifierResolverFor(otherTarget)),
    targetPackageName(otherTarget),
  ];
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return undefined;
  }
  const deps = parsed['dependencies'];
  if (deps === null || typeof deps !== 'object' || Array.isArray(deps)) {
    return undefined;
  }
  const declared = deps;
  return candidates.find((name) => Object.hasOwn(declared, name));
}

async function resolveRemovePreviousFacade(ctx: {
  readonly cwd: string;
  readonly target: TargetId;
  readonly reinit: boolean;
  readonly keepPreviousFacade: boolean;
  readonly prompt: PromptSurface;
}): Promise<string | null> {
  if (!ctx.reinit || ctx.keepPreviousFacade) {
    return null;
  }
  const facade = previousFacade(ctx.cwd, ctx.target);
  if (facade === undefined) {
    return null;
  }
  const otherTarget: TargetId = ctx.target === 'postgres' ? 'mongo' : 'postgres';
  const remove = await ctx.prompt.confirm(
    `Switching from ${targetLabel(otherTarget)} to ${targetLabel(ctx.target)} — remove ${facade} from package.json dependencies?`,
    { default: true },
  );
  return remove ? facade : null;
}

/**
 * Resolves every input from the flags and, where a flag is absent, from the
 * engine's prompt surface.
 *
 * Order matters twice. Every flag value is validated before anything is asked,
 * so a typo costs a typo rather than a typed consent token. And consent comes
 * as soon as the schema path is known, because that is the point at which the
 * question can name the files it is about — and before any question whose
 * answer only matters if the run proceeds.
 */
export async function resolveInitInputs(ctx: {
  readonly cwd: string;
  readonly flags: InitFlagValues;
  readonly prompt: PromptSurface;
}): Promise<ResolvedInitInputs> {
  const { cwd, flags, prompt } = ctx;

  if (flags.strictProbe && !flags.probeDb) {
    throw errorInitStrictProbeWithoutProbe();
  }

  const flagTarget = resolveTarget(flags.target);
  const flagAuthoring = resolveAuthoring(flags.authoring);

  let target: TargetId;
  let authoring: AuthoringId;
  try {
    target = flagTarget ?? (await askTarget(prompt));
    authoring = flagAuthoring ?? (await askAuthoring(prompt));
  } catch (error) {
    if (!isPromptRequired(error)) {
      throw error;
    }
    const missing = [
      ...(flagTarget === undefined ? ['target'] : []),
      ...(flagAuthoring === undefined ? ['authoring'] : []),
    ].filter((flag) => REQUIRED_FLAG_PROMPTS.has(flag));
    throw errorInitMissingFlags({
      missing,
      why: 'This session cannot prompt, so the answers have to arrive as flags.',
    });
  }

  const schemaPath =
    flags.schemaPath !== undefined
      ? validateSchemaPath(flags.schemaPath, authoring)
      : await askSchemaPath(prompt, authoring);

  const replaced = generatedFilesInitReplaces(schemaPath).filter((relative) =>
    existsSync(join(cwd, relative)),
  );
  const reinit = replaced.length > 0;
  if (reinit) {
    const granted = await prompt.consent(consentQuestion(replaced), { token: consentToken(cwd) });
    if (!granted) {
      throw errorInitUserAborted();
    }
  }

  const writeEnv =
    flags.writeEnv ||
    (await prompt.confirm('Also write a .env file from .env.example? (gitignored)', {
      default: false,
    }));

  const removePreviousFacade = await resolveRemovePreviousFacade({
    cwd,
    target,
    reinit,
    keepPreviousFacade: flags.keepPreviousFacade,
    prompt,
  });

  return {
    target,
    authoring,
    schemaPath,
    install: !flags.skipInstall,
    writeEnv,
    probeDb: flags.probeDb,
    strictProbe: flags.strictProbe,
    reinit,
    removePreviousFacade,
  };
}
