import pgvector from '@internal/extension-pgvector/runtime';
import {
  extractCodecTypeImports,
  extractParameterizedOutputTypeImports,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { getSqlDescriptorBundle, pgvectorExtensionDescriptor } from '../utils/framework-components';

describe('pgvector extension pack integration', () => {
  it('exposes pgvector descriptor metadata', () => {
    expect(pgvectorExtensionDescriptor.id).toBe('pgvector');
    expect(pgvectorExtensionDescriptor.version).toBe('0.0.1');
  });

  it('extracts codec type imports from descriptors, adapter first', () => {
    const { target, adapter, extensions } = getSqlDescriptorBundle({
      extensions: [pgvectorExtensionDescriptor],
    });

    expect(extractCodecTypeImports([target, adapter, ...extensions])).toEqual([
      { package: '@internal/target-postgres/codec-types', named: 'CodecTypes', alias: 'PgTypes' },
      { package: '@internal/target-postgres/codec-types', named: 'JsonValue', alias: 'JsonValue' },
      {
        package: '@internal/extension-pgvector/codec-types',
        named: 'CodecTypes',
        alias: 'PgVectorTypes',
      },
    ]);
  });

  it('extracts the parameterized output type functions, adapter first', () => {
    const { target, adapter, extensions } = getSqlDescriptorBundle({
      extensions: [pgvectorExtensionDescriptor],
    });

    expect(extractParameterizedOutputTypeImports([target, adapter, ...extensions])).toEqual([
      {
        package: '@internal/target-postgres/codec-types',
        named: 'ParameterizedOutputTypesForTypeParams',
        alias: 'PgParameterizedOutputTypes',
      },
      {
        package: '@internal/extension-pgvector/codec-types',
        named: 'ParameterizedOutputTypesForTypeParams',
        alias: 'PgVectorParameterizedOutputTypes',
      },
    ]);
  });

  it('descriptor contributes the pg/vector@1 codec descriptor', () => {
    const descriptors = pgvector.codecs();
    expect(descriptors).toBeDefined();

    const vectorDescriptor = descriptors.find((d) => d.codecId === 'pg/vector@1');
    expect(vectorDescriptor).toBeDefined();
    expect(vectorDescriptor?.codecId).toBe('pg/vector@1');
    expect(vectorDescriptor?.dataType).toBe('pgvector/vector');
  });

  it('descriptor provides query operations', () => {
    const operations = pgvector.queryOperations!();
    expect(operations).toBeDefined();
    expect(Object.keys(operations).sort()).toEqual(['cosineDistance', 'cosineSimilarity']);
    expect(operations['cosineDistance']).toBeDefined();
    expect(operations['cosineSimilarity']).toBeDefined();
  });

  it('descriptor materializes a runtime codec when factory is called', { timeout: 1_000 }, () => {
    const descriptors = pgvector.codecs();
    const vectorDescriptor = descriptors.find((d) => d.codecId === 'pg/vector@1');
    expect(vectorDescriptor).toBeDefined();

    const codec = vectorDescriptor!.factory({ length: 3 })({ name: '<test>' });
    expect(codec.id).toBe('pg/vector@1');
  });
});
