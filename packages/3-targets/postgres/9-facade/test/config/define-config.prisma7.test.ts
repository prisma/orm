import { describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { prisma7Schema } from '../../src/config/prisma7-schema';

describe('defineConfig with a ContractConfig', () => {
  it('keeps the source fields of a prisma7Schema config, its colocated output, and wraps only its load', () => {
    const contract = prisma7Schema('prisma/schema.prisma');
    const config = defineConfig({ contract });
    const { load: _wrapped, ...kept } = config.contract?.source ?? contract.source;
    const { load: _original, ...given } = contract.source;

    expect({ kept, output: config.contract?.output }).toEqual({
      kept: given,
      output: 'prisma/contract.json',
    });
    expect(given).toMatchObject({ format: 'psl', inputs: ['prisma/schema.prisma'] });
  });

  it('lets the output directory option override the ContractConfig output', () => {
    const config = defineConfig({
      contract: prisma7Schema('prisma/schema.prisma'),
      output: 'src/generated',
    });
    expect(config.contract?.output).toBe('src/generated/contract.json');
  });

  it('derives the output from the first input when the ContractConfig has none', () => {
    const contract = prisma7Schema('prisma/schema.prisma');
    const config = defineConfig({
      contract: { source: contract.source },
    });
    expect(config.contract?.output).toBe('prisma/schema.json');
  });

  it('writes the contract where the top-level output directory says, as the adoption guide sets it', () => {
    const config = defineConfig({
      output: 'generated/prisma8',
      contract: prisma7Schema('prisma/schema.prisma'),
    });
    expect(config.contract?.output).toBe('generated/prisma8/contract.json');
  });
});
