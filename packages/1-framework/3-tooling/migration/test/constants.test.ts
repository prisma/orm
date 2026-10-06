import { describe, expect, it } from 'vitest';
import { contractHashAtMarker, EMPTY_CONTRACT_HASH } from '../src/constants';

describe('contractHashAtMarker', () => {
  it('is the marker storage hash when a marker exists', () => {
    expect(contractHashAtMarker({ storageHash: 'a'.repeat(64) })).toBe('a'.repeat(64));
  });

  it.each([null, undefined])('is the empty contract when the marker is %s', (marker) => {
    expect(contractHashAtMarker(marker)).toBe(EMPTY_CONTRACT_HASH);
  });
});
