import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertCanonicalBase,
  composeDevVersion,
  computeNextMinor,
  computeNextReleaseVersion,
  planDispatchPublish,
  planPushPublish,
} from './determine-version-utils.ts';

describe('computeNextMinor', () => {
  it('advances 0.7.0 to 0.8.0', () => {
    assert.equal(computeNextMinor('0.7.0'), '0.8.0');
  });

  it('zeros the patch component', () => {
    assert.equal(computeNextMinor('1.2.5'), '1.3.0');
  });

  it('ignores pre-release suffixes on the input', () => {
    assert.equal(computeNextMinor('0.7.0-dev.5'), '0.8.0');
  });
});

describe('computeNextReleaseVersion', () => {
  it('advances an rc base to the next rc', () => {
    assert.equal(computeNextReleaseVersion('8.0.0-rc.1'), '8.0.0-rc.2');
  });

  it('advances a multi-digit rc counter', () => {
    assert.equal(computeNextReleaseVersion('8.0.0-rc.9'), '8.0.0-rc.10');
    assert.equal(computeNextReleaseVersion('8.0.0-rc.41'), '8.0.0-rc.42');
  });

  it('transitions a pre-8 stable base onto the v8 rc line', () => {
    assert.equal(computeNextReleaseVersion('0.17.0'), '8.0.0-rc.1');
    assert.equal(computeNextReleaseVersion('0.18.0'), '8.0.0-rc.1');
  });

  it('advances a stable 8.x base to the next minor', () => {
    assert.equal(computeNextReleaseVersion('8.0.1'), '8.1.0');
    assert.equal(computeNextReleaseVersion('8.1.0'), '8.2.0');
  });

  it('refuses 8.0.0, since release 8.0 is cut as 8.0.1', () => {
    assert.throws(() => computeNextReleaseVersion('8.0.0'), /8\.0\.1/);
  });

  it('rejects a non-canonical base', () => {
    assert.throws(() => computeNextReleaseVersion('8.0.0-dev.1'), /not canonical/);
  });
});

describe('composeDevVersion', () => {
  it('starts at dev.1 when no dev build exists yet', () => {
    assert.deepEqual(composeDevVersion('0.17.0', undefined), {
      version: '0.17.0-dev.1',
      tag: 'dev',
    });
  });

  it('increments the counter when the latest dev build shares the base', () => {
    assert.deepEqual(composeDevVersion('0.17.0', '0.17.0-dev.4'), {
      version: '0.17.0-dev.5',
      tag: 'dev',
    });
  });

  it('resets the counter when the base moved on', () => {
    assert.deepEqual(composeDevVersion('0.18.0', '0.17.0-dev.9'), {
      version: '0.18.0-dev.1',
      tag: 'dev',
    });
  });

  it('composes dev builds on an rc base', () => {
    assert.deepEqual(composeDevVersion('8.0.0-rc.1', undefined), {
      version: '8.0.0-rc.1-dev.1',
      tag: 'dev',
    });
    assert.deepEqual(composeDevVersion('8.0.0-rc.1', '8.0.0-rc.1-dev.7'), {
      version: '8.0.0-rc.1-dev.8',
      tag: 'dev',
    });
  });

  it('resets the counter when the rc counter moved on', () => {
    assert.deepEqual(composeDevVersion('8.0.0-rc.2', '8.0.0-rc.1-dev.7'), {
      version: '8.0.0-rc.2-dev.1',
      tag: 'dev',
    });
  });

  it('continues the counter within a release on the levels line, whichever version the anchor package has', () => {
    assert.deepEqual(composeDevVersion('8.1.0', '8.1.1-dev.4'), {
      version: '8.1.0-dev.5',
      tag: 'dev',
    });
    assert.deepEqual(composeDevVersion('8.1.0', '8.1.0-preview.0-dev.3'), {
      version: '8.1.0-dev.4',
      tag: 'dev',
    });
  });

  it('continues the counter across a fix to the anchor package, so no other package repeats a build', () => {
    assert.deepEqual(composeDevVersion('8.1.0', '8.1.0-dev.9'), {
      version: '8.1.0-dev.10',
      tag: 'dev',
    });
  });

  it('continues the counter across a fix to another package', () => {
    assert.deepEqual(composeDevVersion('8.1.0', '8.1.1-dev.9'), {
      version: '8.1.0-dev.10',
      tag: 'dev',
    });
  });

  it('continues the counter at a new release on the levels line, since a package with its own version keeps it across releases', () => {
    assert.deepEqual(composeDevVersion('8.2.0', '8.1.1-dev.9'), {
      version: '8.2.0-dev.10',
      tag: 'dev',
    });
  });

  it('resets the counter when the root leaves the release candidates', () => {
    assert.deepEqual(composeDevVersion('8.0.1', '8.0.0-rc.35-dev.4'), {
      version: '8.0.1-dev.1',
      tag: 'dev',
    });
  });

  it('stops on a development build with an unknown suffix, naming it', () => {
    assert.throws(
      () => composeDevVersion('8.1.0', '8.1.0-beta.1-dev.2'),
      /"8\.1\.0-beta\.1-dev\.2"/,
    );
  });

  it('resets the counter across the stable-to-rc transition', () => {
    assert.deepEqual(composeDevVersion('8.0.0-rc.1', '0.17.0-dev.12'), {
      version: '8.0.0-rc.1-dev.1',
      tag: 'dev',
    });
  });
});

