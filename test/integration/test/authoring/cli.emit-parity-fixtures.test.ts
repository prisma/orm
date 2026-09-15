import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContractSourceContext, PrismaNextConfig } from '@internal/cli/config-types';
import { enrichContract } from '@internal/cli/control-api';
import { loadConfig } from '@internal/config-loader';
import { createControlStack } from '@internal/framework-components/control';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { sqlEmission } from '@internal/sql-contract-emitter';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { emit } from '../../utils/emit';
import { runOnEngine } from '../utils/cli-test-helpers';
import {
  listAuthoringDiagnosticsFixtureCases,
  listAuthoringParityFixtureCases,
  setupIntegrationTestDirectoryForAuthoringParityCase,
} from './authoring-parity-test-helpers';

const writeExpected = process.env['UPDATE_AUTHORING_PARITY_EXPECTED'] === '1';

function sourceContextFromConfig(config: PrismaNextConfig): ContractSourceContext {
  const stack = createControlStack({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    extensions: config.extensions ?? [],
  });
  return {
    composedExtensions: stack.extensions.map((p) => p.id),
    composedExtensionContracts: new Map(),
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs: config.contract?.source.inputs ?? [],
    capabilities: stack.capabilities,
  };
}

function parseContractJson(contractJson: string): Record<string, unknown> {
  return JSON.parse(contractJson) as Record<string, unknown>;
}

function assertContractJsonOmitsSourceProvenance(contractJson: Record<string, unknown>): void {
  expect(contractJson).not.toHaveProperty('sources');
  const meta = contractJson['meta'];
  if (typeof meta === 'object' && meta !== null) {
    expect(meta).not.toHaveProperty('source');
    expect(meta).not.toHaveProperty('sourceId');
    expect(meta).not.toHaveProperty('schemaPath');
  }
}

interface ExpectedDiagnosticsFixture {
  readonly failureSummary: string;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly sourceId: string;
    readonly startLine: number;
  }[];
}

function parseExpectedDiagnosticsFixture(
  expectedDiagnosticsJson: string,
): ExpectedDiagnosticsFixture {
  return JSON.parse(expectedDiagnosticsJson) as ExpectedDiagnosticsFixture;
}

const parityCases = listAuthoringParityFixtureCases();
const diagnosticsCases = listAuthoringDiagnosticsFixtureCases();
const coreSurfaceCase = parityCases.find((fixtureCase) => fixtureCase.caseName === 'core-surface');

if (!coreSurfaceCase) {
  throw new Error('Required parity fixture case "core-surface" not found');
}

