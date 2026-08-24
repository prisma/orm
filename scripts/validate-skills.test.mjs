import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  MAX_DESCRIPTION_LENGTH,
  runCheck,
  SKILL_ROOTS,
  validateSkillMd,
} from './validate-skills.mjs';

const validSkill = `---
name: example-skill
description: >
  A short description that is safe for YAML and long enough to be meaningful
  without bare colons on the same line as mapping keys.
---

# Example
`;

describe('validateSkillMd', () => {
  it('passes valid frontmatter', () => {
    deepStrictEqual(validateSkillMd(validSkill), []);
  });

  it('passes a metadata map of strings', () => {
    const stamped = `---
name: prisma-8
description: A skill.
metadata:
  library: '@prisma/orm-postgres'
  library_version: '8.0.0-rc.4'
---

# Prisma 8
`;
    deepStrictEqual(validateSkillMd(stamped), []);
  });

  it('fails when a metadata value is not a string', () => {
    const numeric = `---
name: prisma-8
description: A skill.
metadata:
  library_version: 8.1
---

# Prisma 8
`;
    const errors = validateSkillMd(numeric);
    strictEqual(errors.length, 1);
    strictEqual(errors[0].includes('library_version'), true);
  });

  it('fails when metadata is not a map', () => {
    const scalar = `---
name: prisma-8
description: A skill.
metadata: nope
---

# Prisma 8
`;
    strictEqual(validateSkillMd(scalar).length, 1);
  });

  it('fails when metadata is an unquoted timestamp', () => {
    const dated = `---
name: prisma-8
description: A skill.
metadata: 2026-08-21
---

# Prisma 8
`;
    strictEqual(validateSkillMd(dated).length, 1);
  });

  it('fails when bare colons break YAML parsing', () => {
    const broken = `---
name: drive-discussion
description: Invoke when resolution: before/inside drive-specify-project (pre-spec).
---

# Discussion
`;
    const errors = validateSkillMd(broken);
    strictEqual(errors.length, 1);
    strictEqual(errors[0].startsWith('frontmatter parse error:'), true);
  });

  it('fails when description exceeds the agentskills limit', () => {
    const longDescription = 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1);
    const content = `---
name: long-desc
description: ${longDescription}
---

# Long
`;
    const errors = validateSkillMd(content);
    deepStrictEqual(errors, [
      `description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${MAX_DESCRIPTION_LENGTH + 1}); use a folded block scalar (description: >) or shorten the text`,
    ]);
  });

  it('fails when frontmatter is missing', () => {
    deepStrictEqual(validateSkillMd('# No frontmatter\n'), ['missing frontmatter block']);
  });

  it('fails when an unquoted description contains a bare "key: value" sequence', () => {
    // Mirrors the PR #987 regression: an unquoted plain scalar describing
    // `extensions: [supabasePack]` reads as a nested YAML mapping, not text.
    const broken = `---
name: prisma-next-supabase
description: Use Prisma Next with Supabase — wire extensions: [supabasePack] into your db.
---

# Supabase
`;
    const errors = validateSkillMd(broken);
    strictEqual(errors.length, 1);
    strictEqual(errors[0].startsWith('frontmatter parse error:'), true);
  });
});

describe('runCheck', () => {
  it('validates every skill under a skills directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'validate-skills-'));
    const skillDir = join(root, 'skills-contrib', 'good-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), validSkill.replace('example-skill', 'good-skill'));

    deepStrictEqual(runCheck({ root }), []);
  });

  it('reports offences for broken skills in a directory tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'validate-skills-bad-'));
    const skillDir = join(root, 'skills-contrib', 'bad-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: bad-skill
description: broken yaml: this colon breaks parsing
---

# Bad
`,
    );

    const offences = runCheck({ root });
    strictEqual(offences.length, 1);
    strictEqual(offences[0].file, 'skills-contrib/bad-skill/SKILL.md');
    strictEqual(offences[0].errors[0].startsWith('frontmatter parse error:'), true);
  });

  it('scans the user-facing skills/ root, not just skills-contrib', () => {
    const root = mkdtempSync(join(tmpdir(), 'validate-skills-userfacing-'));
    const skillDir = join(root, 'skills', 'prisma-8-example');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: prisma-8-example
description: Wire this skill with adapterPacks: [examplePack] for the example target.
---

# Example
`,
    );

    const offences = runCheck({ root });
    strictEqual(offences.length, 1);
    strictEqual(offences[0].file, 'skills/prisma-8-example/SKILL.md');
    strictEqual(offences[0].errors[0].startsWith('frontmatter parse error:'), true);
  });

  it('scans every skill directory under the skills/ root', () => {
    const root = mkdtempSync(join(tmpdir(), 'validate-skills-nested-'));
    for (const name of ['prisma-8', 'prisma-8-example']) {
      const skillDir = join(root, 'skills', name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), validSkill.replace('example-skill', name));
    }

    deepStrictEqual(runCheck({ root }), []);
  });
});

describe('SKILL_ROOTS', () => {
  it('covers skills-contrib plus the consolidated skills/ root prisma orm init installs from', () => {
    deepStrictEqual(SKILL_ROOTS, ['skills-contrib', 'skills']);
  });
});
