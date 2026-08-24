import { ifDefined } from '@internal/utils/defined';
import { version as cliVersion } from '../../../package.json' with { type: 'json' };
import type { PackageManager } from './detect-package-manager';

/**
 * Default base for the GitHub-URL form `<owner>/<repo>` consumed by
 * upstream `skills add`. Each `SkillSource` joins this base with its
 * own subpath (and optional `#ref` for version-pinned clusters).
 */
export const DEFAULT_SKILL_BASE = 'prisma/prisma';

/**
 * One skill install inside the Prisma Next monorepo. The CLI emits
 * one `skills add <base>/<subpath>[#ref] --agent ... --skill <name> -y`
 * invocation per source during `init`. Every skill lives directly
 * under the `skills/` subpath; the explicit `--skill` name keeps a
 * pinned install from capturing sibling skills with a different ref
 * policy.
 *
 * `ref` semantics:
 * - `cli`: pin to the CLI's own package version (lockstep with the
 *   skills' SPI). Used for the consolidated usage skill
 *   (`skills/prisma-8`), which describes the public package API
 *   and is pinned to the version of `@internal/*` currently
 *   installed in the consumer's project.
 * - `null`: no ref. The skill is installed from whatever `main` holds.
 *   No source uses this today: upgrading is a branch of the `prisma-8`
 *   skill, which is version-pinned like the rest of it.
 */
export interface SkillSource {
  readonly subpath: string;
  readonly skill: string;
  readonly ref: 'cli' | null;
  readonly description: string;
}

export const DEFAULT_SKILL_SOURCES: readonly SkillSource[] = [
  {
    subpath: 'skills',
    skill: 'prisma-8',
    ref: 'cli',
    description: 'usage skill (version-locked to installed Prisma Next)',
  },
];

/**
 * Test-only escape hatch for pinning the install base to a local
 * checkout. Production runs leave this unset, so installs always use
 * `DEFAULT_SKILL_BASE`.
 *
 * When set to an absolute filesystem path (typical for tests), the
 * `#ref` fragment is dropped — local-path mode in upstream's CLI does
 * not accept refs, and the local clone has whatever content the test
 * checked into it anyway. When set to anything else (e.g. a fork name
 * `myuser/prisma`), the ref policy is preserved.
 */
function resolveAgentSkillBase(env: SkillInstallEnv): string {
  const override = env['PRISMA_NEXT_SKILLS_BASE']?.trim();
  return override && override.length > 0 ? override : DEFAULT_SKILL_BASE;
}

/**
 * The environment the base override is read from. The commander shell reads
 * `process.env`; the engine command reads `ctx.env`, which is the only
 * environment a handler is allowed to see.
 */
export type SkillInstallEnv = Readonly<Record<string, string | undefined>>;

function isLocalPath(base: string): boolean {
  return base.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(base);
}

/** Agent slugs accepted by the upstream `skills add --agent` flag. */
export type SkillAgent = 'cursor' | 'claude-code' | 'codex' | 'windsurf';

/**
 * Agents passed to every project-level init install. Upstream `skills add`
 * is the source of truth for per-agent install behaviour; the CLI lists
 * every supported runtime on one invocation and delegates the rest.
 */
export const DEFAULT_SKILL_AGENTS: readonly SkillAgent[] = [
  'cursor',
  'claude-code',
  'codex',
  'windsurf',
];

/**
 * Build the `<base>/<subpath>[#ref]` URL the `skills` CLI will
 * resolve. Exported for unit tests so the per-source format can be
 * asserted without going through the full install loop.
 */
export function formatSkillSourceUrl(
  source: SkillSource,
  env: SkillInstallEnv = process.env,
): string {
  const base = resolveAgentSkillBase(env);
  const url = `${base}/${source.subpath}`;
  if (source.ref === null) return url;
  if (isLocalPath(base)) return url;
  if (source.ref === 'cli') return `${url}#v${cliVersion}`;
  return url;
}

/**
 * The skill-install command for one source, formatted for the
 * project's detected package manager. `npx`/`pnpm dlx`/`bunx` are
 * interchangeable to the user; we pick the variant that matches the
 * rest of the install step so a single project consistently uses one
 * runner.
 *
 * `--agent` takes space-separated slugs on one flag; the explicit
 * `--skill <name>` and `-y` skip the multi-select prompts a
 * non-interactive scaffold step cannot show.
 *
 * Exported for unit tests so the per-PM dispatch can be asserted
 * without a live subprocess.
 */
