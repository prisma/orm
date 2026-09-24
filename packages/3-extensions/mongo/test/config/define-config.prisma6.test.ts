import { describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { prisma6Schema } from '../../src/config/prisma6-schema';

describe('defineConfig with a ContractConfig', () => {
  it('uses a prisma6Schema config as-is and keeps its colocated output', () => {
    const contract = prisma6Schema('prisma/schema.prisma');
    const config = defineConfig({ contract });

    expect(config.contract?.source).toBe(contract.source);
    expect(config.contract?.source.format).toBe('prisma6');
    expect(config.contract?.source.inputs).toEqual(['prisma/schema.prisma']);
    expect(config.contract?.output).toBe('prisma/contract.json');
  });

  it('lets the output directory option override the ContractConfig output', () => {
    const config = defineConfig({
      contract: prisma6Schema('prisma/schema.prisma'),
      output: 'src/generated',
    });
    expect(config.contract?.output).toBe('src/generated/contract.json');
  });

  it('derives the output from the first input when the ContractConfig has none', () => {
    const contract = prisma6Schema('prisma/schema.prisma');
    const config = defineConfig({
      contract: { source: contract.source },
    });
    expect(config.contract?.output).toBe('prisma/schema.json');
  });
});
