import { describe, expect, it } from 'vitest';
import {
  CODEC_INSTANCE_KIND,
  isStorageTypeInstance,
  toStorageTypeInstance,
} from '../src/ir/storage-type-instance';

describe('toStorageTypeInstance', () => {
  it('stamps the kind discriminator and defaults typeParams to {}', () => {
    const result = toStorageTypeInstance({ codecId: 'pg/int4@1', nativeType: 'int4' });
    expect(result).toEqual({
      kind: 'codec-instance',
      codecId: 'pg/int4@1',
      nativeType: 'int4',
      typeParams: {},
    });
  });

  it('preserves provided typeParams', () => {
    const result = toStorageTypeInstance({
      codecId: 'pg/varchar@1',
      nativeType: 'varchar',
      typeParams: { length: 255 },
    });
    expect(result.typeParams).toEqual({ length: 255 });
  });

  it('is idempotent when input already carries the discriminator', () => {
    const input = {
      kind: CODEC_INSTANCE_KIND,
      codecId: 'pg/int4@1',
      nativeType: 'int4',
      typeParams: {},
    };
    const result = toStorageTypeInstance(input as never);
    expect(result).toEqual(input);
  });
});

describe('isStorageTypeInstance', () => {
  it('returns true for a real StorageTypeInstance', () => {
    const instance = toStorageTypeInstance({ codecId: 'pg/int4@1', nativeType: 'int4' });
    expect(isStorageTypeInstance(instance)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isStorageTypeInstance(null)).toBe(false);
  });

  it('returns false for a non-object primitive', () => {
    expect(isStorageTypeInstance('not-an-instance')).toBe(false);
  });

  it('returns false for a plain object with a different kind', () => {
    expect(isStorageTypeInstance({ kind: 'postgres-enum' })).toBe(false);
  });

  it('returns false for a plain object with no kind', () => {
    expect(isStorageTypeInstance({ codecId: 'pg/int4@1' })).toBe(false);
  });
});
