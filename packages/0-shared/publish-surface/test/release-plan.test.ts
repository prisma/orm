import { describe, expect, it } from 'vitest';
import {
  type DeclaredLevel,
  firstVersionOfMinor,
  formatVersion,
  type PackageKind,
  parseVersion,
  planInputFor,
  planRelease,
  type ReleasePlanInput,
  releaseOfRootVersion,
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
  paradedb: { level: { firstVersion: '0.1.0' }, kind: 'extension', uses: ['framework'] },
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

const AT_8_0: Record<string, string> = Object.fromEntries(
  Object.entries(AT_8_1).map(([name, version]) => [
    name,
    version.replace(/^8\.1\.0(?=-(?:ea|preview)\.)/, '8.0.1').replace(/^8\.1\./, '8.0.'),
  ]),
);

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
    lastReleaseCandidate: undefined,
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
      mysql: '8.0.1-ea.0 latest framework ~8.0.0 target-mysql ~8.0.1-ea.0',
      supabase: '8.0.1-preview.0 latest postgres ^8.0.0',
      paradedb: '0.1.0 latest framework ^8.0.0',
    });
  });

  it('lets a package that has never been GA go down at a new minor', () => {
    const plan = planRelease(
      input({ release: { major: 8, minor: 2 }, levelChanges: { mongo: 'ea' } }),
    );

    expect(line(plan, 'mongo')).toBe('8.2.0-ea.0 latest framework ~8.2.0');
  });

  it.each([
    ['at a new minor', { major: 8, minor: 2 }],
    ['at a new major', { major: 9, minor: 0 }],
    ['within the minor', { major: 8, minor: 1 }],
  ])('refuses to move a GA package below GA %s, saying it is not decided', (_case, release) => {
    expect(() => planRelease(input({ release, levelChanges: { postgres: 'preview' } }))).toThrow(
      /postgres.*not decided/,
    );
  });

  it('moves a package that started 8.0 at 8.0.1 up to rc at 8.0.1-rc.0, and ranges on it follow', () => {
    const plan = planRelease(
      input({
        release: { major: 8, minor: 0 },
        current: { ...AT_8_0, mysql: '8.0.1-ea.2' },
        levelChanges: { mysql: 'rc', 'target-mysql': 'rc' },
      }),
    );

    expect({
      mysql: line(plan, 'mysql'),
      mariadbOnMysql: plan['mariadb']?.ranges['mysql'],
    }).toEqual({
      mysql: '8.0.1-rc.0 latest framework ~8.0.0 target-mysql ~8.0.1-rc.0',
      mariadbOnMysql: '~8.0.1-rc.0',
    });
  });

  it('moves a package that started 8.0 at 8.0.1 up to GA at 8.0.1, and ranges on it are ~8.0.0', () => {
    const plan = planRelease(
      input({
        release: { major: 8, minor: 0 },
        current: { ...AT_8_0, mongo: '8.0.1-preview.2' },
        levelChanges: { mongo: 'ga' },
        uses: { ...input({}).uses, mysql: ['framework', 'target-mysql', 'mongo'] },
      }),
    );

    expect({
      mongo: line(plan, 'mongo'),
      mysqlOnMongo: plan['mysql']?.ranges['mongo'],
    }).toEqual({
      mongo: '8.0.1 latest framework ~8.0.0',
      mysqlOnMongo: '~8.0.0',
    });
  });

  it('keeps an rc package of 8.0 on the release candidates’ counter at a fix', () => {
    const plan = planRelease(
      input({
        release: { major: 8, minor: 0 },
        current: { ...AT_8_0, mongo: '8.0.0-rc.27' },
        levelChanges: { mongo: 'rc' },
        lastReleaseCandidate: 26,
        bump: ['mongo'],
        uses: { ...input({}).uses, mysql: ['framework', 'target-mysql', 'mongo'] },
      }),
    );

    expect({
      mongo: line(plan, 'mongo'),
      mysqlOnMongo: plan['mysql']?.ranges['mongo'],
    }).toEqual({
      mongo: '8.0.0-rc.28 latest framework ~8.0.0',
      mysqlOnMongo: '~8.0.0-rc.27',
    });
  });

  it.each([
    ['rc', '8.1.0-rc.0 latest framework ~8.1.0'],
    ['ga', '8.1.0 latest framework ~8.1.0'],
  ])('lets a level go up to %s within a minor', (level, expected) => {
    const plan = planRelease(input({ levelChanges: { mongo: level as DeclaredLevel } }));

    expect(line(plan, 'mongo')).toBe(expected);
  });

  it('gives an extension a tilde within the minor on a package below GA, and a caret on a GA one', () => {
    const plan = planRelease(
      input({ uses: { ...input({}).uses, 'better-auth': ['framework', 'mongo'] } }),
    );

    expect(line(plan, 'better-auth')).toBe(
      '8.1.0-preview.0 latest framework ^8.1.0 mongo ~8.1.0-preview.0',
    );
  });

  describe('a package numbered on its own', () => {
    it('keeps its version at a later release', () => {
      expect(line(planRelease(input({ release: { major: 8, minor: 2 } })), 'paradedb')).toBe(
        '0.1.0 latest framework ^8.2.0',
      );
    });

    it('raises its patch when it gets a fix', () => {
      expect(line(planRelease(input({ bump: ['paradedb'] })), 'paradedb')).toBe(
        '0.1.1 latest framework ^8.1.0',
      );
    });
  });

  it('starts an rc package at X.Y.0-rc.0 in a later minor', () => {
    const plan = planRelease(
      input({ release: { major: 8, minor: 2 }, levelChanges: { mongo: 'rc' } }),
    );

    expect(line(plan, 'mongo')).toBe('8.2.0-rc.0 latest framework ~8.2.0');
  });
});

