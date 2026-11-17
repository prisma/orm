import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { parseMongoMarkerDoc } from '../src/core/marker-ledger';

describe('parseMongoMarkerDoc', () => {
  it('parses a valid marker doc', () => {
    const record = parseMongoMarkerDoc({
      space: 'app',
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
    });
    expect(record).toMatchObject({
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
      contractJson: null,
    });
  });

  it('throws CONTRACT.MARKER_ROW_CORRUPT on an invalid marker doc', () => {
    let caught: unknown;
    try {
      parseMongoMarkerDoc({ space: 'app' });
    } catch (err) {
      caught = err;
    }
    expect(isStructuredError(caught)).toBe(true);
    if (!isStructuredError(caught)) return;
    expect(caught.code).toBe('CONTRACT.MARKER_ROW_CORRUPT');
    expect(caught.message).toMatch(/^Invalid marker doc on _prisma_migrations:/);
  });
});
