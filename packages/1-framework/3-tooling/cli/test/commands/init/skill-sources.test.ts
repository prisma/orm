import { describe, expect, it } from 'vitest';
import {
  AGENT_SKILL_ROOTS,
  legacySkillDirs,
  RETIRED_SKILL_NAMES,
} from '../../../src/commands/init/skill-sources';

describe('legacy skill cleanup', () => {
  it('covers every harness directory the agents read', () => {
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