describe('planPushPublish', () => {
  it('plans a dev-only publish when the root version is unchanged', () => {
    assert.deepEqual(
      planPushPublish('8.0.0-rc.7', { available: true, version: '8.0.0-rc.7' }, '8.0.0-rc.7-dev.3'),
      { version: '8.0.0-rc.7-dev.4', tag: 'dev' },
    );
  });

  it('plans a release plus a dev follow-up when the root version changed', () => {
    assert.deepEqual(
      planPushPublish('8.0.0-rc.7', { available: true, version: '8.0.0-rc.6' }, '8.0.0-rc.6-dev.1'),
      { version: '8.0.0-rc.7', tag: 'latest', devVersion: '8.0.0-rc.7-dev.1' },
    );
  });

  it('continues the dev counter in the follow-up when dev is already on the new base', () => {
    assert.deepEqual(
      planPushPublish('8.0.0-rc.7', { available: true, version: '8.0.0-rc.6' }, '8.0.0-rc.7-dev.2'),
      { version: '8.0.0-rc.7', tag: 'latest', devVersion: '8.0.0-rc.7-dev.3' },
    );
  });

  it('falls back to the dev path when the previous version is unreadable', () => {
    assert.deepEqual(planPushPublish('8.0.0-rc.7', { available: false }, undefined), {
      version: '8.0.0-rc.7-dev.1',
      tag: 'dev',
    });
  });

  it('plans a stable release with its dev follow-up', () => {
    assert.deepEqual(
      planPushPublish('8.1.0', { available: true, version: '8.0.1' }, '8.0.1-dev.5'),
      { version: '8.1.0', tag: 'latest', devVersion: '8.1.0-dev.6' },
    );
  });

  it('plans release 8.0 as 8.0.1 after the release candidates, its dev counter starting again', () => {
    assert.deepEqual(
      planPushPublish('8.0.1', { available: true, version: '8.0.0-rc.35' }, '8.0.0-rc.35-dev.4'),
      { version: '8.0.1', tag: 'latest', devVersion: '8.0.1-dev.1' },
    );
  });
});

