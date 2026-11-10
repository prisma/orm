import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
} as const;

function detection(audience: keyof typeof GUIDE_PATHS): readonly RegExp[] {
  return detectionPatterns(GUIDE_PATHS[audience], 'collections-on-the-client');
}

describe.each(['app', 'extension'] as const)('the %s detection', (audience) => {
  const detects = (content: string) => detection(audience).some((pattern) => pattern.test(content));

  it.each([
    ['a one-line call', 'orm({ runtime, context, collections: { Post: PostCollection } })'],
    [
      'a multi-line call',
      'return orm({\n  runtime,\n  context,\n  collections: {\n    User: UserCollection,\n  },\n}).public;',
    ],
    ['a call with type arguments', 'orm<Contract, Classes>({ runtime, context, collections })'],
    [
      'an inline runtime object with method bodies',
      'orm({ runtime: { query(plan) { return r.query(plan); } }, context, collections })',
    ],
    [
      'an aliased import',
      "import { orm as createOrm } from './orm-client';\n\nexport const db = createOrm({ runtime, context, collections: { Post: PostCollection } });",
    ],
    [
      'an aliased import after other imports, with a nested type argument',
      "import { a } from './a';\nimport { orm as createOrm } from './orm-client';\n\nexport const db = createOrm<Classes<Contract>>({ runtime, context, collections });",
    ],
  ])('finds %s', (_name, content) => {
    expect(detects(content)).toBe(true);
  });

  it.each([
    [
      'a method definition named orm',
      'class Facade {\n  orm({ collections }) {\n    return collections;\n  }\n}',
    ],
    [
      "another library's orm function",
      "import { orm } from 'some-other-library';\n\norm({ collections });",
    ],
  ])('finds %s, which the agent inspects and skips', (_name, content) => {
    expect(detects(content)).toBe(true);
  });

  it.each([
    ['the client option', 'postgres({ contract, url, collections: { Post: PostCollection } })'],
    ['an ORM without classes', 'orm({ runtime, context })'],
    ['another function', 'mongoOrm({ contract, collections })'],
    ['a method of the same name', 'factory.orm({ runtime, context, collections })'],
    [
      'an aliased import without classes',
      "import { orm as createOrm } from './orm-client';\n\nexport const db = createOrm({ runtime, context });",
    ],
  ])('skips %s', (_name, content) => {
    expect(detects(content)).toBe(false);
  });

  it.each([
    ['renamed imports', "import { orm as o } from './orm';\n"],
    ['unclosed import lists', "import { orm as o from './orm';\n"],
    ['type arguments that never close', 'orm<<<<<<<<<<<<<<<<>'],
  ])('reads 400 KB of repeated %s in linear time', (_name, line) => {
    const content = line.repeat(Math.ceil(400_000 / line.length));
    const start = performance.now();
    const found = detects(content);
    expect({ found, fast: performance.now() - start < 1000 }).toEqual({ found: false, fast: true });
  });
});
