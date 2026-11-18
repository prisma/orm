import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { parseContractMarkerRow } from '../src/core/verify';

describe('marker parser', () => {
  it('parses valid marker row with all fields', () => {
    const row = {
      core_hash: 'abc123',
      profile_hash: 'def456',
      contract_json: { target: 'postgres' },
      canonical_version: 1,
      updated_at: new Date('2024-01-01T00:00:00Z'),
      app_tag: 'my-app',
      meta: { key: 'value' },
      invariants: ['alpha', 'beta'],
    };

    const result = parseContractMarkerRow(row);

    expect(result).toEqual({
      storageHash: 'abc123',
      profileHash: 'def456',
      contractJson: { target: 'postgres' },
      canonicalVersion: 1,
      updatedAt: new Date('2024-01-01T00:00:00Z'),
      appTag: 'my-app',
      meta: { key: 'value' },
      invariants: ['alpha', 'beta'],
    });
  });

  it('parses marker row with minimal fields', () => {
    const row = {
      core_hash: 'abc123',
      profile_hash: 'def456',
      invariants: [],
    };

    const result = parseContractMarkerRow(row);

    expect(result).toEqual({
      storageHash: 'abc123',
      profileHash: 'def456',
      contractJson: null,
      canonicalVersion: null,
      updatedAt: expect.any(Date),
      appTag: null,
      meta: {},
      invariants: [],
    });
  });

  it('parses updated_at as string', () => {
    const row = {
      core_hash: 'abc123',
      profile_hash: 'def456',
      updated_at: '2024-01-01T00:00:00Z',
      invariants: [],
    };

    const result = parseContractMarkerRow(row);

    expect(result.updatedAt).toEqual(new Date('2024-01-01T00:00:00Z'));
  });

  it('parses meta as JSON string', () => {
    const row = {
      core_hash: 'abc123',
      profile_hash: 'def456',
      meta: '{"key":"value"}',
      invariants: [],
    };

    const result = parseContractMarkerRow(row);

    expect(result.meta).toEqual({ key: 'value' });
  });

  it('parses meta as object', () => {
    const row = {
      core_hash: 'abc123',
      profile_hash: 'def456',
      meta: { key: 'value' },
      invariants: [],
    };

    const result = parseContractMarkerRow(row);

    expect(result.meta).toEqual({ key: 'value' });
  });

  it('handles null meta', () => {
    const row = {
      core_hash: 'abc123',
      profile_hash: 'def456',
      meta: null,
      invariants: [],
    };

    const result = parseContractMarkerRow(row);

    expect(result.meta).toEqual({});
  });

  it('handles undefined meta', () => {
    const row = {
      core_hash: 'abc123',
      profile_hash: 'def456',
      invariants: [],
    };

    const result = parseContractMarkerRow(row);

    expect(result.meta).toEqual({});
  });

  it('handles invalid JSON string in meta', () => {
    const row = {
      core_hash: 'abc123',
      profile_hash: 'def456',
      meta: 'invalid json',
      invariants: [],
    };

    const result = parseContractMarkerRow(row);

    expect(result.meta).toEqual({});
  });

  it('handles invalid meta object structure', () => {
    const row = {
      core_hash: 'abc123',
      profile_hash: 'def456',
      meta: 'not an object',
      invariants: [],
    };

    const result = parseContractMarkerRow(row);

    expect(result.meta).toEqual({});
  });

  it('handles meta that fails Arktype validation', () => {
    // Provide a number as meta (after JSON parsing), which should fail MetaSchema validation
    // MetaSchema expects an object with string keys, not a primitive
    const row = {
      core_hash: 'abc123',
      profile_hash: 'def456',
      meta: '123', // JSON string that parses to a number
      invariants: [],
    };

    // This tests the branch where MetaSchema validation fails (line 33)
    // The number will be parsed from JSON, but MetaSchema expects an object
    const result = parseContractMarkerRow(row);

    // Validation should fail and return empty object
    expect(result.meta).toEqual({});
  });

  it('raises CONTRACT.MARKER_ROW_CORRUPT for an invalid row', () => {
    const row = {
      core_hash: 123,
      profile_hash: 'def456',
    };

    const error = (() => {
      try {
        parseContractMarkerRow(row);
        return undefined;
      } catch (err) {
        return err;
      }
    })();
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.MARKER_ROW_CORRUPT',
      message: expect.stringContaining('Invalid contract marker row'),
    });
  });

  it('carries typed nextActions whose command writes {bin}, not a literal binary', () => {
    const error = (() => {
      try {
        parseContractMarkerRow({ core_hash: 123, profile_hash: 'def456' });
        return undefined;
      } catch (err) {
        return err;
      }
    })();

    expect(error).toMatchObject({
      fix: 'Re-sign the database with `prisma db sign`, or repair the marker table.',
      nextActions: [
        { kind: 'run-command', label: 'Re-sign the database', command: '{bin} db sign' },
        {
          kind: 'user-choice',
          label: 'Repair the marker table by hand',
          reason: expect.stringContaining('core_hash'),
        },
      ],
    });
  });

  it('throws error for missing required fields', () => {
    const row = {
      profile_hash: 'def456',
      // Missing core_hash
    };

    expect(() => parseContractMarkerRow(row)).toThrow('Invalid contract marker row');
  });

  it('throws when invariants is missing (DDL guarantees the column is not null)', () => {
    // The column ships `not null default '{}'`; a row missing the field
    // signals storage corruption or a schema downgrade — don't silently
    // coerce to [].
    const row = {
      core_hash: 'abc123',
      profile_hash: 'def456',
    };

    expect(() => parseContractMarkerRow(row)).toThrow('Invalid contract marker row');
  });

  it('throws when invariants is null (column is non-nullable)', () => {
    // Same rationale as the missing-field case: a NULL would only appear
    // under storage corruption.
    const row = {
      core_hash: 'abc123',
      profile_hash: 'def456',
      invariants: null,
    };

    expect(() => parseContractMarkerRow(row)).toThrow('Invalid contract marker row');
  });
});
