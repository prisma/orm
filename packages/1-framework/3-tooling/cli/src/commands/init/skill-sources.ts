import type { PackageManager } from './detect-package-manager';

/**
 * The agent skills ship inside the packages they describe — the `prisma-8`
 * skill travels in the `@prisma/orm-*` tarball a project installs — so init
 * no longer fetches them from anywhere. `prisma skills sync` copies them out
 * of the installed packages into the agent harnesses' skill directories, and
 * the `postinstall` script init writes re-runs it on every later install.
 *
 * The package driven here is the unified CLI at the same specifier init adds
 * as a development dependency, so the sync runs at the version the project
 * just pinned.
 */
export const SKILLS_SYNC_PACKAGE = '@prisma/cli@next';

export const SKILLS_SYNC_ARGS: readonly string[] = ['skills', 'sync'];

/**
 * The sync invocation as the user would type it, for the advice init prints
 * when it skips the sync or the sync fails. `npx`/`pnpm dlx`/`bunx` are
 * interchangeable to the user; we pick the variant that matches the rest of
 * the install step so a project consistently uses one runner.
 */
export function formatSkillSyncCommand(pm: PackageManager): string {
  const args = [SKILLS_SYNC_PACKAGE, ...SKILLS_SYNC_ARGS];
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
 * Skill directories that predate the consolidated `prisma-8` skill: the
 * per-workflow usage cluster (including the renamed
 * `prisma-8-migration-review` spelling it briefly shipped under), the
 * pre-rename spellings of the consolidated skill and the extension-author
 * upgrade skill, any hand-rolled `prisma-next` stub, and the two standalone
 * upgrade skills that folded into the `prisma-8` router. Projects initialised
 * before those changes carry these as sibling directories in each agent's
 * install root; left in place they compete with the current skill for
 * activation, so init removes them on every run.
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
 * The project-level skill directories the agent harnesses read, and the ones
 * `prisma skills sync` writes into: Claude Code, Cursor, Codex (`.agents`),
 * and Windsurf.
 */
export const AGENT_SKILL_ROOTS = [
  '.claude/skills',
  '.cursor/skills',
  '.agents/skills',
  '.windsurf/skills',
] as const;

/**
 * Every directory a retired skill may occupy in a consumer project. Init
 * deletes each (recursively) before running the sync.
 */
export function legacySkillDirs(): readonly string[] {
  return AGENT_SKILL_ROOTS.flatMap((root) => RETIRED_SKILL_NAMES.map((name) => `${root}/${name}`));
}
