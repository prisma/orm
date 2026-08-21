import type { PackageManager } from './detect-package-manager';

/**
 * The agent skills ship inside the packages they describe — the `prisma-8`
 * skill travels in the `@prisma/orm-*` tarball a project installs — so init
 * no longer fetches them from anywhere. `prisma skills sync` copies them out
 * of the installed packages into the agent harnesses' skill directories, and
 * the `postinstall` script init writes re-runs it on every later install.
 *
 * The package driven here is `prisma`, the same specifier init adds as a
 * development dependency: it is the package that carries the `prisma` binary
 * the postinstall script and every piece of advice below name.
 */
export const SKILLS_SYNC_PACKAGE = 'prisma@next';

export const SKILLS_SYNC_ARGS: readonly string[] = ['skills', 'sync'];

/**
 * The sync invocation as the user would type it, for the advice init prints
 * when it skips the sync or the sync fails. This runs the `prisma` binary the
 * project already has as a development dependency rather than fetching a
 * fresh copy: the installed one is the version the project pinned, and it
 * needs no network. Deno has no local-bin runner, so it names the package.
 */
export function formatSkillSyncCommand(pm: PackageManager): string {
  const command = ['prisma', ...SKILLS_SYNC_ARGS].join(' ');
  switch (pm) {
    case 'pnpm':
      return `pnpm exec ${command}`;
    case 'yarn':
      return `yarn exec ${command}`;
    case 'bun':
      return `bun run ${command}`;
    case 'deno':
      return `deno run -A npm:${command}`;
    case 'npm':
      return `npm exec ${command}`;
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
