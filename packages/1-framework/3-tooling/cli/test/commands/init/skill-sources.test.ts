import { describe, expect, it } from 'vitest';
import {
  AGENT_SKILL_ROOTS,
  formatSkillSyncCommand,
  legacySkillDirs,
  RETIRED_SKILL_NAMES,
  SKILLS_SYNC_ARGS,
  SKILLS_SYNC_PACKAGE,
} from '../../../src/commands/init/skill-sources';

describe('the skills sync invocation', () => {
  it('drives the unified CLI, which carries the sync command', () => {
    expect(SKILLS_SYNC_PACKAGE).toBe('@prisma/cli@next');
    expect(SKILLS_SYNC_ARGS).toEqual(['skills', 'sync']);
  });

  it('spells the runner the way each package manager does', () => {
    expect(formatSkillSyncCommand('pnpm')).toBe('pnpm dlx @prisma/cli@next skills sync');
    expect(formatSkillSyncCommand('npm')).toBe('npx @prisma/cli@next skills sync');
    expect(formatSkillSyncCommand('yarn')).toBe('yarn dlx @prisma/cli@next skills sync');
    expect(formatSkillSyncCommand('bun')).toBe('bunx @prisma/cli@next skills sync');
    expect(formatSkillSyncCommand('deno')).toBe('deno run -A npm:@prisma/cli@next skills sync');
  });
});

describe('legacy skill cleanup', () => {
  it('covers every harness directory sync writes into', () => {
    expect(AGENT_SKILL_ROOTS).toEqual([
      '.claude/skills',
      '.cursor/skills',
      '.agents/skills',
      '.windsurf/skills',
    ]);
  });

  it('retires the two standalone upgrade skills that folded into the router', () => {
    expect(RETIRED_SKILL_NAMES).toContain('prisma-next-upgrade');
    expect(RETIRED_SKILL_NAMES).toContain('prisma-8-extension-upgrade');
  });

  it('names one directory per harness root and retired skill', () => {
    const dirs = legacySkillDirs();
    expect(dirs).toHaveLength(AGENT_SKILL_ROOTS.length * RETIRED_SKILL_NAMES.length);
    expect(dirs).toContain('.cursor/skills/prisma-next-upgrade');
    expect(dirs).not.toContain('.claude/skills/prisma-8');
  });
});
