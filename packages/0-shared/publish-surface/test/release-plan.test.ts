import { describe, expect, it } from 'vitest';
import {
  type DeclaredLevel,
  formatVersion,
  type PackageKind,
  parseVersion,
  planRelease,
  type ReleasePlanInput,
} from '../src/release-plan';

/**
 * A small graph with every shape the plan distinguishes: platform packages, a GA facade and a GA
 * extension on them, a Preview facade, an Early Access facade on its own Early Access target, a
 * second Early Access facade built on the first, a Preview extension naming the GA facade, and a
 * package numbered on its own.
 */
const graph: Record<string, { level: DeclaredLevel; kind: PackageKind; uses: string[] }> = {
  framework: { level: 'ga', kind: 'platform', uses: [] },
  family: { level: 'ga', kind: 'platform', uses: ['framework'] },
  target: { level: 'ga', kind: 'platform', uses: ['family', 'framework'] },
  postgres: { level: 'ga', kind: 'facade', uses: ['family', 'framework', 'target'] },
  pgvector: { level: 'ga', kind: 'extension', uses: ['framework', 'target'] },
  mongo: { level: 'preview', kind: 'facade', uses: ['framework'] },
  'target-mysql': { level: 'ea', kind: 'platform', uses: ['framework'] },
  mysql: { level: 'ea', kind: 'facade', uses: ['framework', 'target-mysql'] },
  mariadb: { level: 'ea', kind: 'facade', uses: ['mysql', 'target-mysql'] },
  supabase: { level: 'preview', kind: 'extension', uses: ['postgres'] },
  'better-auth': { level: 'preview', kind: 'library-integration', uses: ['framework'] },
  paradedb: { level: { ownVersion: '0.1.0' }, kind: 'extension', uses: ['framework'] },
};

const AT_8_1 = {
  framework: '8.1.0',
  family: '8.1.0',
  target: '8.1.0',
  postgres: '8.1.0',
  pgvector: '8.1.0',
  mongo: '8.1.0-preview.0',
  'target-mysql': '8.1.0-ea.0',
  mysql: '8.1.0-ea.0',
  mariadb: '8.1.0-ea.0',
  supabase: '8.1.0-preview.0',
  'better-auth': '8.1.0-preview.0',
  paradedb: '0.1.0',
};

const GA = new Set(['framework', 'family', 'target', 'postgres', 'pgvector']);

function input(
  overrides: Partial<ReleasePlanInput> & { levelChanges?: Record<string, DeclaredLevel> },
): ReleasePlanInput {
  const { levelChanges = {}, ...rest } = overrides;
  return {
    release: { major: 8, minor: 1 },
    line: 'levels',
    rcCounter: undefined,
    current: AT_8_1,
    levels: new Map(
      Object.entries(graph).map(([name, entry]) => [name, levelChanges[name] ?? entry.level]),
    ),
    kinds: Object.fromEntries(Object.entries(graph).map(([name, entry]) => [name, entry.kind])),
    uses: Object.fromEntries(Object.entries(graph).map(([name, entry]) => [name, entry.uses])),
    everGa: GA,
    bump: [],
    dev: undefined,
    ...rest,
  };
}

/** One package's line of a plan: version, tag, and each range, in the order the package names them. */
function line(plan: ReturnType<typeof planRelease>, name: string): string {
  const planned = plan[name];
  if (planned === undefined) throw new Error(`no plan for ${name}`);
  const ranges = Object.entries(planned.ranges).map(([named, range]) => `${named} ${range}`);
  return [planned.version, planned.tag, ...ranges].join(' ');
}

describe('parseVersion', () => {
  it.each([
    ['8.1.0', { major: 8, minor: 1, patch: 0, level: undefined, dev: undefined }],
    [
      '8.0.0-rc.26',
      { major: 8, minor: 0, patch: 0, level: { name: 'rc', counter: 26 }, dev: undefined },
    ],
    [
      '8.1.0-preview.3',
      { major: 8, minor: 1, patch: 0, level: { name: 'preview', counter: 3 }, dev: undefined },
    ],
    [
      '8.1.0-ea.0-dev.4',
      { major: 8, minor: 1, patch: 0, level: { name: 'ea', counter: 0 }, dev: 4 },
    ],
    [
      '8.0.0-rc.26-dev.2',
      { major: 8, minor: 0, patch: 0, level: { name: 'rc', counter: 26 }, dev: 2 },
    ],
    ['8.1.2-dev.7', { major: 8, minor: 1, patch: 2, level: undefined, dev: 7 }],
  ])('reads %s', (text, parsed) => {
    expect(parseVersion(text)).toEqual(parsed);
    expect(formatVersion(parseVersion(text))).toBe(text);
  });

  it.each([
    '8.1',
    '8.1.0-beta.1',
    '8.1.0-rc',
    'v8.1.0',
    '8.1.0-dev.x',
    '08.1.0',
    '8.1.0-preview.01',
  ])('refuses %s, naming it', (text) => {
    expect(() => parseVersion(text)).toThrow(`"${text}"`);
  });
});

