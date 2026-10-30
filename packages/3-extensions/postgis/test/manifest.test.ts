import { describe, expect, it } from 'vitest';
import { postgisExtensionDescriptor } from '../src/exports/control';

describe('postgis descriptor', () => {
  it('has correct metadata', () => {
    expect(postgisExtensionDescriptor.id).toBe('postgis');
    expect(postgisExtensionDescriptor.version).toBe('0.0.1');
    expect(postgisExtensionDescriptor.familyId).toBe('sql');
    expect(postgisExtensionDescriptor.targetId).toBe('postgres');
    const postgresCapabilities = postgisExtensionDescriptor.capabilities?.['postgres'] as
      | Record<string, unknown>
      | undefined;
    expect(postgresCapabilities?.['postgis.geometry']).toBe(true);
  });

  it('has codec types import', () => {
    expect(postgisExtensionDescriptor.types?.codecTypes?.import).toEqual({
      package: '@internal/extension-postgis/codec-types',
      named: 'CodecTypes',
      alias: 'PostgisTypes',
    });
  });

  it('has query operation types import', () => {
    expect(postgisExtensionDescriptor.types?.queryOperationTypes?.import).toEqual({
      package: '@internal/extension-postgis/operation-types',
      named: 'QueryOperationTypes',
      alias: 'PostgisQueryOperationTypes',
    });
  });
});
