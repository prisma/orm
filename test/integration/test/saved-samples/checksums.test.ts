/**
 * A saved set records what a release wrote, so it never changes: every file of each set has the SHA-256 its checksum list beside it records, and the set has no file the list leaves out.
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeSampleChecksums, sampleChecksumsPath, savedReleases } from './sample-projects';

describe.each(savedReleases())('the saved sample set %s', (release) => {
  it('has the files its checksum list records', () => {
    const listPath = sampleChecksumsPath(release);
    expect(existsSync(listPath), `${listPath} is missing; the README says how a set gets one`).toBe(
      true,
    );
    expect(computeSampleChecksums(release)).toBe(readFileSync(listPath, 'utf8'));
  });
});