describe('firstVersionOfMinor', () => {
  it.each([
    ['ga', { major: 8, minor: 0 }, undefined, '8.0.0'],
    ['preview', { major: 8, minor: 0 }, undefined, '8.0.1-preview.0'],
    ['ea', { major: 8, minor: 0 }, '8.0.0-rc.26', '8.0.1-ea.0'],
    ['rc', { major: 8, minor: 0 }, '8.0.0-rc.26', '8.0.0-rc.27'],
    ['ga', { major: 8, minor: 0 }, '8.0.0-rc.29', '8.0.0'],
    ['rc', { major: 8, minor: 0 }, '8.0.1-ea.3', '8.0.1-rc.0'],
    ['ga', { major: 8, minor: 0 }, '8.0.1-rc.1', '8.0.1'],
    ['ga', { major: 8, minor: 0 }, '8.0.1', '8.0.0'],
    ['rc', { major: 8, minor: 3 }, undefined, '8.3.0-rc.0'],
    ['preview', { major: 8, minor: 3 }, '8.0.1-ea.3', '8.3.0-preview.0'],
    ['ea', { major: 8, minor: 3 }, undefined, '8.3.0-ea.0'],
  ] as const)(
    'gives a %s package at %o, from %s, its first version %s',
    (level, release, from, expected) => {
      const version = from === undefined ? undefined : parseVersion(from);
      expect(firstVersionOfMinor(release, level, 26, version)).toBe(expected);
    },
  );

  it('refuses an rc package of 8.0 when the last release candidate is not known', () => {
    expect(() =>
      firstVersionOfMinor({ major: 8, minor: 0 }, 'rc', undefined, parseVersion('8.0.0-rc.26')),
    ).toThrow(/last 8\.0\.0 release candidate/);
  });
});

/** Semantic Versioning's order of two versions this repository publishes. */
function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const levels = ['ea', 'preview', 'rc'];
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    (a.level === undefined ? 1 : 0) - (b.level === undefined ? 1 : 0) ||
    (a.level !== undefined && b.level !== undefined
      ? levels.indexOf(a.level.name) - levels.indexOf(b.level.name) ||
        a.level.counter - b.level.counter
      : 0)
  );
}

/** Whether a tilde or caret range admits a version, with Semantic Versioning's rule for pre-releases. */
function admits(range: string, version: string): boolean {
  const base = parseVersion(range.slice(1));
  const v = parseVersion(version);
  if (
    v.level !== undefined &&
    (base.level === undefined ||
      v.major !== base.major ||
      v.minor !== base.minor ||
      v.patch !== base.patch)
  ) {
    return false;
  }
  if (compareVersions(version, range.slice(1)) < 0) return false;
  return range.startsWith('~')
    ? v.major === base.major && v.minor === base.minor
    : v.major === base.major;
}

const FIRST_RELEASE_WITH_LEVELS = input({
  release: { major: 8, minor: 0 },
  everGa: new Set(),
  current: Object.fromEntries(Object.keys(graph).map((name) => [name, '8.0.0-rc.26'])),
  levelChanges: { mongo: 'rc' },
});

const LATER_PLANS: Record<string, ReleasePlanInput> = {
  '8.1': input({}),
  'a fix within 8.1': input({ bump: ['framework', 'mongo', 'mysql', 'paradedb'] }),
  'levels going up within 8.1': input({
    levelChanges: { mongo: 'rc', mysql: 'preview', 'target-mysql': 'preview' },
  }),
  'a fix within 8.0': input({
    release: { major: 8, minor: 0 },
    current: { ...AT_8_0, mongo: '8.0.1-preview.2' },
    bump: ['framework', 'mongo', 'mysql', 'paradedb'],
  }),
  'a move up to rc within 8.0': input({
    release: { major: 8, minor: 0 },
    current: { ...AT_8_0, mongo: '8.0.1-preview.2' },
    levelChanges: { mongo: 'rc' },
  }),
  'a move up to GA within 8.0': input({
    release: { major: 8, minor: 0 },
    current: { ...AT_8_0, mongo: '8.0.1-preview.2' },
    levelChanges: { mongo: 'ga' },
  }),
  'an rc package of 8.0 moving up to GA': input({
    release: { major: 8, minor: 0 },
    current: { ...AT_8_0, mongo: '8.0.0-rc.28' },
    levelChanges: { mongo: 'ga' },
  }),
  '8.2 with a level going down': input({
    release: { major: 8, minor: 2 },
    levelChanges: { mongo: 'ea' },
  }),
};

