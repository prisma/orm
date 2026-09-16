import { describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { prisma7Schema } from '../../src/config/prisma7-schema';

describe('defineConfig with a ContractConfig', () => {
  it('uses a prisma7Schema config as-is and keeps its colocated output', () => {
    const contract = prisma7Schema('prisma/schema.prisma');
    const config = defineConfig({ contract });

    expect(config.contract?.source).toBe(contract.source);
    expect(config.contract?.source.format).toBe('prisma7');
    expect(config.contract?.source.inputs).toEqual(['prisma/schema.prisma']);
    expect(config.contract?.output).toBe('prisma/contract.json');
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
