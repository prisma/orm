// The agent skills ship inside the packages they describe — the `prisma-8`
// skill travels in the `@prisma/orm-*` tarball a project installs — so init
// no longer fetches or installs them from anywhere. Skills setup belongs to
// the family-level `prisma init` command; the only skill work left in
// `orm init` is deleting the retired directories below.

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
 * The project-level skill directories the agent harnesses read: Claude Code,
 * Cursor, Codex (`.agents`), and Windsurf.
 */
export const AGENT_SKILL_ROOTS = [
  '.claude/skills',
  '.cursor/skills',
  '.agents/skills',
  '.windsurf/skills',
] as const;

/**
 * Every directory a retired skill may occupy in a consumer project. Init
 * deletes each (recursively) on every run.
 */
export function legacySkillDirs(): readonly string[] {
  return AGENT_SKILL_ROOTS.flatMap((root) => RETIRED_SKILL_NAMES.map((name) => `${root}/${name}`));
}