describe('every range the plan writes admits the version the plan gives the package it names', () => {
  const plans = { 'the first release with levels': FIRST_RELEASE_WITH_LEVELS, ...LATER_PLANS };

  it.each(Object.entries(plans))('%s', (_case, given) => {
    const plan = planRelease(given);
    const refused = Object.entries(plan).flatMap(([user, planned]) =>
      Object.entries(planned.ranges)
        .filter(([named, range]) => !admits(range, plan[named]?.version ?? ''))
        .map(([named, range]) => `${user} writes ${range} on ${named} at ${plan[named]?.version}`),
    );
    expect(refused).toEqual([]);
  });
});

describe('a planned version never sorts below the version a package has', () => {
  /** Each package whose planned version sorts below its current one, with both versions. */
  function movedBack(given: ReleasePlanInput): string[] {
    const plan = planRelease(given);
    return Object.entries(plan)
      .filter(([name, planned]) => compareVersions(planned.version, given.current[name] ?? '') < 0)
      .map(([name, planned]) => `${name}: ${given.current[name]} to ${planned.version}`);
  }

  it.each(Object.entries(LATER_PLANS))('%s', (_case, given) => {
    expect(movedBack(given)).toEqual([]);
  });

  it('at the first release with levels, moves back only ParadeDB, which leaves the release number', () => {
    expect(movedBack(FIRST_RELEASE_WITH_LEVELS)).toEqual(['paradedb: 8.0.0-rc.26 to 0.1.0']);
  });
});

describe('no range release 8.0 writes admits a published release candidate', () => {
  const plans = {
    'the first release with levels': FIRST_RELEASE_WITH_LEVELS,
    ...Object.fromEntries(
      Object.entries(LATER_PLANS).filter(([, given]) => given.release.minor === 0),
    ),
  };

  it.each(Object.entries(plans))('%s', (_case, given) => {
    const plan = planRelease(given);
    const admitted = Object.entries(plan).flatMap(([user, planned]) =>
      Object.entries(planned.ranges)
        .filter(([, range]) => ['8.0.0-rc.1', '8.0.0-rc.26'].some((rc) => admits(range, rc)))
        .map(([named, range]) => `${user} writes ${range} on ${named}`),
    );
    expect(admitted).toEqual([]);
  });
});

describe('releaseOfRootVersion', () => {
  it.each([
    [
      '8.0.0-rc.26',
      {
        release: { major: 8, minor: 0 },
        line: 'release-candidates',
        rcCounter: 26,
        dev: undefined,
      },
    ],
    [
      '8.0.0-rc.26-dev.3',
      { release: { major: 8, minor: 0 }, line: 'release-candidates', rcCounter: 26, dev: 3 },
    ],
    [
      '8.0.0',
      { release: { major: 8, minor: 0 }, line: 'levels', rcCounter: undefined, dev: undefined },
    ],
    [
      '8.1.0-dev.7',
      { release: { major: 8, minor: 1 }, line: 'levels', rcCounter: undefined, dev: 7 },
    ],
  ])('reads %s', (version, expected) => {
    expect(releaseOfRootVersion(version)).toEqual(expected);
  });

  it('refuses a release-candidate line of another release, saying only 8.0.0 has one', () => {
    expect(() => releaseOfRootVersion('9.0.0-rc.1')).toThrow(
      /9\.0\.0-rc\.1.*only the 8\.0\.0 release candidates/,
    );
  });

  it.each(['8.1.0-preview.0', '8.1.0-ea.2', '8.1.2', '8.0.0-beta.1'])(
    'refuses %s as a root version, naming it',
    (version) => {
      expect(() => releaseOfRootVersion(version)).toThrow(`"${version}"`);
    },
  );
});

describe('planInputFor', () => {
  it('reads current versions and who names whom from the published manifests', () => {
    const levels = new Map<string, DeclaredLevel>([
      ['@prisma/orm-framework', 'ga'],
      ['@prisma/orm-postgres', 'ga'],
    ]);
    const kinds = {
      '@prisma/orm-framework': 'platform',
      '@prisma/orm-postgres': 'facade',
    } as const;

    expect(
      planInputFor({
        rootVersion: '8.1.0',
        manifests: [
          { name: '@prisma/orm-framework', version: '8.1.0' },
          {
            name: '@prisma/orm-postgres',
            version: '8.1.0-dev.3',
            peerDependencies: { '@prisma/orm-framework': 'workspace:~8.1.0', pg: '^8.22.0' },
          },
        ],
        levels,
        kinds,
        everGa: new Set(),
        lastReleaseCandidate: undefined,
      }),
    ).toEqual({
      release: { major: 8, minor: 1 },
      line: 'levels',
      rcCounter: undefined,
      dev: undefined,
      current: { '@prisma/orm-framework': '8.1.0', '@prisma/orm-postgres': '8.1.0' },
      uses: { '@prisma/orm-framework': [], '@prisma/orm-postgres': ['@prisma/orm-framework'] },
      levels,
      kinds,
      everGa: new Set(),
      lastReleaseCandidate: undefined,
      bump: [],
    });
  });
});
