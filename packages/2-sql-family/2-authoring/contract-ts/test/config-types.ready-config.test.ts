import type { ContractConfig, ContractSourceContext } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import type { TargetPackRef } from '@internal/framework-components/components';
import { EMPTY_GENERATOR_FUNCTIONS } from '@internal/framework-components/components';
import { notOk, ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { refuseOtherTargetOnLoad, typescriptContract } from '../src/config-types';

const forPostgres = {
  target: {
    kind: 'target',
    id: 'postgres',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    defaultNamespaceId: 'public',
  } satisfies TargetPackRef<'sql', 'postgres'>,
  contractBuilderModule: '@prisma/orm-postgres/contract-builder',
};

const context: ContractSourceContext = {
  composedExtensions: [],
  defaultNamespaceId: 'public',
  composedExtensionContracts: new Map(),
  authoringContributions: {
    dataTypes: {},
    type: {},
    entityTypes: {},
    pslBlockDescriptors: {},
    modelAttributes: {},
    attributeSpecs: { model: {}, field: {} },
  },
  dataTypes: { entries: {}, lookup: createDataTypeLookup([]), dataTypeOfCodec: () => undefined },
  codecLookup: {
    get: () => undefined,
    renderOutputTypeFor: () => undefined,
    descriptorFor: () => undefined,
  },
  controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
  generatorFunctions: EMPTY_GENERATOR_FUNCTIONS,
  resolvedInputs: [],
  capabilities: {},
};

const contractFor = (target: string) =>
  ({ targetFamily: 'sql', target, storage: { namespaces: {} } }) as Contract;

const pslConfigOf = (contract: Contract): ContractConfig => ({
  source: {
    format: 'psl',
    inputs: ['./prisma/schema.prisma'],
    parserOptions: { grammar: 'prisma-7' },
    load: async () => ok(contract),
  },
  output: './prisma/contract.json',
});

const refusalOf = async (config: ContractConfig) =>
  refuseOtherTargetOnLoad(config, forPostgres)
    .source.load(context)
    .then(
      () => undefined,
      (error) => ({
        code: Object(error).code,
        message: Object(error).message,
        why: Object(error).why,
        fix: Object(error).fix,
        meta: Object(error).meta,
      }),
    );

describe('refuseOtherTargetOnLoad', () => {
  it('refuses a ready TypeScript contract built for another target, which names no file', async () => {
    expect(await refusalOf(typescriptContract(contractFor('mysql')))).toEqual({
      code: 'CONTRACT.TARGET_MISMATCH',
      message:
        'The TypeScript contract passed to defineConfig was built for target "mysql", but this defineConfig is for target "postgres".',
      why: "Its defineContract came from another target's contract-builder entry, so the contract carries that target's id and capabilities.",
      fix: 'Import defineContract from @prisma/orm-postgres/contract-builder.',
      meta: { expected: 'postgres', actual: 'mysql' },
    });
  });

  it('refuses a ready Prisma schema contract built for another target, naming its first input', async () => {
    expect(await refusalOf(pslConfigOf(contractFor('sqlite')))).toEqual({
      code: 'CONTRACT.TARGET_MISMATCH',
      message:
        'The contract "./prisma/schema.prisma" was built for target "sqlite", but this defineConfig is for target "postgres".',
      why: "Its contract config was made with another target's components, so the contract carries that target's id and capabilities.",
      fix: "Make the contract config with postgres's components, or pass the schema's path as `contract`.",
      meta: { contract: './prisma/schema.prisma', expected: 'postgres', actual: 'sqlite' },
    });
  });

  it('loads a contract built for the target unchanged, and keeps the rest of the config', async () => {
    const contract = contractFor('postgres');
    const config = refuseOtherTargetOnLoad(pslConfigOf(contract), forPostgres);
    const result = await config.source.load(context);
    expect({
      loaded: result.ok ? result.value : result.failure,
      format: config.source.format,
      inputs: config.source.inputs,
      parserOptions: config.source.format === 'psl' ? config.source.parserOptions : undefined,
      output: config.output,
    }).toEqual({
      loaded: contract,
      format: 'psl',
      inputs: ['./prisma/schema.prisma'],
      parserOptions: { grammar: 'prisma-7' },
      output: './prisma/contract.json',
    });
  });

  it('passes a failed load through unchanged', async () => {
    const failed = notOk({ summary: 'schema did not parse', diagnostics: [] });
    const config = refuseOtherTargetOnLoad(
      { source: { format: 'psl', load: async () => failed } },
      forPostgres,
    );
    expect(await config.source.load(context)).toBe(failed);
  });

  it('calls the original load as a method of its source', async () => {
    const source = {
      format: 'typescript' as const,
      contract: contractFor('postgres'),
      async load() {
        return ok(this.contract);
      },
    };
    const result = await refuseOtherTargetOnLoad({ source }, forPostgres).source.load(context);
    expect(result.ok ? result.value : result.failure).toBe(source.contract);
  });
});
