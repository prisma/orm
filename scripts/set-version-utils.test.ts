import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type MutablePackageJson,
  participatesInLockstep,
  rewriteWorkspaceDeps,
  stampSkillMetadata,
} from './set-version-utils.ts';

describe('participatesInLockstep', () => {
  it('true for a project-boundary manifest with workspace pins (not a workspace member)', () => {
    assert.equal(
      participatesInLockstep({
        name: 'bundle-size-postgres',
        version: '0.16.0',
        dependencies: { '@prisma/orm-postgres': 'workspace:0.16.0' },
      }),
      true,
    );
  });

  it('true when the only workspace pin is a devDependency', () => {
    assert.equal(
      participatesInLockstep({
        name: 'x',
        devDependencies: { '@repo/tsconfig': 'workspace:*' },
      }),
      true,
    );
  });

  it('false for a fixture manifest with only registry-style specs', () => {
    assert.equal(
      participatesInLockstep({
        name: 'facade-only-app',
        version: '0.16.0',
        dependencies: { '@prisma/orm-postgres': '0.16.0', lodash: '^4.17.21' },
      }),
      false,
    );
  });

  it('false for a manifest with no dependency fields', () => {
    assert.equal(participatesInLockstep({ name: 'bare', version: '1.0.0' }), false);
  });
});

describe('rewriteWorkspaceDeps', () => {
  it('leaves a package with no @internal/* deps unchanged (fixture A)', () => {
    const pkg: MutablePackageJson = {
      name: 'a-no-pn-deps',
      version: '0.7.0',
      dependencies: { lodash: '^4.17.21' },
      devDependencies: { vitest: '^4.0.0' },
    };
    const before = JSON.stringify(pkg);
    rewriteWorkspaceDeps(pkg, '0.8.0');
    assert.equal(JSON.stringify(pkg), before);
  });

  it('rewrites workspace:* and workspace:<old-version> in lockstep (fixture B)', () => {
    const pkg: MutablePackageJson = {
      name: 'b-mixed-pn-deps',
      version: '0.7.0',
      dependencies: {
        '@internal/contract': 'workspace:*',
        '@internal/postgres': 'workspace:0.6.0',
        arktype: '^2.1.29',
      },
      devDependencies: {
        '@repo/tsconfig': 'workspace:*',
      },
    };
    rewriteWorkspaceDeps(pkg, '0.8.0');
    assert.deepEqual(pkg.dependencies, {
      '@internal/contract': 'workspace:0.8.0',
      '@internal/postgres': 'workspace:0.8.0',
      arktype: '^2.1.29',
    });
    assert.deepEqual(pkg.devDependencies, {
      '@repo/tsconfig': 'workspace:0.8.0',
    });
  });

  it('is idempotent — re-running with the same version produces no further change (fixture C)', () => {
    const pkg: MutablePackageJson = {
      name: 'c-already-pinned',
      version: '0.8.0',
      dependencies: {
        '@internal/contract': 'workspace:0.8.0',
      },
      peerDependencies: {
        '@internal/postgres': 'workspace:0.8.0',
      },
    };
    const before = JSON.stringify(pkg);
    rewriteWorkspaceDeps(pkg, '0.8.0');
    assert.equal(JSON.stringify(pkg), before);
    rewriteWorkspaceDeps(pkg, '0.8.0');
    assert.equal(JSON.stringify(pkg), before);
  });

  it('rewrites across every dep field (dependencies, peer, dev, optional)', () => {
    const pkg: MutablePackageJson = {
      name: 'all-fields',
      version: '0.7.0',
      dependencies: { '@internal/a': 'workspace:*' },
      peerDependencies: { '@internal/b': 'workspace:*' },
      devDependencies: { '@internal/c': 'workspace:*' },
      optionalDependencies: { '@internal/d': 'workspace:*' },
    };
    rewriteWorkspaceDeps(pkg, '1.0.0');
    assert.equal(pkg.dependencies!['@internal/a'], 'workspace:1.0.0');
    assert.equal(pkg.peerDependencies!['@internal/b'], 'workspace:1.0.0');
    assert.equal(pkg.devDependencies!['@internal/c'], 'workspace:1.0.0');
    assert.equal(pkg.optionalDependencies!['@internal/d'], 'workspace:1.0.0');
  });

  it('does not rewrite a non-workspace @internal/* spec (e.g. a published-version pin)', () => {
    // An extension package installs a published @internal/* dep via
    // its own author's `extension-upgrade-skill` flow. That spec is an
    // exact published version (no `workspace:` prefix) and must not be
    // touched by a host-workspace version bump.
    const pkg: MutablePackageJson = {
      name: 'extension-with-published-pn',
      version: '0.7.0',
      dependencies: {
        '@internal/contract': '0.7.0',
        '@internal/postgres': '^0.7.0',
      },
    };
    rewriteWorkspaceDeps(pkg, '0.8.0');
    assert.equal(pkg.dependencies!['@internal/contract'], '0.7.0');
    assert.equal(pkg.dependencies!['@internal/postgres'], '^0.7.0');
  });

  it('rewrites every scope, because the whole workspace is versioned in lockstep', () => {
    const pkg: MutablePackageJson = {
      name: 'with-deps-across-scopes',
      version: '0.7.0',
      dependencies: {
        '@prisma/orm-postgres': 'workspace:*',
        '@internal/contract': 'workspace:*',
        '@repo/tsconfig': 'workspace:*',
      },
    };
    rewriteWorkspaceDeps(pkg, '0.8.0');
    assert.deepEqual(pkg.dependencies, {
      '@prisma/orm-postgres': 'workspace:0.8.0',
      '@internal/contract': 'workspace:0.8.0',
      '@repo/tsconfig': 'workspace:0.8.0',
    });
  });

  it('tolerates a package with missing dep-field objects', () => {
    const pkg: MutablePackageJson = { name: 'sparse', version: '0.7.0' };
    rewriteWorkspaceDeps(pkg, '0.8.0');
    assert.equal(pkg.version, '0.7.0'); // version is the caller's job, not the helper's
    assert.equal(pkg.dependencies, undefined);
  });
});