export function formatSkillInstallCommand(args: {
  readonly pm: PackageManager;
  readonly source: SkillSource;
  readonly agents?: readonly SkillAgent[];
  /** The environment the base override is read from; the engine command has its own. */
  readonly env?: SkillInstallEnv;
}): string {
  const agents = args.agents ?? DEFAULT_SKILL_AGENTS;
  const cliArgs = [
    'skills@latest',
    'add',
    formatSkillSourceUrl(args.source, args.env),
    '--agent',
    ...agents,
    '--skill',
    args.source.skill,
    '-y',
  ];
  return formatPackageManagerCommand(args.pm, cliArgs);
}

/**
 * Ordered skill-install commands for one init run. This is both what the
 * commander shell runs and what either shell tells the user to run when the
 * install is skipped or fails — the commands need no scaffold and no `init`.
 */
export function resolveProjectSkillInstallCommands(
  pm: PackageManager,
  env?: SkillInstallEnv,
): readonly string[] {
  return DEFAULT_SKILL_SOURCES.map((source) =>
    formatSkillInstallCommand({ pm, source, ...ifDefined('env', env) }),
  );
}

function formatPackageManagerCommand(pm: PackageManager, args: readonly string[]): string {
  switch (pm) {
    case 'pnpm':
      return `pnpm dlx ${args.join(' ')}`;
    case 'yarn':
      return `yarn dlx ${args.join(' ')}`;
    case 'bun':
      return `bunx ${args.join(' ')}`;
    case 'deno':
      return `deno run -A npm:${args.join(' ')}`;
    case 'npm':
      return `npx ${args.join(' ')}`;
  }
}

// -------------------------------------------------------------------
// Legacy file cleanup
// -------------------------------------------------------------------

/**
 * Skill directories that predate the consolidated `prisma-8` skill:
 * the per-workflow usage cluster (including the renamed
 * `prisma-8-migration-review` spelling it briefly shipped under), the
 * pre-rename spellings of the consolidated skill and the
 * extension-author upgrade skill, any hand-rolled `prisma-next` stub,
 * and the two standalone upgrade skills that folded into the
 * `prisma-8` router. Projects initialised before the consolidation carry these as
 * sibling directories in each agent's install root; left in place
 * they compete with the current skills for activation, so init
 * removes them on every run.
 */
export const RETIRED_SKILL_NAMES = [
  'prisma-next',
  'prisma-next-quickstart',
  'prisma-next-contract',
  'prisma-next-migrations',
  'prisma-next-migration-review',
  'prisma-8-migration-review',
  'prisma-next-queries',
  'prisma-next-runtime',
  'prisma-next-build',
  'prisma-next-supabase',
  'prisma-next-debug',
  'prisma-next-feedback',
  'prisma-next-extension-upgrade',
  'prisma-next-upgrade',
  'prisma-8-extension-upgrade',
] as const;

/**
 * Project-level install roots the upstream `skills` CLI uses for the
 * agents in `DEFAULT_SKILL_AGENTS`: cursor and codex install into
 * `.agents/skills`, claude-code into `.claude/skills`, windsurf into
 * `.windsurf/skills`.
 */
export const AGENT_SKILL_ROOTS = ['.agents/skills', '.claude/skills', '.windsurf/skills'] as const;

/**
 * Every directory a retired per-workflow skill may occupy in a
 * consumer project. Init deletes each (recursively) before running the
 * skill install. Names that are also in `DEFAULT_SKILL_SOURCES` are
 * excluded so a list mistake can never delete a skill init installs
 * (or one `--skip-skills` preserves) — see TML-2637.
 */
export function legacySkillDirs(
  retired: readonly string[] = RETIRED_SKILL_NAMES,
  sources: readonly SkillSource[] = DEFAULT_SKILL_SOURCES,
): readonly string[] {
  const installed = new Set<string>(sources.map((source) => source.skill));
  return AGENT_SKILL_ROOTS.flatMap((root) =>
    retired.filter((name) => !installed.has(name)).map((name) => `${root}/${name}`),
  );
}
