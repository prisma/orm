import { describe, expect, it } from 'vitest';
import { postgresPslTypeConstructors } from '../src/core/control-mutation-defaults';
import { postgresAdapterDescriptorMeta } from '../src/core/descriptor-meta';
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

describe('precision bounds live on the data type', () => {
  it.each([
    'Timestamp',
    'Timestamptz',
    'Time',
    'Timetz',
    'TimestampString',
    'TimestamptzString',
    'TimeString',
  ] as const)('%s declares no bound of its own on precision', (typeName) => {
    const typeConstructor = postgresPslTypeConstructors[typeName];
    expect(typeConstructor.args?.find((arg) => arg.name === 'precision')).toEqual({
      kind: 'number',
      name: 'precision',
      integer: true,
      optional: true,
    });
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