describe('stampSkillMetadata', () => {
  const skillMd = [
    '---',
    'name: prisma-8',
    'description: >-',
    '  Something about library_version that must not be rewritten.',
    'metadata:',
    "  library: '@prisma/orm-postgres'",
    "  library_version: '0.16.0'",
    '---',
    '',
    '# Prisma Next (Prisma 8)',
    '',
    'library_version: 0.16.0 in the body is prose, not the stamp.',
    '',
  ].join('\n');

  it('rewrites the stamp inside the metadata block, quoted', () => {
    assert.match(
      stampSkillMetadata(skillMd, 'library_version', '8.1.0'),
      /^ {2}library_version: '8\.1\.0'$/m,
    );
  });

  it('leaves everything but the stamp alone', () => {
    const stamped = stampSkillMetadata(skillMd, 'library_version', '8.1.0');
    assert.equal(stamped, skillMd.replace("library_version: '0.16.0'", "library_version: '8.1.0'"));
  });

  it('rewrites any metadata key, not only the version', () => {
    const stamped = stampSkillMetadata(skillMd, 'library', '@prisma/orm-sqlite');
    assert.match(stamped, /^ {2}library: '@prisma\/orm-sqlite'$/m);
    assert.match(stamped, /^ {2}library_version: '0\.16\.0'$/m);
  });

  it('is idempotent', () => {
    const once = stampSkillMetadata(skillMd, 'library_version', '8.1.0');
    assert.equal(stampSkillMetadata(once, 'library_version', '8.1.0'), once);
  });

  it('rejects a skill whose metadata block carries no such key', () => {
    const unstamped = ['---', 'name: prisma-8', 'metadata:', '  library: x', '---', ''].join('\n');
    assert.throws(
      () => stampSkillMetadata(unstamped, 'library_version', '8.1.0'),
      /library_version/,
    );
  });

  it('rejects a skill with no metadata block', () => {
    const bare = ['---', 'name: prisma-8', 'description: x', '---', ''].join('\n');
    assert.throws(() => stampSkillMetadata(bare, 'library_version', '8.1.0'), /metadata/);
  });

  it('rejects a file with no frontmatter', () => {
    assert.throws(
      () => stampSkillMetadata('# no frontmatter\n', 'library_version', '8.1.0'),
      /frontmatter/,
    );
  });
});
