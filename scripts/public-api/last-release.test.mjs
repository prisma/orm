import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isReleased, LastReleaseError, lastRelease } from './last-release.mjs';

const packuments = {
  '@prisma/orm-postgres': {
    'dist-tags': { latest: '8.0.0-rc.25', dev: '8.0.0-dev.40' },
    versions: { '8.0.0-rc.24': {}, '8.0.0-rc.25': {} },
  },
  '@prisma/orm-better-auth': { 'dist-tags': { latest: '0.0.0' }, versions: { '0.0.0': {} } },
};
const packument = async (name) => packuments[name];

describe('lastRelease', () => {
  it("is the reference package's latest version and its tag", async () => {
    const asked = [];
    const release = await lastRelease({
      root: '.',
      packument,
      tagExists: (tag) => asked.push(tag) > 0,
    });
    deepStrictEqual(release, { version: '8.0.0-rc.25', tag: 'v8.0.0-rc.25' });
    deepStrictEqual(asked, ['v8.0.0-rc.25']);
  });

  it('fails when the repository has no tag for it', async () => {
    await rejects(lastRelease({ root: '.', packument, tagExists: () => false }), (error) => {
      strictEqual(error instanceof LastReleaseError, true);
      strictEqual(
        error.message,
        '@prisma/orm-postgres@8.0.0-rc.25 is the last release, but the repository has no tag v8.0.0-rc.25',
      );
      return true;
    });
  });

  it('fails when the registry has no latest version', async () => {
    await rejects(
      lastRelease({ root: '.', packument: async () => undefined, tagExists: () => true }),
      LastReleaseError,
    );
  });
});

describe('isReleased', () => {
  it('is whether the package has a version equal to the last release', async () => {
    deepStrictEqual(
      await Promise.all(
        ['@prisma/orm-postgres', '@prisma/orm-better-auth', '@prisma/orm-unknown'].map((name) =>
          isReleased(name, '8.0.0-rc.25', packument),
        ),
      ),
      [true, false, false],
    );
  });
});
