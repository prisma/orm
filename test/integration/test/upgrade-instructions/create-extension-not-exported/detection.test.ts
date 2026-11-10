import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const DETECTIONS = [
  {
    guide: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.21-to-8.0.0-rc.22/instructions.md',
    id: 'free-create-extension',
    module: '@prisma/orm-postgres/migration',
  },
  {
    guide:
      'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.21-to-8.0.0-rc.22/instructions.md',
    id: 'free-create-extension',
    module: '@internal/target-postgres/migration',
  },
  {
    guide: 'upgrade-instructions/pending/create-extension-not-exported/app/instructions.md',
    id: 'create-extension-not-exported',
    module: '@prisma/orm-postgres/migration',
  },
  {
    guide: 'upgrade-instructions/pending/create-extension-not-exported/extension/instructions.md',
    id: 'create-extension-not-exported',
    module: '@internal/target-postgres/migration',
  },
] as const;

describe.each(DETECTIONS)('$id detection in $guide', ({ guide, id, module }) => {
  const matches = (content: string) =>
    detectionPatterns(guide, id).some((pattern) => pattern.test(content));

  it('matches a migration.ts that calls the free createExtension', () => {
    expect([
      matches(
        `import { createExtension, Migration } from '${module}';\nreturn [createExtension('btree_gist')];`,
      ),
      matches('return [\n  createExtension("citext"),\n];'),
    ]).toEqual([true, true]);
  });

  it('skips a migration.ts that calls the method', () => {
    expect(
      matches(
        `import { Migration } from '${module}';\nreturn [this.createExtension({ extension: 'btree_gist' })];`,
      ),
    ).toBe(false);
  });
});

describe('create-extension-not-exported detection', () => {
  it('matches an import of createExtension that is never called', () => {
    const guide = 'upgrade-instructions/pending/create-extension-not-exported/app/instructions.md';
    const matches = (content: string) =>
      detectionPatterns(guide, 'create-extension-not-exported').some((pattern) =>
        pattern.test(content),
      );
    expect(
      matches(
        "import {\n  createExtension,\n  Migration,\n} from '@prisma/orm-postgres/migration';",
      ),
    ).toBe(true);
  });
});