describe('emit parity fixtures', () => {
  it('discovers at least one parity fixture case', () => {
    expect(parityCases.length).toBeGreaterThan(0);
  });

  for (const fixtureCase of parityCases) {
    it(`matches ts and psl emission for ${fixtureCase.caseName}`, {
      timeout: timeouts.typeScriptCompilation,
    }, async () => {
      const testSetup = setupIntegrationTestDirectoryForAuthoringParityCase(fixtureCase);

      try {
        const tsConfig = (await loadConfig(testSetup.tsConfigPath)).assertOk().config;
        const pslConfig = (await loadConfig(testSetup.pslConfigPath)).assertOk().config;

        if (!tsConfig.contract || !pslConfig.contract || !tsConfig.driver || !pslConfig.driver) {
          throw new Error('Fixture parity tests require contract + driver in both configs');
        }

        const originalCwd = process.cwd();
        let tsProviderResultFirst: Awaited<ReturnType<typeof tsConfig.contract.source.load>>;
        let tsProviderResultSecond: Awaited<ReturnType<typeof tsConfig.contract.source.load>>;
        let pslProviderResultFirst: Awaited<ReturnType<typeof pslConfig.contract.source.load>>;
        let pslProviderResultSecond: Awaited<ReturnType<typeof pslConfig.contract.source.load>>;
        try {
          process.chdir(testSetup.testDir);
          const tsContext = sourceContextFromConfig(tsConfig);
          const pslContext = sourceContextFromConfig(pslConfig);
          tsProviderResultFirst = await tsConfig.contract.source.load(tsContext);
          tsProviderResultSecond = await tsConfig.contract.source.load(tsContext);
          pslProviderResultFirst = await pslConfig.contract.source.load(pslContext);
          pslProviderResultSecond = await pslConfig.contract.source.load(pslContext);
        } finally {
          process.chdir(originalCwd);
        }

        expect(tsProviderResultSecond).toEqual(tsProviderResultFirst);
        expect(pslProviderResultSecond).toEqual(pslProviderResultFirst);

        if (!tsProviderResultFirst.ok) {
          throw new Error(`TS provider failed: ${tsProviderResultFirst.failure.summary}`);
        }
        if (!pslProviderResultFirst.ok) {
          throw new Error(`PSL provider failed: ${pslProviderResultFirst.failure.summary}`);
        }

        const stack = createControlStack({
          family: tsConfig.family,
          target: tsConfig.target,
          adapter: tsConfig.adapter,
          driver: tsConfig.driver,
          extensions: tsConfig.extensions ?? [],
        });
        const familyInstance = tsConfig.family.create(stack);

        const frameworkComponents = [
          tsConfig.target,
          tsConfig.adapter,
          ...(tsConfig.extensions ?? []),
        ];
        const enrichedTs = enrichContract(tsProviderResultFirst.value, frameworkComponents);
        const enrichedPsl = enrichContract(pslProviderResultFirst.value, frameworkComponents);

        const { contractSerializer } = tsConfig.target;
        const normalizedTs = familyInstance.deserializeContract(
          contractSerializer.serializeContract(enrichedTs),
        );
        const normalizedPsl = familyInstance.deserializeContract(
          contractSerializer.serializeContract(enrichedPsl),
        );
        expect(normalizedTs).toEqual(normalizedPsl);

        const tsEmitFirst = await emit(
          normalizedTs,
          stack,
          sqlEmission,
          sqlContractCanonicalizationHooks,
        );
        const tsEmitSecond = await emit(
          normalizedTs,
          stack,
          sqlEmission,
          sqlContractCanonicalizationHooks,
        );
        const pslEmitFirst = await emit(
          normalizedPsl,
          stack,
          sqlEmission,
          sqlContractCanonicalizationHooks,
        );
        const pslEmitSecond = await emit(
          normalizedPsl,
          stack,
          sqlEmission,
          sqlContractCanonicalizationHooks,
        );

        expect(tsEmitFirst).toMatchObject({
          contractJson: tsEmitSecond.contractJson,
          storageHash: tsEmitSecond.storageHash,
          profileHash: tsEmitSecond.profileHash,
        });
        expect(pslEmitFirst).toMatchObject({
          contractJson: pslEmitSecond.contractJson,
          storageHash: pslEmitSecond.storageHash,
          profileHash: pslEmitSecond.profileHash,
        });

        const tsContractJson = parseContractJson(tsEmitFirst.contractJson);
        const pslContractJson = parseContractJson(pslEmitFirst.contractJson);

        expect(tsContractJson).toEqual(pslContractJson);
        assertContractJsonOmitsSourceProvenance(tsContractJson);

        expect(tsEmitFirst.storageHash).toMatch(/^[a-f0-9]{64}$/);
        expect(tsEmitFirst.profileHash).toMatch(/^[a-f0-9]{64}$/);
        expect(pslEmitFirst.storageHash).toBe(tsEmitFirst.storageHash);
        expect(pslEmitFirst.profileHash).toBe(tsEmitFirst.profileHash);

        const tsExecution = tsContractJson['execution'] as Record<string, unknown> | undefined;
        const pslExecution = pslContractJson['execution'] as Record<string, unknown> | undefined;
        const tsExecutionHash = tsExecution?.['executionHash'];
        const pslExecutionHash = pslExecution?.['executionHash'];
        expect(pslExecutionHash).toBe(tsExecutionHash);
        if (tsExecutionHash !== undefined) {
          expect(typeof tsExecutionHash).toBe('string');
          expect(tsExecutionHash).toMatch(/^[a-f0-9]{64}$/);
        }

        if (writeExpected) {
          writeFileSync(fixtureCase.expectedContractPath, `${tsEmitFirst.contractJson}\n`, 'utf-8');
        }

        const expectedContractJson = parseContractJson(
          readFileSync(fixtureCase.expectedContractPath, 'utf-8'),
        );
        expect(tsContractJson).toEqual(expectedContractJson);
      } finally {
        testSetup.cleanup();
      }
    });
  }
});

