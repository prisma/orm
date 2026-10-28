import { describe, expect, it } from 'vitest';
import { detectionPatterns, guideChanges } from '../guide-detections';

const APP_GUIDE =
  'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md';

const GUIDES = [
  APP_GUIDE,
  'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
  'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.19-to-8.0.0-rc.20/instructions.md',
  'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.19-to-8.0.0-rc.20/instructions.md',
  'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.20-to-8.0.0-rc.21/instructions.md',
  'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.20-to-8.0.0-rc.21/instructions.md',
];

function detects(id: string, content: string): boolean {
  return detectionPatterns(APP_GUIDE, id).some((pattern) => pattern.test(content));
}

const allPatterns = GUIDES.flatMap((guide) =>
  guideChanges(guide).flatMap((change) =>
    (change.detection?.matches ?? []).map((pattern) => ({ guide, id: change.id, pattern })),
  ),
);

describe('the detection patterns of the rc.18 to rc.21 guides', () => {
  it('include patterns from every guide', () => {
    expect(new Set(allPatterns.map(({ guide }) => guide))).toEqual(new Set(GUIDES));
  });

  it('start a whole-file pattern at the start of the file, not with ^, which rg -U reads as any line start', () => {
    expect(allPatterns.filter(({ pattern }) => pattern.startsWith('^'))).toEqual([]);
  });
});

describe('prisma7-lists-allow-null-elements detection', () => {
  const prisma7 = (body: string) =>
    `generator client {\n  provider = "prisma-client"\n}\n\n${body}`;

  it.each([
    ['a scalar list', prisma7('model Post {\n  id   Int      @id\n  tags String[]\n}')],
    [
      'a list of an enum declared before it',
      prisma7('enum Role {\n  A\n}\n\nmodel User {\n  id    Int    @id\n  roles Role[]\n}'),
    ],
    [
      'a list of an enum declared after it',
      prisma7('model User {\n  id    Int    @id\n  roles Role[]\n}\n\nenum Role {\n  A\n}'),
    ],
  ])('finds %s in a Prisma 7 schema', (_name, content) => {
    expect(detects('prisma7-lists-allow-null-elements', content)).toBe(true);
  });

  it.each([
    [
      'a Prisma 8 schema',
      '// use prisma-8\n\nmodel Post {\n  id   Int      @id\n  tags String[]\n}',
    ],
    [
      'a Prisma 8 schema after blank lines',
      '\n\n// use prisma-8\nenum Role {\n  A\n}\nmodel User {\n  roles Role[]\n}',
    ],
    [
      'a relation list in a schema with no enum',
      prisma7('model User {\n  id    Int    @id\n  posts Post[]\n}'),
    ],
    [
      'a schema with no list',
      prisma7('enum Role {\n  A\n}\n\nmodel User {\n  id   Int  @id\n  role Role\n}'),
    ],
  ])('skips %s', (_name, content) => {
    expect(detects('prisma7-lists-allow-null-elements', content)).toBe(false);
  });
});

describe('value-object-enum-fields-narrow detection', () => {
  it.each([
    [
      'an enum before a composite type',
      '// use prisma-8\nenum Kind {\n  A\n}\n\ntype Address {\n  kind Kind\n}\n',
    ],
    [
      'an enum after a composite type',
      '// use prisma-8\ntype Address {\n  kind Kind\n}\n\nenum Kind {\n  A\n}\n',
    ],
  ])('finds %s', (_name, content) => {
    expect(detects('value-object-enum-fields-narrow', content)).toBe(true);
  });

  it.each([
    [
      'a schema with an enum and no composite type',
      '// use prisma-8\nenum Kind {\n  A\n}\n\nmodel M {\n  id   String @id @map("_id")\n  kind Kind\n}\n',
    ],
    [
      'a schema with a composite type and no enum',
      '// use prisma-8\ntype Address {\n  city String\n}\n',
    ],
    [
      'a TypeScript type alias next to an enum',
      'enum Kind {\n  A,\n}\ntype Address = {\n  kind: Kind;\n};\n',
    ],
  ])('skips %s', (_name, content) => {
    expect(detects('value-object-enum-fields-narrow', content)).toBe(false);
  });
});

describe('mongo-update-accessors-take-input-types detection', () => {
  it.each([
    ['a push', "await db.orm.users.where({ id }).update((u) => [u.tags.push('a')]);"],
    ['a set on a nested field', "await users.update(u => [u.profile.name.set('Ada')]);"],
    ['a field named by a string', "await users.update((u) => [u('visits').inc(1)]);"],
    [
      'the second accessor of a list',
      "await users.update((u) => [u.name.set('x'), u.tags.push('y')]);",
    ],
  ])('finds %s', (_name, content) => {
    expect(detects('mongo-update-accessors-take-input-types', content)).toBe(true);
  });

  it.each([
    ['an array built by map', 'const pairs = items.map((item) => [item.a, item.b]);'],
    [
      'a set built after the array',
      'const ids = rows.map((r) => [r.id]);\nconst seen = new Set(ids);\nseen.add(1);',
    ],
    ['another name pushed', 'const make = (u) => [u.id];\nlist.push(make(user));'],
  ])('skips %s', (_name, content) => {
    expect(detects('mongo-update-accessors-take-input-types', content)).toBe(false);
  });
});
