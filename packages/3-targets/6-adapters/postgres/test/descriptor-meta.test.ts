import { postgresPslTypeConstructors } from '@internal/target-postgres/control';
import { describe, expect, it } from 'vitest';
import { postgresAdapterDescriptorMeta } from '../src/core/descriptor-meta';
import postgresAdapterDescriptor from '../src/exports/control';
import postgresRuntimeAdapterDescriptor from '../src/exports/runtime';

describe('postgresAdapterDescriptorMeta data types', () => {
  it('registers none, because the target registers them', () => {
    expect(postgresAdapterDescriptorMeta).not.toHaveProperty('dataTypes');
  });
});

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

describe('pack metadata types', () => {
  it('declares no storage list, because nothing reads one', () => {
    expect(postgresAdapterDescriptorMeta.types).not.toHaveProperty('storage');
  });
});

describe('postgres adapter query operations', () => {
  // Postgres built-in operations moved to @internal/target-postgres; the adapter contributes none,
  // so a stale slot here would register them twice.
  it('the runtime descriptor contributes no query operations', () => {
    expect(postgresRuntimeAdapterDescriptor.queryOperations).toBeUndefined();
  });

  it('the descriptor meta declares no query-operation type import', () => {
    expect(postgresAdapterDescriptorMeta.types).not.toHaveProperty('queryOperationTypes');
  });
});

describe('the adapter authoring contribution', () => {
  it('contributes the PSL-only type constructors the target defines', () => {
    expect(postgresAdapterDescriptor.authoring?.type).toBe(postgresPslTypeConstructors);
  });

  it('contributes no data type entries, which the target contributes', () => {
    expect(postgresAdapterDescriptor.authoring).not.toHaveProperty('dataTypes');
  });

  it('declares Jsonb as the value-object storage type', () => {
    expect(postgresAdapterDescriptor.authoring?.valueObjectStorageType).toBe('Jsonb');
  });
});
