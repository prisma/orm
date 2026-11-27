import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  followsRootVersion,
  type MutablePackageJson,
  manifestFollowingRootVersion,
  restampExtensionVersion,
  rewriteWorkspaceDepsByPlan,
  stampSkillMetadata,
} from './set-version-utils.ts';

describe('manifestFollowingRootVersion', () => {
  it('parses a manifest with workspace pins', () => {
    assert.deepEqual(
      manifestFollowingRootVersion(
        '{ "name": "app", "dependencies": { "@prisma/orm-postgres": "workspace:8.0.0" } }',
      ),
      { name: 'app', dependencies: { '@prisma/orm-postgres': 'workspace:8.0.0' } },
    );
  });

  it('skips a manifest without workspace pins, even one that is not valid JSON', () => {
    assert.equal(manifestFollowingRootVersion('{ "name": "fixture-malformed", }'), undefined);
  });

  it('skips a manifest that only mentions workspace: outside its dependencies', () => {
    assert.equal(
      manifestFollowingRootVersion('{ "name": "a", "description": "workspace: notes" }'),
      undefined,
    );
  });

  it('refuses a manifest with workspace pins that is not valid JSON', () => {
    assert.throws(
      () => manifestFollowingRootVersion('{ "dependencies": { "a": "workspace:1.0.0" }, }'),
      SyntaxError,
    );
  });
});

