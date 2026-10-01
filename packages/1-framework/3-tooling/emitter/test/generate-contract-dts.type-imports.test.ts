import type { TypesImportSpec } from '@internal/framework-components/emission';
import { describe, expect, it } from 'vitest';
import { generateContractDts } from '../src/generate-contract-dts';
import { createMockSpi } from './mock-spi';
import { createTestContract } from './utils';

const HASHES = {
  storageHash: '0000000000000000000000000000000000000000000000000000000000000001',
  profileHash: '0000000000000000000000000000000000000000000000000000000000000002',
};

const CODEC_TYPES: TypesImportSpec = {
  package: '@internal/demo/codec-types',
  named: 'CodecTypes',
  alias: 'DemoTypes',
};

const VECTOR: TypesImportSpec = {
  package: '@internal/demo/codec-types',
  named: 'Vector',
  alias: 'Vector',
};

function importLines(dts: string): string {
  return dts.slice(0, dts.indexOf('export type'));
}

describe('generateContractDts codec type imports', () => {
  it('leaves out a helper type the contract does not use', () => {
    const dts = generateContractDts(
      createTestContract(),
      createMockSpi(),
      [CODEC_TYPES, VECTOR],
      HASHES,
    );

    expect(importLines(dts)).toContain('CodecTypes as DemoTypes');
    expect(importLines(dts)).not.toMatch(/\bVector\b/);
  });

  it('imports a helper type the contract uses', () => {
    const spi = createMockSpi({
      getStorageTypeExports: () => 'export type Embedding = Vector<3>;',
    });

    const dts = generateContractDts(createTestContract(), spi, [CODEC_TYPES, VECTOR], HASHES);

    expect(importLines(dts)).toMatch(/\bVector\b/);
  });
});
