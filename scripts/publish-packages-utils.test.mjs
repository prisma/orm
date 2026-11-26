import { strict as assert } from 'node:assert';
import { dirname } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classifyPublishResult,
  ownVersionsAlreadyPublished,
  publishTagFor,
  releaseTagsFor,
  wasEverGa,
} from './publish-packages-utils.mjs';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const NAMES = ['@prisma/orm-postgres', '@prisma/orm-mongo', '@prisma/orm-extension-paradedb'];

describe('classifyPublishResult', () => {
  it('treats exit 0 as ok and not already-published', () => {
    const result = classifyPublishResult({
      code: 0,
      output: '+ @internal/contract@0.9.0',
    });
    assert.deepEqual(result, { ok: true, alreadyPublished: false, retryable: false });
  });

  it('treats npm "cannot publish over previously published" as ok with alreadyPublished', () => {
    const result = classifyPublishResult({
      code: 1,
      output: [
        'npm notice 📦  @internal/middleware-cache@0.9.0',
        'npm error You cannot publish over the previously published versions: 0.9.0.',
        'npm error A complete log of this run can be found in: ...',
      ].join('\n'),
    });
    assert.deepEqual(result, { ok: true, alreadyPublished: true, retryable: false });
  });

  it('treats a sigstore transparency-log conflict as a retryable failure, not a success', () => {
    const result = classifyPublishResult({
      code: 1,
      output: [
        'npm notice Publishing to https://registry.npmjs.org with tag dev and public access',
        'npm error code TLOG_CREATE_ENTRY_ERROR',
        'npm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log with UUID 108e9186e8c5677a',
      ].join('\n'),
    });
    assert.deepEqual(result, { ok: false, alreadyPublished: false, retryable: true });
  });

  it('treats other non-zero exits as failures', () => {
    const result = classifyPublishResult({
      code: 1,
      output: [
        'npm error code ENEEDAUTH',
        'npm error need auth This command requires you to be logged in to https://registry.npmjs.org',
      ].join('\n'),
    });
    assert.deepEqual(result, { ok: false, alreadyPublished: false, retryable: false });
  });

  it('treats spawn errors (no captured npm output) as failures', () => {
    const result = classifyPublishResult({
      code: 1,
      output: 'spawn error: ENOENT',
    });
    assert.deepEqual(result, { ok: false, alreadyPublished: false, retryable: false });
  });
});

describe('publishTagFor', () => {
  it('publishes a release under the tag the plan gives each package', () => {
    assert.equal(publishTagFor('latest', 'latest'), 'latest');
    assert.equal(publishTagFor('latest', 'preview'), 'preview');
  });

  it('publishes every package under any other tag the workflow passes', () => {
    assert.equal(publishTagFor('dev', 'preview'), 'dev');
    assert.equal(publishTagFor('beta', undefined), 'beta');
  });

  it('refuses a release for a package the plan does not cover', () => {
    assert.throws(() => publishTagFor('latest', undefined), /release plan/);
  });
});

describe('wasEverGa', () => {
  it('is true when a plain version of any major was published', () => {
    assert.equal(wasEverGa(['8.0.0-rc.3', '8.0.0', '9.0.0-rc.0']), true);
    assert.equal(wasEverGa(['8.4.1', '9.0.0-preview.0']), true);
  });

  it('is false when only pre-releases, development builds or 0.x minors were published', () => {
    assert.equal(
      wasEverGa(['0.16.0', '0.17.0', '8.0.0-rc.25', '8.0.0-rc.25-dev.3', '8.1.0-preview.0']),
      false,
    );
  });

  it('ignores versions this repository does not publish', () => {
    assert.equal(wasEverGa(['8.0.0-beta.1', '0.0.0-pr.12']), false);
  });
});

describe('releaseTagsFor', () => {
  it('reads nothing from the registry on the release candidates, and tags everything latest', () => {
    const read = [];
    const tags = releaseTagsFor({
      rootDir,
      rootVersion: '8.0.0-rc.26',
      names: NAMES,
      publishedVersions: (name) => {
        read.push(name);
        return [];
      },
    });
    assert.deepEqual(
      { read, tags: NAMES.map((name) => tags.get(name)) },
      { read: [], tags: ['latest', 'latest', 'latest'] },
    );
  });

  it('tags a package below GA with its level once it has had a GA release in any major', () => {
    const versions = { '@prisma/orm-mongo': ['0.17.0', '8.0.0-rc.26', '8.4.0'] };
    const tags = releaseTagsFor({
      rootDir,
      rootVersion: '8.0.1',
      names: NAMES,
      publishedVersions: (name) => versions[name] ?? ['0.17.0'],
    });
    assert.deepEqual(
      NAMES.map((name) => tags.get(name)),
      ['latest', 'ea', 'latest'],
    );
  });

  it('keeps latest for a package below GA whose only plain versions are 0.x', () => {
    const tags = releaseTagsFor({
      rootDir,
      rootVersion: '8.0.1',
      names: NAMES,
      publishedVersions: () => ['0.16.0', '0.17.0', '8.0.0-rc.26'],
    });
    assert.equal(tags.get('@prisma/orm-mongo'), 'latest');
  });
});

describe('ownVersionsAlreadyPublished', () => {
  const packages = [
    { name: '@prisma/orm-extension-paradedb', version: '0.18.0' },
    { name: '@prisma/orm-postgres', version: '8.1.0' },
  ];

  it('skips a package with its own version when that version is on the registry', () => {
    assert.deepEqual(
      ownVersionsAlreadyPublished({
        dryRun: false,
        rootVersion: '8.1.0',
        packages,
        publishedVersions: () => ['0.18.0', '8.1.0'],
      }),
      ['@prisma/orm-extension-paradedb'],
    );
  });

  it('publishes it when its version is new', () => {
    assert.deepEqual(
      ownVersionsAlreadyPublished({
        dryRun: false,
        rootVersion: '8.1.0',
        packages: [{ name: '@prisma/orm-extension-paradedb', version: '0.18.1' }],
        publishedVersions: () => ['0.18.0'],
      }),
      [],
    );
  });

  it('skips nothing in a dry run, so every package goes through the publish checks', () => {
    assert.deepEqual(
      ownVersionsAlreadyPublished({
        dryRun: true,
        rootVersion: '8.1.0',
        packages,
        publishedVersions: () => ['0.18.0', '8.1.0'],
      }),
      [],
    );
  });

  it('reads nothing on the release candidates', () => {
    assert.deepEqual(
      ownVersionsAlreadyPublished({
        dryRun: false,
        rootVersion: '8.0.0-rc.26',
        packages,
        publishedVersions: () => {
          throw new Error('read the registry');
        },
      }),
      [],
    );
  });
});
