import { describe, expect, it } from 'vitest';
import { versionOutsideTheRelease } from './skewed-version';

describe('a version outside the release', () => {
  it.each([
    ['8.0.0-rc.25', '8.0.0-rc.26'],
    ['8.1.0', '9.0.0'],
  ])('for %s is %s', (root, skewed) => {
    expect(versionOutsideTheRelease(root)).toBe(skewed);
  });
});
