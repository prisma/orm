import { describe, expect, it } from 'vitest';
import { postgresAdapterDescriptorMeta } from '../src/core/descriptor-meta';

const storage = postgresAdapterDescriptorMeta.types.storage;

type ExpandFn = (input: { nativeType: string; typeParams?: Record<string, unknown> }) => string;
type HooksMap = Record<string, { expandNativeType: ExpandFn }>;

const hooks = postgresAdapterDescriptorMeta.types.codecTypes.controlPlaneHooks as HooksMap;

describe('postgresAdapterDescriptorMeta capabilities', () => {
  it('descriptor reports sql.scalarList capability', () => {
    expect(postgresAdapterDescriptorMeta.capabilities['sql']).toMatchObject({ scalarList: true });
  });

  it('descriptor reports sql.checkConstraint capability', () => {
    expect(postgresAdapterDescriptorMeta.capabilities['sql']).toMatchObject({
      checkConstraint: true,
    });
  });
});

describe('expandNativeType hooks via descriptor-meta', () => {
  const lengthCodecIds = [
    'sql/char@1',
    'sql/varchar@1',
    'pg/char@1',
    'pg/varchar@1',
    'pg/bit@1',
    'pg/varbit@1',
  ] as const;

  describe('expandLength', () => {
    for (const codecId of lengthCodecIds) {
      describe(codecId, () => {
        const expand = hooks[codecId]!.expandNativeType;

        it('appends length param to native type', () => {
          expect(expand({ nativeType: 'character', typeParams: { length: 10 } })).toBe(
            'character(10)',
          );
        });

        it('returns bare native type when typeParams is missing', () => {
          expect(expand({ nativeType: 'character' })).toBe('character');
        });

        it('returns bare native type when length is absent', () => {
          expect(expand({ nativeType: 'character', typeParams: {} })).toBe('character');
        });

        it('throws for non-integer length', () => {
          expect(() => expand({ nativeType: 'character', typeParams: { length: 1.5 } })).toThrow(
            'Invalid "length" type parameter',
          );
        });

        it('throws for zero length', () => {
          expect(() => expand({ nativeType: 'character', typeParams: { length: 0 } })).toThrow(
            'Invalid "length" type parameter',
          );
        });

        it('throws for negative length', () => {
          expect(() => expand({ nativeType: 'character', typeParams: { length: -1 } })).toThrow(
            'Invalid "length" type parameter',
          );
        });

        it('throws for non-number length', () => {
          expect(() => expand({ nativeType: 'character', typeParams: { length: 'big' } })).toThrow(
            'Invalid "length" type parameter',
          );
        });
      });
    }
  });

  const precisionCodecIds = [
    'pg/timestamp-temporal@1',
    'pg/timestamptz-temporal@1',
    'pg/time-temporal@1',
    'pg/timestamp-string@1',
    'pg/timestamptz-string@1',
    'pg/time-string@1',
    'pg/timetz@1',
    'pg/interval@1',
  ] as const;

  describe('expandPrecision', () => {
    for (const codecId of precisionCodecIds) {
      describe(codecId, () => {
        const expand = hooks[codecId]!.expandNativeType;

        it('appends precision param to native type', () => {
          expect(expand({ nativeType: 'timestamp', typeParams: { precision: 3 } })).toBe(
            'timestamp(3)',
          );
        });

        it('returns bare native type when typeParams is missing', () => {
          expect(expand({ nativeType: 'timestamp' })).toBe('timestamp');
        });

        it('returns bare native type when precision is absent', () => {
          expect(expand({ nativeType: 'timestamp', typeParams: {} })).toBe('timestamp');
        });

        it('throws for non-integer precision', () => {
          expect(() => expand({ nativeType: 'timestamp', typeParams: { precision: 2.5 } })).toThrow(
            'Invalid "precision" type parameter',
          );
        });

        it('throws for zero precision', () => {
          expect(() => expand({ nativeType: 'timestamp', typeParams: { precision: 0 } })).toThrow(
            'Invalid "precision" type parameter',
          );
        });

        it('throws for negative precision', () => {
          expect(() => expand({ nativeType: 'timestamp', typeParams: { precision: -1 } })).toThrow(
            'Invalid "precision" type parameter',
          );
        });
      });
    }
  });

  describe('expandNumeric (pg/numeric@1)', () => {
    const expand = hooks['pg/numeric@1']!.expandNativeType;

    it('appends precision only when scale is absent', () => {
      expect(expand({ nativeType: 'numeric', typeParams: { precision: 10 } })).toBe('numeric(10)');
    });

    it('appends precision and scale when both are present', () => {
      expect(expand({ nativeType: 'numeric', typeParams: { precision: 10, scale: 2 } })).toBe(
        'numeric(10,2)',
      );
    });

    it('returns bare native type when typeParams is missing', () => {
      expect(expand({ nativeType: 'numeric' })).toBe('numeric');
    });

    it('returns bare native type when precision is absent', () => {
      expect(expand({ nativeType: 'numeric', typeParams: {} })).toBe('numeric');
    });

    it('accepts zero scale with valid precision', () => {
      expect(expand({ nativeType: 'numeric', typeParams: { precision: 10, scale: 0 } })).toBe(
        'numeric(10,0)',
      );
    });

    it('throws when scale is declared without precision', () => {
      expect(() => expand({ nativeType: 'numeric', typeParams: { scale: 2 } })).toThrow(
        '"scale" requires "precision"',
      );
    });

    it('throws for zero precision', () => {
      expect(() => expand({ nativeType: 'numeric', typeParams: { precision: 0 } })).toThrow(
        'Invalid "precision" type parameter',
      );
    });

    it('throws for negative precision', () => {
      expect(() => expand({ nativeType: 'numeric', typeParams: { precision: -5 } })).toThrow(
        'Invalid "precision" type parameter',
      );
    });

    it('throws for non-integer scale', () => {
      expect(() =>
        expand({ nativeType: 'numeric', typeParams: { precision: 10, scale: 1.5 } }),
      ).toThrow('Invalid "scale" type parameter');
    });
  });

  describe('identityHooks', () => {
    const identityCodecIds = [
      'pg/json@1',
      'pg/jsonb@1',
      'pg/bytea@1',
      'pg/uuid@1',
      'pg/inet@1',
    ] as const;

    for (const codecId of identityCodecIds) {
      it(`${codecId} returns nativeType unchanged`, () => {
        const expand = hooks[codecId]!.expandNativeType;
        expect(expand({ nativeType: 'uuid' })).toBe('uuid');
        expect(expand({ nativeType: 'uuid', typeParams: {} })).toBe('uuid');
      });
    }
  });
});

describe('storage entries', () => {
  it('includes pg/uuid@1 with nativeType uuid', () => {
    expect(storage).toEqual(
      expect.arrayContaining([
        { typeId: 'pg/uuid@1', familyId: 'sql', targetId: 'postgres', nativeType: 'uuid' },
      ]),
    );
  });

  it('includes pg/inet@1 with nativeType inet', () => {
    expect(storage).toEqual(
      expect.arrayContaining([
        { typeId: 'pg/inet@1', familyId: 'sql', targetId: 'postgres', nativeType: 'inet' },
      ]),
    );
  });

  it('includes pg/bytea@1 with nativeType bytea', () => {
    expect(storage).toEqual(
      expect.arrayContaining([
        { typeId: 'pg/bytea@1', familyId: 'sql', targetId: 'postgres', nativeType: 'bytea' },
      ]),
    );
  });
});
