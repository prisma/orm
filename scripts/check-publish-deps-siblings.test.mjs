import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { findPlanMismatches, findSiblingDependencies, runCheck } from './check-publish-deps.mjs';

const siblings = new Set(['@prisma/orm-framework', '@prisma/orm-family-sql']);

describe('findSiblingDependencies', () => {
  it('returns [] when every sibling is a peer', () => {
    assert.deepEqual(
      findSiblingDependencies(
        {
          dependencies: { arktype: '^2.2.9' },
          peerDependencies: { '@prisma/orm-framework': '8.1.0' },
          devDependencies: { '@prisma/orm-framework': '8.1.0' },
        },
        siblings,
      ),
      [],
    );
  });

  it('flags a sibling under dependencies or optionalDependencies', () => {
    assert.deepEqual(
      findSiblingDependencies(
        {
          dependencies: { '@prisma/orm-framework': '8.1.0', arktype: '^2.2.9' },
          optionalDependencies: { '@prisma/orm-family-sql': '8.1.0' },
        },
        siblings,
      ),
      [
        { field: 'dependencies', name: '@prisma/orm-framework', spec: '8.1.0' },
        { field: 'optionalDependencies', name: '@prisma/orm-family-sql', spec: '8.1.0' },
      ],
    );
  });

  it('leaves a package that is not one of ours alone', () => {
    assert.deepEqual(
      findSiblingDependencies({ dependencies: { '@prisma/cli-engine': '0.10.4' } }, siblings),
      [],
    );
  });
});

describe('runCheck sibling-dependency rule', () => {
  function io(packed, planRanges = () => undefined) {
    const written = [];
    return {
      written,
      io: {
        listPublishablePackageDirs: () => ['/repo/a', '/repo/b'],
        mkdtemp: () => '/tmp/pn-publish-check-fake',
        rm: () => {},
        readdirSync: () => ['prisma-orm-better-auth-8.1.0.tgz', 'prisma-orm-framework-8.1.0.tgz'],
        readPackageJson: (dir) =>
          dir === '/repo/a'
            ? { name: '@prisma/orm-better-auth', version: '8.1.0' }
            : { name: '@prisma/orm-framework', version: '8.1.0' },
        readPackedManifest: (path) =>
          path.endsWith('prisma-orm-better-auth-8.1.0.tgz')
            ? packed
            : { name: '@prisma/orm-framework' },
        readPackedDeclarations: () => new Map(),
        dependencyShipsOwnTypes: () => true,
        packAll: () => 0,
        stdoutWrite: (s) => written.push(s),
        stderrWrite: (s) => written.push(s),
        planRanges,
      },
    };
  }

  it('fails a published package that names a sibling as an ordinary dependency', () => {
    const run = io({ dependencies: { '@prisma/orm-framework': '8.1.0' } });
    assert.equal(runCheck({ argv: [], io: run.io }), 1);
    assert.match(
      run.written.join(''),
      /\[sibling\]\s+dependencies\.@prisma\/orm-framework = 8\.1\.0/,
    );
  });

  it('passes a published package that names its siblings as peers', () => {
    const run = io({ peerDependencies: { '@prisma/orm-framework': '8.1.0' } });
    assert.equal(runCheck({ argv: [], io: run.io }), 0);
  });

  it('fails a published package whose ranges on ours differ from the release plan', () => {
    const run = io({ peerDependencies: { '@prisma/orm-framework': '8.1.0' } }, (name) =>
      name === '@prisma/orm-better-auth' ? { '@prisma/orm-framework': '^8.1.0' } : undefined,
    );
    assert.equal(runCheck({ argv: [], io: run.io }), 1);
    assert.match(
      run.written.join(''),
      /\[plan\]\s+peerDependencies\.@prisma\/orm-framework = 8\.1\.0, the plan says \^8\.1\.0/,
    );
  });

  it('passes a published package whose ranges on ours are the plan’s', () => {
    const run = io({ peerDependencies: { '@prisma/orm-framework': '^8.1.0' } }, (name) =>
      name === '@prisma/orm-better-auth' ? { '@prisma/orm-framework': '^8.1.0' } : undefined,
    );
    assert.equal(runCheck({ argv: [], io: run.io }), 0);
  });
});

describe('findPlanMismatches', () => {
  for (const [title, packed, ranges, expected] of [
    [
      'none when every range is the plan’s',
      { peerDependencies: { a: '~8.1.0', pg: '^8' } },
      { a: '~8.1.0' },
      [],
    ],
    [
      'a range that differs',
      { peerDependencies: { a: '8.1.0' } },
      { a: '~8.1.0' },
      [{ name: 'a', spec: '8.1.0', planned: '~8.1.0' }],
    ],
    [
      'a package the plan names that the manifest does not',
      { peerDependencies: {} },
      { a: '~8.1.0' },
      [{ name: 'a', spec: undefined, planned: '~8.1.0' }],
    ],
  ]) {
    it(title, () => {
      assert.deepEqual(findPlanMismatches(packed, ranges), expected);
    });
  }
});
