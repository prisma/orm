import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertCanonicalBase,
  composeDevVersion,
  computeNextMinor,
  computeNextReleaseVersion,
  parseVersion,
  planPushPublish,
} from './determine-version-utils.ts';

describe('parseVersion', () => {
  it('parses a clean release', () => {
    assert.deepEqual(parseVersion('0.7.0'), { major: 0, minor: 7, patch: 0 });
  });

  it('parses a multi-digit version', () => {
    assert.deepEqual(parseVersion('12.34.567'), { major: 12, minor: 34, patch: 567 });
  });

  it('tolerates a pre-release suffix', () => {
    assert.deepEqual(parseVersion('0.7.0-dev.5'), { major: 0, minor: 7, patch: 0 });
    assert.deepEqual(parseVersion('1.2.3-foo'), { major: 1, minor: 2, patch: 3 });
  });
});

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
    assert.equal(computeNextReleaseVersion('8.0.0'), '8.1.0');
    assert.equal(computeNextReleaseVersion('8.1.0'), '8.2.0');
  });

  it('rejects a non-canonical base', () => {
    assert.throws(() => computeNextReleaseVersion('8.0.0-dev.1'), /not canonical/);
  });

  it('rejects rc bases outside the 8.0.0 line', () => {
    assert.throws(() => computeNextReleaseVersion('0.17.0-rc.1'), /not canonical/);
    assert.throws(() => computeNextReleaseVersion('8.0.1-rc.1'), /not canonical/);
    assert.throws(() => computeNextReleaseVersion('9.0.0-rc.1'), /not canonical/);
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
      planPushPublish('8.1.0', { available: true, version: '8.0.0' }, '8.0.0-dev.5'),
      { version: '8.1.0', tag: 'latest', devVersion: '8.1.0-dev.1' },
    );
  });
});

describe('assertCanonicalBase', () => {
  it('accepts a clean release', () => {
    assert.doesNotThrow(() => assertCanonicalBase('0.7.0'));
    assert.doesNotThrow(() => assertCanonicalBase('1.2.3'));
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

  it('rejects rc.0 — the counter starts at rc.1', () => {
    assert.throws(() => assertCanonicalBase('8.0.0-rc.0'), /not canonical/);
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