describe('emit parity fixture diagnostics', () => {
  it('discovers at least one diagnostics fixture case', () => {
    expect(diagnosticsCases.length).toBeGreaterThan(0);
  });

  for (const diagnosticsCase of diagnosticsCases) {
    it(`reports actionable psl diagnostics for ${diagnosticsCase.caseName}`, {
      timeout: timeouts.typeScriptCompilation,
    }, async () => {
      const testSetup = setupIntegrationTestDirectoryForAuthoringParityCase(coreSurfaceCase);
      const expectedFixture = parseExpectedDiagnosticsFixture(
        readFileSync(diagnosticsCase.expectedDiagnosticsPath, 'utf-8'),
      );

      try {
        writeFileSync(
          join(testSetup.testDir, 'schema.prisma'),
          readFileSync(diagnosticsCase.schemaPath, 'utf-8'),
          'utf-8',
        );

        const pslConfig = (await loadConfig(testSetup.pslConfigPath)).assertOk().config;
        if (!pslConfig.contract) {
          throw new Error('PSL config contract is required for diagnostics fixture test');
        }

        const originalCwd = process.cwd();
        let sourceResult: Awaited<ReturnType<typeof pslConfig.contract.source.load>>;
        try {
          process.chdir(testSetup.testDir);
          sourceResult = await pslConfig.contract.source.load(sourceContextFromConfig(pslConfig));
        } finally {
          process.chdir(originalCwd);
        }
        expect(sourceResult.ok).toBe(false);
        if (sourceResult.ok) {
          throw new Error(`Expected PSL source provider to fail for ${diagnosticsCase.caseName}`);
        }

        expect(sourceResult.failure.summary).toBe(expectedFixture.failureSummary);
        expect(sourceResult.failure.diagnostics).toHaveLength(expectedFixture.diagnostics.length);
        expect(sourceResult.failure.diagnostics).toEqual(
          expect.arrayContaining(
            expectedFixture.diagnostics.map((diagnostic) =>
              expect.objectContaining({
                code: diagnostic.code,
                sourceId: diagnostic.sourceId,
                span: expect.objectContaining({
                  start: expect.objectContaining({
                    line: diagnostic.startLine,
                    column: expect.any(Number),
                  }),
                }),
              }),
            ),
          ),
        );

        const run = await runOnEngine(
          { testDir: testSetup.testDir, configPath: testSetup.pslConfigPath },
          ['contract', 'emit', '--json'],
        );
        const terminal = run.json.at(-1);
        const envelope =
          terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

        expect(run.exitCode).toBe(2);
        expect(envelope).toMatchObject({
          ok: false,
          error: {
            code: 'CONTRACT.SOURCE_LOAD_FAILED',
            why: expect.stringContaining(expectedFixture.failureSummary),
          },
        });
        const reported = JSON.stringify(envelope);
        for (const diagnostic of expectedFixture.diagnostics) {
          expect(reported).toContain(diagnostic.code);
        }
        expect(reported).toMatch(/schema\.prisma:\d+:\d+/);
      } finally {
        testSetup.cleanup();
      }
    });
  }
});