describe('followsRootVersion', () => {
  it('true for a project-boundary manifest with workspace pins (not a workspace member)', () => {
    assert.equal(
      followsRootVersion({
        name: 'bundle-size-postgres',
        version: '0.16.0',
        dependencies: { '@prisma/orm-postgres': 'workspace:0.16.0' },
      }),
      true,
    );
  });

  it('true when the only workspace pin is a devDependency', () => {
    assert.equal(
      followsRootVersion({
        name: 'x',
        devDependencies: { '@repo/tsconfig': 'workspace:*' },
      }),
      true,
    );
  });

  it('false for a fixture manifest with only registry-style specs', () => {
    assert.equal(
      followsRootVersion({
        name: 'facade-only-app',
        version: '0.16.0',
        dependencies: { '@prisma/orm-postgres': '0.16.0', lodash: '^4.17.21' },
      }),
      false,
    );
  });

  it('false for a manifest with no dependency fields', () => {
    assert.equal(followsRootVersion({ name: 'bare', version: '1.0.0' }), false);
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
    '# Prisma 8 (Prisma 8)',
    '',
    'library_version: 0.16.0 in the body is prose, not the stamp.',
    '',
  ].join('\n');

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

describe('restampExtensionVersion', () => {
  const contractJson = [
    '{',
    '  "extensions": {',
    '    "supabase": {',
    '      "familyId": "sql",',
    '      "id": "supabase",',
    '      "kind": "extension",',
    '      "targetId": "postgres",',
    '      "version": "8.0.0-rc.9"',
    '    }',
    '  },',
    '  "meta": { "version": "8.0.0-rc.9" }',
    '}',
    '',
  ].join('\n');

  const contractDts = [
    '  readonly extensions: {',
    '    readonly supabase: {',
    "      readonly familyId: 'sql';",
    "      readonly id: 'supabase';",
    "      readonly kind: 'extension';",
    "      readonly targetId: 'postgres';",
    "      readonly version: '8.0.0-rc.9';",
    '    };',
    '  };',
    "  readonly other: { readonly version: '8.0.0-rc.9' };",
    '',
  ].join('\n');

  it('moves an extension version stamp in contract.json and leaves other version fields alone', () => {
    const out = restampExtensionVersion(contractJson, '8.0.0-rc.9', '8.0.0-rc.10');
    assert.match(out, /"targetId": "postgres",\n {6}"version": "8\.0\.0-rc\.10"/);
    assert.match(out, /"meta": \{ "version": "8\.0\.0-rc\.9" \}/);
  });

  it('moves an extension version stamp in contract.d.ts and leaves other version fields alone', () => {
    const out = restampExtensionVersion(contractDts, '8.0.0-rc.9', '8.0.0-rc.10');
    assert.match(out, /readonly targetId: 'postgres';\n {6}readonly version: '8\.0\.0-rc\.10';/);
    assert.match(out, /readonly other: \{ readonly version: '8\.0\.0-rc\.9' \}/);
  });

  it('returns the text unchanged when the stamp is not the from-version', () => {
    assert.equal(restampExtensionVersion(contractJson, '8.0.0-rc.8', '8.0.0-rc.10'), contractJson);
  });

  it('is idempotent', () => {
    const once = restampExtensionVersion(contractDts, '8.0.0-rc.9', '8.0.0-rc.10');
    assert.equal(restampExtensionVersion(once, '8.0.0-rc.9', '8.0.0-rc.10'), once);
  });
});

describe('rewriteWorkspaceDepsByPlan', () => {
  const names = new Set(['@prisma/orm-framework', '@prisma/orm-postgres']);

  function shell(): MutablePackageJson {
    return {
      name: '@prisma/orm-postgres',
      version: '8.0.0-rc.25',
      peerDependencies: { '@prisma/orm-framework': 'workspace:8.0.0-rc.25', pg: '^8.22.0' },
      devDependencies: {
        '@internal/postgres': 'workspace:8.0.0-rc.25',
        '@prisma/orm-framework': 'workspace:8.0.0-rc.25',
      },
    };
  }

  function example(): MutablePackageJson {
    return {
      name: 'example',
      version: '8.0.0-rc.25',
      dependencies: {
        '@prisma/orm-postgres': 'workspace:8.0.0-rc.25',
        '@prisma/orm-mongo': 'workspace:@internal/mongo@8.0.0-rc.25',
        '@internal/utils': 'workspace:8.0.0-rc.25',
      },
    };
  }

  it('writes on the release candidates exactly what one version for all wrote', () => {
    const shellManifest = shell();
    rewriteWorkspaceDepsByPlan(shellManifest, {
      rootVersion: '8.0.0-rc.26',
      line: 'release-candidates',
      published: names,
      ranges: { '@prisma/orm-framework': '8.0.0-rc.26' },
    });
    assert.deepEqual(shellManifest, {
      ...shell(),
      peerDependencies: { '@prisma/orm-framework': 'workspace:8.0.0-rc.26', pg: '^8.22.0' },
      devDependencies: {
        '@internal/postgres': 'workspace:8.0.0-rc.26',
        '@prisma/orm-framework': 'workspace:8.0.0-rc.26',
      },
    });

    const exampleManifest = example();
    rewriteWorkspaceDepsByPlan(exampleManifest, {
      rootVersion: '8.0.0-rc.26',
      line: 'release-candidates',
      published: names,
      ranges: undefined,
    });
    assert.deepEqual(exampleManifest.dependencies, {
      '@prisma/orm-postgres': 'workspace:8.0.0-rc.26',
      '@prisma/orm-mongo': 'workspace:@internal/mongo@8.0.0-rc.26',
      '@internal/utils': 'workspace:8.0.0-rc.26',
    });
  });

  it("writes a published package's specifiers on ours from the plan, peers and development copies alike", () => {
    const manifest = shell();
    rewriteWorkspaceDepsByPlan(manifest, {
      rootVersion: '8.1.0',
      line: 'levels',
      published: names,
      ranges: { '@prisma/orm-framework': '~8.1.0' },
    });
    assert.deepEqual(manifest, {
      ...shell(),
      peerDependencies: { '@prisma/orm-framework': 'workspace:~8.1.0', pg: '^8.22.0' },
      devDependencies: {
        '@internal/postgres': 'workspace:8.1.0',
        '@prisma/orm-framework': 'workspace:~8.1.0',
      },
    });
  });

  it('writes workspace:* on a published package from a private one on the levels line, and the root version on private ones', () => {
    const manifest = example();
    rewriteWorkspaceDepsByPlan(manifest, {
      rootVersion: '8.1.0',
      line: 'levels',
      published: names,
      ranges: undefined,
    });
    assert.deepEqual(manifest.dependencies, {
      '@prisma/orm-postgres': 'workspace:*',
      '@prisma/orm-mongo': 'workspace:@internal/mongo@8.1.0',
      '@internal/utils': 'workspace:8.1.0',
    });
  });

  it('refuses an alias on a published package, which has its own version and not the root one', () => {
    assert.throws(
      () =>
        rewriteWorkspaceDepsByPlan(
          { name: 'example', dependencies: { db: 'workspace:@prisma/orm-postgres@8.0.0-rc.25' } },
          { rootVersion: '8.1.0', line: 'levels', published: names, ranges: undefined },
        ),
      /example names @prisma\/orm-postgres through the alias db/,
    );
  });
});
