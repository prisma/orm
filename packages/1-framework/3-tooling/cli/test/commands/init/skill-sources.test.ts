import { expectDefined } from '@repo/test-utils/typed-expectations';
import { describe, expect, it } from 'vitest';
import {
  AGENT_SKILL_ROOTS,
  DEFAULT_SKILL_SOURCES,
  legacySkillDirs,
  RETIRED_SKILL_NAMES,
} from '../../../src/commands/init/skill-sources';

describe('skill sources', () => {
  it('never retires a skill name it currently installs', () => {
    const installed = new Set<string>(DEFAULT_SKILL_SOURCES.map((source) => source.skill));
    const overlap = RETIRED_SKILL_NAMES.filter((name) => installed.has(name));

    expect(
      overlap,
      'a name in both lists would mark a skill init installs for deletion (TML-2637)',
    ).toEqual([]);
  });

  it('legacySkillDirs excludes a retired name that is also installed, under every root', () => {
    const [installed] = DEFAULT_SKILL_SOURCES;
    expectDefined(installed);

    const dirs = legacySkillDirs([installed.skill, 'prisma-next-queries'], DEFAULT_SKILL_SOURCES);

    expect(dirs).toEqual(AGENT_SKILL_ROOTS.map((root) => `${root}/prisma-next-queries`));
  });
});
