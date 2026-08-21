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
  it('drives the package that carries the prisma bin', () => {
    expect(SKILLS_SYNC_PACKAGE).toBe('prisma@next');
    expect(SKILLS_SYNC_ARGS).toEqual(['skills', 'sync']);
  });

  it('advises the copy the project already installed, never a fresh one', () => {
    expect(formatSkillSyncCommand('pnpm')).toBe('pnpm exec prisma skills sync');
    expect(formatSkillSyncCommand('npm')).toBe('npm exec prisma skills sync');
    expect(formatSkillSyncCommand('yarn')).toBe('yarn exec prisma skills sync');
    expect(formatSkillSyncCommand('bun')).toBe('bun run prisma skills sync');
    expect(formatSkillSyncCommand('deno')).toBe('deno run -A npm:prisma skills sync');
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