describe('planDispatchPublish', () => {
  it('plans a dev follow-up for a real latest dispatch', () => {
    assert.deepEqual(planDispatchPublish('8.0.0-rc.7', 'latest', false, '8.0.0-rc.6-dev.1'), {
      version: '8.0.0-rc.7',
      tag: 'latest',
      devVersion: '8.0.0-rc.7-dev.1',
    });
  });

  it('continues the dev counter when dev is already on the base', () => {
    assert.deepEqual(planDispatchPublish('8.0.0-rc.7', 'latest', false, '8.0.0-rc.7-dev.2'), {
      version: '8.0.0-rc.7',
      tag: 'latest',
      devVersion: '8.0.0-rc.7-dev.3',
    });
  });

  it('plans no dev follow-up for a dry run', () => {
    assert.deepEqual(planDispatchPublish('8.0.0-rc.7', 'latest', true, '8.0.0-rc.6-dev.1'), {
      version: '8.0.0-rc.7',
      tag: 'latest',
    });
  });

  it('plans no dev follow-up for a non-latest dispatch', () => {
    assert.deepEqual(planDispatchPublish('8.0.0-rc.7', 'beta', false, '8.0.0-rc.6-dev.1'), {
      version: '8.0.0-rc.7',
      tag: 'beta',
    });
  });
});

describe('assertCanonicalBase', () => {
  it('accepts a clean release', () => {
    assert.doesNotThrow(() => assertCanonicalBase('0.7.0'));
    assert.doesNotThrow(() => assertCanonicalBase('1.2.3'));
    assert.doesNotThrow(() => assertCanonicalBase('8.0.1'));
    assert.doesNotThrow(() => assertCanonicalBase('8.1.0'));
  });

  it('refuses a Prisma 8 release that is not a release number, saying why', () => {
    assert.throws(() => assertCanonicalBase('8.0.0'), /release 8\.0 is cut as 8\.0\.1/);
    assert.throws(() => assertCanonicalBase('8.0.2'), /8\.0\.1/);
    assert.throws(() => assertCanonicalBase('8.1.1'), /8\.1\.0/);
  });

  it('accepts an rc base', () => {
    assert.doesNotThrow(() => assertCanonicalBase('8.0.0-rc.1'));
    assert.doesNotThrow(() => assertCanonicalBase('8.0.0-rc.42'));
  });

  it('rejects a dev suffix', () => {
    assert.throws(() => assertCanonicalBase('0.7.0-dev.1'), /not canonical/);
    assert.throws(() => assertCanonicalBase('8.0.0-rc.1-dev.2'), /not canonical/);
  });

  it('rejects non-rc pre-release suffixes', () => {
    assert.throws(() => assertCanonicalBase('8.0.0-beta.1'), /not canonical/);
    assert.throws(() => assertCanonicalBase('8.0.0-rc'), /not canonical/);
    assert.throws(() => assertCanonicalBase('8.0.0-rc.'), /not canonical/);
  });

  it('rejects rc bases outside the 8.0.0 line', () => {
    assert.throws(() => assertCanonicalBase('0.17.0-rc.1'), /not canonical/);
    assert.throws(() => assertCanonicalBase('8.0.1-rc.1'), /not canonical/);
    assert.throws(() => assertCanonicalBase('8.1.0-rc.1'), /not canonical/);
    assert.throws(() => assertCanonicalBase('9.0.0-rc.1'), /not canonical/);
  });

  it('rejects rc.0, saying the counter starts at 1', () => {
    assert.throws(() => assertCanonicalBase('8.0.0-rc.0'), /not canonical.*starts at 1/);
  });

  it('rejects a missing component', () => {
    assert.throws(() => assertCanonicalBase('0.7'), /not canonical/);
  });

  it('rejects an empty string', () => {
    assert.throws(() => assertCanonicalBase(''), /not canonical/);
  });

  it('rejects components with leading zeros', () => {
    assert.throws(() => assertCanonicalBase('01.2.3'), /not canonical/);
    assert.throws(() => assertCanonicalBase('1.02.3'), /not canonical/);
    assert.throws(() => assertCanonicalBase('1.2.03'), /not canonical/);
    assert.throws(() => assertCanonicalBase('8.0.0-rc.01'), /not canonical/);
  });
});