describe('planRelease', () => {
  it('fixes one GA package within 8.1: its patch moves, nothing else does', () => {
    const plan = planRelease(input({ bump: ['framework'] }));

    expect({
      framework: line(plan, 'framework'),
      family: line(plan, 'family'),
      pgvector: line(plan, 'pgvector'),
      mongo: line(plan, 'mongo'),
    }).toEqual({
      framework: '8.1.1 latest',
      family: '8.1.0 latest framework ~8.1.0',
      pgvector: '8.1.0 latest framework ^8.1.0 target ^8.1.0',
      mongo: '8.1.0-preview.0 latest framework ~8.1.0',
    });
  });

  it('fixes one package below GA within 8.1: its counter moves', () => {
    const plan = planRelease(input({ bump: ['mysql'] }));

    expect({ mysql: line(plan, 'mysql'), mariadb: line(plan, 'mariadb') }).toEqual({
      mysql: '8.1.0-ea.1 latest framework ~8.1.0 target-mysql ~8.1.0-ea.0',
      mariadb: '8.1.0-ea.0 latest mysql ~8.1.0-ea.0 target-mysql ~8.1.0-ea.0',
    });
  });

  it('tags a release below GA with its level when the package has had a GA release', () => {
    const plan = planRelease(input({ bump: ['mysql'], everGa: new Set([...GA, 'mysql']) }));

    expect(line(plan, 'mysql')).toBe('8.1.0-ea.1 ea framework ~8.1.0 target-mysql ~8.1.0-ea.0');
  });

  it('makes a package that was Preview at 8.1 GA at 8.2', () => {
    const plan = planRelease(
      input({ release: { major: 8, minor: 2 }, levelChanges: { mongo: 'ga' } }),
    );

    expect({
      mongo: line(plan, 'mongo'),
      framework: line(plan, 'framework'),
      mysql: line(plan, 'mysql'),
      supabase: line(plan, 'supabase'),
      paradedb: line(plan, 'paradedb'),
    }).toEqual({
      mongo: '8.2.0 latest framework ~8.2.0',
      framework: '8.2.0 latest',
      mysql: '8.2.0-ea.0 latest framework ~8.2.0 target-mysql ~8.2.0-ea.0',
      supabase: '8.2.0-preview.0 latest postgres ^8.2.0',
      paradedb: '0.1.0 latest framework ^8.2.0',
    });
  });

  it.each([
    ['a package below GA naming a GA one: a tilde on the minor', 'mysql', 'framework ~8.1.0'],
    ['an extension below GA: a caret', 'supabase', 'postgres ^8.1.0'],
    [
      'an Early Access facade naming an Early Access one: a tilde on its first version',
      'mariadb',
      'mysql ~8.1.0-ea.0',
    ],
    ['a library integration: a caret', 'better-auth', 'framework ^8.1.0'],
    [
      'a package numbered on its own: a caret, its version untouched',
      'paradedb',
      '0.1.0 latest framework ^8.1.0',
    ],
  ])('writes for %s', (_case, name, expected) => {
    expect(line(planRelease(input({})), name)).toContain(expected);
  });

  it('gives what is published today on the 8.0.0 release candidates, own-version package included', () => {
    const plan = planRelease(
      input({
        release: { major: 8, minor: 0 },
        line: 'release-candidates',
        rcCounter: 26,
        current: Object.fromEntries(Object.keys(graph).map((name) => [name, '8.0.0-rc.25'])),
        everGa: new Set(),
      }),
    );

    expect({
      paradedb: line(plan, 'paradedb'),
      mariadb: line(plan, 'mariadb'),
      supabase: line(plan, 'supabase'),
    }).toEqual({
      paradedb: '8.0.0-rc.26 latest framework 8.0.0-rc.26',
      mariadb: '8.0.0-rc.26 latest mysql 8.0.0-rc.26 target-mysql 8.0.0-rc.26',
      supabase: '8.0.0-rc.26 latest postgres 8.0.0-rc.26',
    });
  });

  describe('a development build', () => {
    it.each([
      [
        'on the release candidates',
        {
          release: { major: 8, minor: 0 },
          line: 'release-candidates' as const,
          rcCounter: 26,
          current: Object.fromEntries(Object.keys(graph).map((name) => [name, '8.0.0-rc.26'])),
          everGa: new Set<string>(),
        },
        {
          mariadb: '8.0.0-rc.26-dev.4 dev mysql 8.0.0-rc.26-dev.4 target-mysql 8.0.0-rc.26-dev.4',
          paradedb: '8.0.0-rc.26-dev.4 dev framework 8.0.0-rc.26-dev.4',
        },
      ],
      [
        'at 8.1',
        {},
        {
          mariadb: '8.1.0-ea.0-dev.4 dev mysql 8.1.0-ea.0-dev.4 target-mysql 8.1.0-ea.0-dev.4',
          paradedb: '0.1.0-dev.4 dev framework 8.1.0-dev.4',
        },
      ],
      [
        'of a fix to one GA package',
        { bump: ['framework'] },
        {
          mariadb: '8.1.0-ea.0-dev.4 dev mysql 8.1.0-ea.0-dev.4 target-mysql 8.1.0-ea.0-dev.4',
          paradedb: '0.1.0-dev.4 dev framework 8.1.1-dev.4',
        },
      ],
    ])(
      '%s appends -dev.N, names each package at that exact version, and tags dev',
      (_case, overrides, expected) => {
        const plan = planRelease(input({ ...overrides, dev: 4 }));

        expect({ mariadb: line(plan, 'mariadb'), paradedb: line(plan, 'paradedb') }).toEqual(
          expected,
        );
      },
    );
  });

  it('moves a GA package below GA at a new major', () => {
    const plan = planRelease(
      input({
        release: { major: 9, minor: 0 },
        levelChanges: Object.fromEntries(
          Object.entries(graph)
            .filter(([, entry]) => typeof entry.level === 'string')
            .map(([name]) => [name, 'rc']),
        ),
      }),
    );

    expect({ framework: line(plan, 'framework'), mongo: line(plan, 'mongo') }).toEqual({
      framework: '9.0.0-rc.0 rc',
      mongo: '9.0.0-rc.0 latest framework ~9.0.0-rc.0',
    });
  });

  describe('refuses', () => {
    it.each([
      [
        'a package naming one of ours at a lower level',
        input({
          levelChanges: { postgres: 'ga', target: 'preview', family: 'preview', framework: 'ga' },
          current: { ...AT_8_1, target: '8.1.0-preview.0', family: '8.1.0-preview.0' },
        }),
        'family (preview)',
      ],
      [
        'a version with an unknown suffix',
        input({ current: { ...AT_8_1, mongo: '8.1.0-beta.1' } }),
        'mongo: "8.1.0-beta.1"',
      ],
      ['a level changing within a minor', input({ levelChanges: { mongo: 'ea' } }), 'mongo'],
      [
        'a release older than the current version',
        input({ release: { major: 8, minor: 0 } }),
        'framework',
      ],
      [
        'a development build as the current version',
        input({ current: { ...AT_8_1, mongo: '8.1.0-preview.0-dev.3' } }),
        'mongo: "8.1.0-preview.0-dev.3"',
      ],
      [
        'a package that names an own-version one',
        input({ uses: { ...input({}).uses, framework: ['paradedb'] } }),
        'paradedb',
      ],
      ['a bump of an unknown package', input({ bump: ['nope'] }), 'nope'],
      ['a package with no level', input({ current: { ...AT_8_1, extra: '8.1.0' } }), 'extra'],
      [
        'a name in uses that is not one of ours',
        input({ uses: { ...input({}).uses, mongo: ['ghost'] } }),
        'ghost',
      ],
      [
        'the release candidates without a counter',
        input({ line: 'release-candidates', release: { major: 8, minor: 0 } }),
        'rcCounter',
      ],
      [
        'a bump on the release candidates',
        input({
          line: 'release-candidates',
          rcCounter: 26,
          release: { major: 8, minor: 0 },
          bump: ['framework'],
        }),
        'bump',
      ],
    ])('%s', (_case, given, named) => {
      expect(() => planRelease(given)).toThrow(named);
    });
  });

  it('moves every package to its level’s first version of 8.0 at the first release with levels', () => {
    const plan = planRelease(
      input({
        release: { major: 8, minor: 0 },
        everGa: new Set(),
        current: Object.fromEntries(Object.keys(graph).map((name) => [name, '8.0.0-rc.26'])),
        levelChanges: { mongo: 'rc' },
      }),
    );

    expect({
      framework: line(plan, 'framework'),
      mongo: line(plan, 'mongo'),
      mysql: line(plan, 'mysql'),
      supabase: line(plan, 'supabase'),
      paradedb: line(plan, 'paradedb'),
    }).toEqual({
      framework: '8.0.0 latest',
      mongo: '8.0.0-rc.27 latest framework ~8.0.0',
      mysql: '8.0.0-ea.0 latest framework ~8.0.0 target-mysql ~8.0.0-ea.0',
      supabase: '8.0.0-preview.0 latest postgres ^8.0.0',
      paradedb: '0.1.0 latest framework ^8.0.0',
    });
  });

  it('lets a level go down at a new minor, tagging the release with its level once the package has been GA', () => {
    const plan = planRelease(
      input({ release: { major: 8, minor: 2 }, levelChanges: { postgres: 'preview' } }),
    );

    expect(line(plan, 'postgres')).toBe(
      '8.2.0-preview.0 preview family ~8.2.0 framework ~8.2.0 target ~8.2.0',
    );
  });

  it('starts an rc package at X.Y.0-rc.0 in a later minor', () => {
    const plan = planRelease(
      input({ release: { major: 8, minor: 2 }, levelChanges: { mongo: 'rc' } }),
    );

    expect(line(plan, 'mongo')).toBe('8.2.0-rc.0 latest framework ~8.2.0');
  });
});
