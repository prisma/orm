import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ContractSourceContext } from '@internal/cli/config-types';
import { loadConfig, type PrismaNextConfig } from '@internal/config-loader';
import type { ControlStack } from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { sqlEmission } from '@internal/sql-contract-emitter';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emit } from '../utils/emit';
import { setupIntegrationTestDirectoryFromFixtures } from './utils/cli-test-helpers';

const fixtureSubdir = 'emit-contract';

function buildControlStack(config: PrismaNextConfig) {
  return createControlStack({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    driver: config.driver,
    extensions: config.extensions ?? [],
  });
}

function buildSourceContext(
  stack: ControlStack,
  resolvedInputs: readonly string[] = [],
): ContractSourceContext {
  return {
    composedExtensions: stack.extensions.map((p) => p.id),
    composedExtensionContracts: new Map(),
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    dataTypeLookup: stack.dataTypeLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs,
    capabilities: stack.capabilities,
  };
}

const resolveContract = async (
  source: NonNullable<PrismaNextConfig['contract']>['source'],
  stack: ControlStack,
) => {
  const sourceResult = await source.load(buildSourceContext(stack, source.inputs ?? []));
  if (!sourceResult.ok) {
    throw new Error(sourceResult.failure.summary);
  }
  return sourceResult.value;
};

describe('emitContract API', () => {
  let testDir: string;
  let configPath: string;
  let cleanupDir: () => void;

  beforeEach(() => {
    const testSetup = setupIntegrationTestDirectoryFromFixtures(fixtureSubdir);
    testDir = testSetup.testDir;
    configPath = testSetup.configPath;
    cleanupDir = testSetup.cleanup;
  });

  afterEach(() => {
    cleanupDir();
  });

  it(
    'emits contract.json and contract.d.ts with resolved values',
    async () => {
      const config = (await loadConfig(configPath)).assertOk().config;
      if (!config.contract) {
        throw new Error('Config.contract is required');
      }

      const contractConfig = config.contract;
      const stack = buildControlStack(config);
      const contractRaw = await resolveContract(contractConfig.source, stack);

      if (!contractConfig.output) {
        throw new Error('Contract config must have output path');
      }

      const result = await emit(contractRaw, stack, sqlEmission, {
        serializeContract: (c) => config.target.contractSerializer.serializeContract(c),
        ...sqlContractCanonicalizationHooks,
      });

      expect(result).toBeDefined();
      expect(result.storageHash).toBeDefined();
      expect(result.profileHash).toBeDefined();
      expect(result.contractJson).toBeDefined();
      expect(result.contractDts).toBeDefined();

      const contractJsonPath = resolve(testDir, contractConfig.output);
      const contractDtsPath = contractJsonPath.replace(/\.json$/, '.d.ts');
      mkdirSync(dirname(contractJsonPath), { recursive: true });
      writeFileSync(contractJsonPath, result.contractJson, 'utf-8');
      writeFileSync(contractDtsPath, result.contractDts, 'utf-8');

      expect(existsSync(contractJsonPath)).toBe(true);
      expect(existsSync(contractDtsPath)).toBe(true);

      const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
      expect(contractJson).toMatchObject({
        targetFamily: 'sql',
        _generated: expect.anything(),
      });

      const contractDts = readFileSync(contractDtsPath, 'utf-8');
      expect(contractDts).toContain('export type Contract');
      expect(contractDts).toContain('CodecTypes');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'uses config paths for output',
    async () => {
      const config = (await loadConfig(configPath)).assertOk().config;
      if (!config.contract) {
        throw new Error('Config.contract is required');
      }

      const contractConfig = config.contract;
      const stack = buildControlStack(config);
      const contractRaw = await resolveContract(contractConfig.source, stack);

      if (!contractConfig.output) {
        throw new Error('Contract config must have output path');
      }

      const result = await emit(contractRaw, stack, sqlEmission, {
        serializeContract: (c) => config.target.contractSerializer.serializeContract(c),
        ...sqlContractCanonicalizationHooks,
      });

      const contractJsonPath = resolve(testDir, contractConfig.output);
      const contractDtsPath = contractJsonPath.replace(/\.json$/, '.d.ts');
      mkdirSync(dirname(contractJsonPath), { recursive: true });
      writeFileSync(contractJsonPath, result.contractJson, 'utf-8');
      writeFileSync(contractDtsPath, result.contractDts, 'utf-8');
      expect(contractJsonPath).toContain('output/contract.json');
      expect(contractDtsPath).toContain('output/contract.d.ts');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'creates output directory if it does not exist',
    async () => {
      const newOutputDir = join(testDir, 'new-output');
      const testSetup = setupIntegrationTestDirectoryFromFixtures(
        fixtureSubdir,
        'prisma.config.custom-output.ts',
        { '{{OUTPUT_DIR}}': newOutputDir },
      );
      const customTestDir = testSetup.testDir;
      const customConfigPath = testSetup.configPath;
      const customCleanup = testSetup.cleanup;

      try {
        const config = (await loadConfig(customConfigPath)).assertOk().config;
        if (!config.contract) {
          throw new Error('Config.contract is required');
        }

        const contractConfig = config.contract;
        const stack = buildControlStack(config);
        const contractRaw = await resolveContract(contractConfig.source, stack);

        if (!contractConfig.output) {
          throw new Error('Contract config must have output path');
        }

        const result = await emit(contractRaw, stack, sqlEmission, {
          serializeContract: (c) => config.target.contractSerializer.serializeContract(c),
          ...sqlContractCanonicalizationHooks,
        });

        const contractJsonPath = resolve(customTestDir, contractConfig.output);
        const contractDtsPath = contractJsonPath.replace(/\.json$/, '.d.ts');
        mkdirSync(dirname(contractJsonPath), { recursive: true });
        writeFileSync(contractJsonPath, result.contractJson, 'utf-8');
        writeFileSync(contractDtsPath, result.contractDts, 'utf-8');
        expect(existsSync(newOutputDir)).toBe(true);
        expect(existsSync(contractJsonPath)).toBe(true);
        expect(existsSync(contractDtsPath)).toBe(true);
      } finally {
        customCleanup();
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'includes profileHash when present',
    async () => {
      const config = (await loadConfig(configPath)).assertOk().config;
      if (!config.contract) {
        throw new Error('Config.contract is required');
      }

      const contractConfig = config.contract;
      const stack = buildControlStack(config);
      const contractRaw = await resolveContract(contractConfig.source, stack);

      if (!contractConfig.output) {
        throw new Error('Contract config must have output path');
      }

      const result = await emit(contractRaw, stack, sqlEmission, {
        serializeContract: (c) => config.target.contractSerializer.serializeContract(c),
        ...sqlContractCanonicalizationHooks,
      });

      expect(typeof result.profileHash).toBe('string');
      expect(result.profileHash.length).toBeGreaterThan(0);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'returns a complete result object',
    async () => {
      const config = (await loadConfig(configPath)).assertOk().config;
      if (!config.contract) {
        throw new Error('Config.contract is required');
      }

      const contractConfig = config.contract;
      const stack = buildControlStack(config);
      const contractRaw = await resolveContract(contractConfig.source, stack);

      if (!contractConfig.output) {
        throw new Error('Contract config must have output path');
      }

      const result = await emit(contractRaw, stack, sqlEmission, {
        serializeContract: (c) => config.target.contractSerializer.serializeContract(c),
        ...sqlContractCanonicalizationHooks,
      });

      expect(result.storageHash).toBeDefined();
      expect(result.contractJson).toBeDefined();
      expect(result.contractDts).toBeDefined();
    },
    timeouts.typeScriptCompilation,
  );
});
