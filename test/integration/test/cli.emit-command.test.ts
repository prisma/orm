import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '@internal/config-loader';
import { createControlStack } from '@internal/framework-components/control';
import type { CompletedEnvelope, ErroredEnvelope } from '@prisma/cli-engine';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type EngineRunResult,
  integrationFixtureAppDir,
  runOnEngine,
  setupIntegrationTestDirectoryFromFixtures,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';

// The 'emit-command' fixtures drive the config-shape and provider cases;
// the 'emit' fixtures drive the canonical end-to-end command runs.
const fixtureSubdir = 'emit-command';
const emitFixtureSubdir = 'emit';

/** What the run settled with, read off the terminal frame of the json stream. */
function settledEnvelope(run: EngineRunResult): CompletedEnvelope | ErroredEnvelope | undefined {
  const terminal = run.json.at(-1);
  return terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
}

describe('emit command', () => {
  let setup: ReturnType<typeof setupIntegrationTestDirectoryFromFixtures>;

  beforeEach(() => {
    setup = setupIntegrationTestDirectoryFromFixtures(fixtureSubdir);
  });

  afterEach(() => {
    setup.cleanup();
  });

  it('emits contract.json and contract.d.ts with valid contract', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const run = await runOnEngine(setup, ['contract', 'emit', '--json']);
    expect(run.exitCode).toBe(0);

    const contractJsonPath = join(setup.outputDir, 'contract.json');
    const contractDtsPath = join(setup.outputDir, 'contract.d.ts');

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

    expect(run.presented?.data).toMatchObject({
      ok: true,
      storageHash: expect.any(String),
      outDir: expect.any(String),
      files: {
        json: expect.any(String),
        dts: expect.any(String),
      },
      timings: {
        total: expect.any(Number),
      },
    });
  });

  it('creates output directory if it does not exist', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const newOutputDir = join(setup.testDir, 'new-output');
    // Test with custom output path in config
    const customSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma.config.custom-output.ts',
      { '{{OUTPUT_DIR}}': newOutputDir },
    );

    try {
      const run = await runOnEngine(customSetup, ['contract', 'emit']);
      expect(run.exitCode).toBe(0);

      expect(existsSync(newOutputDir)).toBe(true);
      expect(existsSync(join(newOutputDir, 'contract.json'))).toBe(true);
      expect(existsSync(join(newOutputDir, 'contract.d.ts'))).toBe(true);
    } finally {
      customSetup.cleanup();
    }
  });

  it('handles missing contract in config', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const noContractSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma.config.no-contract.ts',
    );

    try {
      const run = await runOnEngine(noContractSetup, ['contract', 'emit', '--json']);
      expect(run.exitCode).toBe(2);

      const envelope = settledEnvelope(run);
      expect(envelope).toMatchObject({
        ok: false,
        error: {
          code: 'CONFIG.CONTRACT_MISSING',
          summary: expect.any(String),
          why: expect.any(String),
        },
      });
      expect(envelope?.nextActions.length).toBeGreaterThan(0);
    } finally {
      noContractSetup.cleanup();
    }
  });

  it('uses default output path when not specified in contract config', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const defaultsSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma.config.defaults.ts',
    );

    try {
      const run = await runOnEngine(defaultsSetup, ['contract', 'emit']);
      expect(run.exitCode).toBe(0);

      // Default output is 'src/prisma/contract.json'
      const defaultJsonPath = join(defaultsSetup.testDir, 'src/prisma/contract.json');
      const defaultDtsPath = join(defaultsSetup.testDir, 'src/prisma/contract.d.ts');
      expect(existsSync(defaultJsonPath)).toBe(true);
      expect(existsSync(defaultDtsPath)).toBe(true);
    } finally {
      defaultsSetup.cleanup();
    }
  });

  it('handles invalid contract in config', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const invalidSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma.config.invalid-contract.ts',
    );

    try {
      const run = await runOnEngine(invalidSetup, ['contract', 'emit', '--json']);
      expect(run.exitCode).toBe(2);
      expect(settledEnvelope(run)).toMatchObject({
        ok: false,
        error: { code: 'CLI.UNEXPECTED', summary: expect.any(String) },
      });
    } finally {
      invalidSetup.cleanup();
    }
  });

  it('handles unsupported target family', { timeout: timeouts.typeScriptCompilation }, async () => {
    const documentSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma.config.document-family.ts',
    );

    try {
      const run = await runOnEngine(documentSetup, ['contract', 'emit', '--json']);
      expect(run.exitCode).toBe(2);
      const envelope = settledEnvelope(run);
      expect(envelope).toMatchObject({
        ok: false,
        error: { code: 'CLI.CONFIG_SECTION_INVALID', summary: expect.any(String) },
      });
      expect(envelope?.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONFIG.VALIDATION_FAILED' })]),
      );
    } finally {
      documentSetup.cleanup();
    }
  });

  it('handles extension paths', { timeout: timeouts.typeScriptCompilation }, async () => {
    // Extensions are now in config, so we just need a valid config
    const run = await runOnEngine(setup, ['contract', 'emit']);
    expect(run.exitCode).toBe(0);

    const contractJsonPath = join(setup.outputDir, 'contract.json');
    expect(existsSync(contractJsonPath)).toBe(true);
  });

  it('handles single string extension path', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    // Extensions are now in config
    const run = await runOnEngine(setup, ['contract', 'emit']);
    expect(run.exitCode).toBe(0);

    const contractJsonPath = join(setup.outputDir, 'contract.json');
    expect(existsSync(contractJsonPath)).toBe(true);
  });

  it('handles multiple extension paths', { timeout: timeouts.typeScriptCompilation }, async () => {
    // Extensions are now in config
    const run = await runOnEngine(setup, ['contract', 'emit']);
    expect(run.exitCode).toBe(0);

    const contractJsonPath = join(setup.outputDir, 'contract.json');
    expect(existsSync(contractJsonPath)).toBe(true);
  });

  it('outputs profileHash when present', { timeout: timeouts.typeScriptCompilation }, async () => {
    const run = await runOnEngine(setup, ['contract', 'emit', '--json']);
    expect(run.exitCode).toBe(0);

    const contractJsonPath = join(setup.outputDir, 'contract.json');
    expect(existsSync(contractJsonPath)).toBe(true);

    expect(run.presented?.data).toMatchObject({
      ok: true,
      storageHash: expect.any(String),
      profileHash: expect.any(String),
      outDir: expect.any(String),
      files: {
        json: expect.any(String),
        dts: expect.any(String),
      },
      timings: {
        total: expect.any(Number),
      },
    });
  });

  it('handles async contract source function', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const asyncSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma.config.async-source.ts',
      { '{{OUTPUT_DIR}}': setup.outputDir },
    );

    try {
      const run = await runOnEngine(asyncSetup, ['contract', 'emit']);
      expect(run.exitCode).toBe(0);

      const contractJsonPath = join(setup.outputDir, 'contract.json');
      expect(existsSync(contractJsonPath)).toBe(true);
    } finally {
      asyncSetup.cleanup();
    }
  });

  it('handles provider source function', { timeout: timeouts.typeScriptCompilation }, async () => {
    const syncSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma.config.sync-source.ts',
      { '{{OUTPUT_DIR}}': setup.outputDir },
    );

    try {
      const run = await runOnEngine(syncSetup, ['contract', 'emit']);
      expect(run.exitCode).toBe(0);

      const contractJsonPath = join(setup.outputDir, 'contract.json');
      expect(existsSync(contractJsonPath)).toBe(true);
    } finally {
      syncSetup.cleanup();
    }
  });
});

withTempDir(({ createTempDir }) => {
  describe('contract emit command (e2e)', () => {
    it(
      'emits contract.json and contract.d.ts with canonical command',
      async () => {
        const testSetup = setupTestDirectoryFromFixtures(
          createTempDir,
          emitFixtureSubdir,
          'prisma.config.emit.ts',
        );
        const outputDir = testSetup.outputDir;

        const run = await runOnEngine(testSetup, ['contract', 'emit', '--json']);
        expect(run.exitCode).toBe(0);

        expect(run.presented?.data).toMatchObject({
          ok: true,
          storageHash: expect.any(String),
          outDir: expect.any(String),
          files: {
            json: expect.any(String),
            dts: expect.any(String),
          },
          timings: {
            total: expect.any(Number),
          },
        });

        // Verify files were actually created
        const contractJsonPath = join(outputDir, 'contract.json');
        const contractDtsPath = join(outputDir, 'contract.d.ts');

        expect(existsSync(contractJsonPath)).toBe(true);
        expect(existsSync(contractDtsPath)).toBe(true);

        // Verify contract.json content
        const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
        expect(contractJson).toMatchObject({
          targetFamily: 'sql',
          _generated: expect.anything(),
        });

        // Verify contract.d.ts content
        const contractDts = readFileSync(contractDtsPath, 'utf-8');
        expect(contractDts).toContain('export type Contract');
        expect(contractDts).toContain('CodecTypes');

        // Verify temporary publication artifacts were cleaned up
        expect(readdirSync(outputDir).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);

        // Verify the result document matches the actual files
        expect(run.presented?.data).toMatchObject({
          storageHash: contractJson.storage.storageHash,
          files: {
            json: contractJsonPath,
            dts: contractDtsPath,
          },
        });
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'outputs JSON when --json flag is provided',
      async () => {
        const testSetup = setupTestDirectoryFromFixtures(
          createTempDir,
          emitFixtureSubdir,
          'prisma.config.emit.ts',
        );

        const run = await runOnEngine(testSetup, ['contract', 'emit', '--json']);
        expect(run.exitCode).toBe(0);

        expect(run.presented?.data).toMatchObject({
          ok: true,
          storageHash: expect.any(String),
          outDir: expect.any(String),
          files: {
            json: expect.any(String),
            dts: expect.any(String),
          },
          timings: {
            total: expect.any(Number),
          },
        });
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'throws error with CONFIG.FILE_NOT_FOUND code when config file is missing',
      async () => {
        // Set up test directory from fixtures (but we'll use a non-existent config)
        const testSetup = setupTestDirectoryFromFixtures(
          createTempDir,
          emitFixtureSubdir,
          'prisma.config.emit.ts',
        );

        const run = await runOnEngine(testSetup, [
          'contract',
          'emit',
          '--config',
          'nonexistent.config.ts',
          '--json',
        ]);

        // Config errors should have exit code 2
        expect(run.exitCode).toBe(2);

        const envelope = settledEnvelope(run);
        expect(envelope).toMatchObject({
          ok: false,
          error: {
            code: 'CONFIG.FILE_NOT_FOUND',
            summary: expect.any(String),
            why: expect.any(String),
          },
        });
        expect(envelope?.nextActions.length).toBeGreaterThan(0);
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'throws error with CONFIG.CONTRACT_MISSING code when contract config is missing',
      async () => {
        const testSetup = setupTestDirectoryFromFixtures(
          createTempDir,
          emitFixtureSubdir,
          'prisma.config.no-contract.ts',
        );

        const run = await runOnEngine(testSetup, ['contract', 'emit', '--json']);
        expect(run.exitCode).toBe(2);

        const envelope = settledEnvelope(run);
        expect(envelope).toMatchObject({
          ok: false,
          error: {
            code: 'CONFIG.CONTRACT_MISSING',
            summary: expect.any(String),
            why: expect.any(String),
          },
        });
        expect(envelope?.nextActions.length).toBeGreaterThan(0);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'outputs timings in verbose mode',
      async () => {
        const testSetup = setupTestDirectoryFromFixtures(
          createTempDir,
          emitFixtureSubdir,
          'prisma.config.emit.ts',
        );

        const run = await runOnEngine(testSetup, ['contract', 'emit', '--verbose']);
        expect(run.exitCode).toBe(0);

        expect(run.stderr).toContain('Total time');
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'suppresses output in quiet mode',
      async () => {
        const testSetup = setupTestDirectoryFromFixtures(
          createTempDir,
          emitFixtureSubdir,
          'prisma.config.emit.ts',
        );

        const quiet = await runOnEngine(testSetup, ['contract', 'emit', '--quiet']);
        expect(quiet.exitCode).toBe(0);

        const normal = await runOnEngine(testSetup, ['contract', 'emit']);
        expect(normal.exitCode).toBe(0);

        // The engine's --quiet is a log-level shorthand: it drops the progress
        // commentary but still presents the result.
        expect(quiet.stderr).not.toContain('Resolving contract source');
        expect(quiet.stderr).not.toContain('Emitting contract...');
        expect(quiet.stderr.length).toBeLessThan(normal.stderr.length);
      },
      timeouts.typeScriptCompilation,
    );
  });
});

describe('emit command: additional fixtures', () => {
  it('emits equivalent hashes from psl and ts providers', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const tsSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma.config.parity-ts.ts',
    );
    const pslSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma.config.parity-psl.ts',
    );

    try {
      const tsRun = await runOnEngine(tsSetup, ['contract', 'emit', '--json']);
      expect(tsRun.exitCode).toBe(0);
      const tsContract = JSON.parse(
        readFileSync(join(tsSetup.outputDir, 'contract.json'), 'utf-8'),
      ) as Record<string, unknown>;
      const storage = tsContract['storage'] as Record<string, unknown>;
      const storageHash = storage['storageHash'];
      const profileHash = tsContract['profileHash'];
      expect(storageHash).toMatch(/^[a-f0-9]{64}$/);
      expect(profileHash).toMatch(/^[a-f0-9]{64}$/);
      const tsProviderStorageHash = storageHash as string;
      const tsProviderProfileHash = profileHash as string;

      writeFileSync(
        join(pslSetup.testDir, 'schema.prisma'),
        readFileSync(
          join(integrationFixtureAppDir, 'fixtures', fixtureSubdir, 'schema.parity.psl'),
          'utf-8',
        ),
        'utf-8',
      );

      const pslRun = await runOnEngine(pslSetup, ['contract', 'emit', '--json']);
      expect(pslRun.exitCode).toBe(0);

      const contractJsonPath = join(pslSetup.testDir, 'output/contract.json');
      const contractDtsPath = join(pslSetup.testDir, 'output/contract.d.ts');
      expect(existsSync(contractJsonPath)).toBe(true);
      expect(existsSync(contractDtsPath)).toBe(true);

      const emitted = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
      const emittedStorage = emitted['storage'] as Record<string, unknown>;
      const emittedStorageHash = emittedStorage['storageHash'];
      const emittedProfileHash = emitted['profileHash'];

      expect(emitted).toMatchObject({
        targetFamily: 'sql',
      });
      expect(emittedStorageHash).toMatch(/^[a-f0-9]{64}$/);
      expect(emittedProfileHash).toMatch(/^[a-f0-9]{64}$/);
      expect(emittedStorageHash).toBe(tsProviderStorageHash);
      expect(emittedProfileHash).toBe(tsProviderProfileHash);
      expect(emitted).not.toHaveProperty('sources');
      expect(emitted).toMatchObject({
        meta: expect.not.objectContaining({
          source: expect.anything(),
          sourceId: expect.anything(),
          schemaPath: expect.anything(),
        }),
      });
    } finally {
      tsSetup.cleanup();
      pslSetup.cleanup();
    }
  });

  it('renders provider diagnostics when psl provider fails', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const testSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma.config.parity-psl.ts',
    );

    try {
      writeFileSync(
        join(testSetup.testDir, 'schema.prisma'),
        `model Post {
  id Int @id
  data Unsupported
}
`,
        'utf-8',
      );

      const providerConfig = (
        await loadConfig(join(testSetup.testDir, 'prisma.config.ts'))
      ).assertOk().config;
      const contractConfig = providerConfig.contract;
      expect(contractConfig).toBeDefined();

      const stack = createControlStack({
        family: providerConfig.family,
        target: providerConfig.target,
        adapter: providerConfig.adapter,
        extensions: providerConfig.extensions ?? [],
      });
      const sourceResult = await contractConfig!.source.load({
        composedExtensions: stack.extensions.map((p) => p.id),
        composedExtensionContracts: new Map(),
        authoringContributions: stack.authoringContributions,
        codecLookup: stack.codecLookup,
        controlMutationDefaults: stack.controlMutationDefaults,
        resolvedInputs: contractConfig!.source.inputs ?? [],
        capabilities: stack.capabilities,
      });

      expect(sourceResult.ok).toBe(false);
      if (sourceResult.ok) {
        throw new Error('Expected source provider to fail for unsupported field type');
      }
      expect(sourceResult.failure.summary).toBe('PSL to SQL contract interpretation failed');
      expect(sourceResult.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNSUPPORTED_FIELD_TYPE',
            sourceId: './schema.prisma',
            span: expect.objectContaining({
              start: expect.objectContaining({ line: 3 }),
            }),
          }),
        ]),
      );

      const run = await runOnEngine(testSetup, ['contract', 'emit', '--json']);
      expect(run.exitCode).toBe(2);

      const terminal = run.json.at(-1);
      const envelope =
        terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
      expect(envelope).toMatchObject({
        ok: false,
        error: {
          code: 'CONTRACT.SOURCE_LOAD_FAILED',
          why: 'PSL to SQL contract interpretation failed',
        },
      });

      const reported = JSON.stringify(envelope);
      expect(reported).toContain('PSL_UNSUPPORTED_FIELD_TYPE');
      expect(reported).toContain('schema.prisma');
    } finally {
      testSetup.cleanup();
    }
  });

  it('rejects plain-object configs that were not created by definePrismaConfig', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const testSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma.config.missing-output.ts',
    );

    try {
      const run = await runOnEngine(testSetup, ['contract', 'emit', '--json']);
      expect(run.exitCode).toBe(2);

      const terminal = run.json.at(-1);
      const envelope =
        terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
      expect(envelope).toMatchObject({
        ok: false,
        error: { code: 'CONFIG.VERSION_MARKER_MISSING' },
      });
      expect(existsSync(join(testSetup.testDir, 'src/prisma/contract.json'))).toBe(false);
    } finally {
      testSetup.cleanup();
    }
  });

  it('emits contract.json and contract.d.ts with Mongo config', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const testSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma.config.mongo.ts',
    );

    try {
      writeFileSync(
        join(testSetup.testDir, 'contract.prisma'),
        `model User {
  id    ObjectId @id @map("_id")
  name  String
  email String
  posts Post[]
  @@map("users")
}

model Post {
  id        ObjectId @id @map("_id")
  title     String
  authorId  ObjectId
  author    User @relation(fields: [authorId], references: [id])
  @@map("posts")
}
`,
        'utf-8',
      );

      const run = await runOnEngine(testSetup, ['contract', 'emit', '--json']);
      expect(run.exitCode).toBe(0);

      const contractJsonPath = join(testSetup.outputDir, 'contract.json');
      const contractDtsPath = join(testSetup.outputDir, 'contract.d.ts');

      expect(existsSync(contractJsonPath)).toBe(true);
      expect(existsSync(contractDtsPath)).toBe(true);

      const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
      expect(contractJson).toMatchObject({
        targetFamily: 'mongo',
        target: 'mongo',
        domain: {
          namespaces: {
            __unbound__: {
              models: {
                User: expect.objectContaining({
                  fields: expect.objectContaining({
                    _id: {
                      type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                      nullable: false,
                    },
                    name: {
                      type: { kind: 'scalar', codecId: 'mongo/string@1' },
                      nullable: false,
                    },
                  }),
                }),
                Post: expect.objectContaining({
                  relations: expect.objectContaining({
                    author: expect.objectContaining({
                      to: { namespace: '__unbound__', model: 'User' },
                      cardinality: 'N:1',
                    }),
                  }),
                }),
              },
            },
          },
        },
      });

      const contractDts = readFileSync(contractDtsPath, 'utf-8');
      expect(contractDts).toContain('export type Contract');
      expect(contractDts).toContain('CodecTypes');

      expect(run.presented?.data).toMatchObject({
        ok: true,
        storageHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        files: {
          json: expect.stringContaining('contract.json'),
          dts: expect.stringContaining('contract.d.ts'),
        },
      });
    } finally {
      testSetup.cleanup();
    }
  });

  it('emits contract.json and contract.d.ts with Mongo contract.ts config', {
    timeout: timeouts.typeScriptCompilation,
  }, async () => {
    const testSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma.config.mongo-contract-ts.ts',
    );

    try {
      const run = await runOnEngine(testSetup, ['contract', 'emit', '--json']);
      expect(run.exitCode).toBe(0);

      const contractJsonPath = join(testSetup.outputDir, 'contract.json');
      const contractDtsPath = join(testSetup.outputDir, 'contract.d.ts');

      expect(existsSync(contractJsonPath)).toBe(true);
      expect(existsSync(contractDtsPath)).toBe(true);

      const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
      expect(contractJson).toMatchObject({
        targetFamily: 'mongo',
        target: 'mongo',
        storage: {
          namespaces: {
            __unbound__: {
              entries: {
                collection: {
                  users: {
                    indexes: [{ keys: [{ field: 'email', direction: 1 }], unique: true }],
                    options: {
                      collation: { locale: 'en', strength: 2 },
                    },
                  },
                },
              },
            },
          },
        },
        domain: {
          namespaces: {
            __unbound__: {
              models: {
                Task: expect.objectContaining({
                  storage: expect.objectContaining({
                    collection: 'tasks',
                    relations: {
                      comments: { field: 'comments' },
                    },
                  }),
                  discriminator: { field: 'type' },
                  variants: {
                    Bug: { value: 'bug' },
                  },
                }),
                Bug: expect.objectContaining({
                  base: { namespace: '__unbound__', model: 'Task' },
                }),
                Comment: expect.objectContaining({
                  owner: 'Task',
                }),
              },
            },
          },
        },
      });

      const contractDts = readFileSync(contractDtsPath, 'utf-8');
      expect(contractDts).toContain("readonly owner: 'Task'");
      expect(contractDts).toMatch(/readonly base:\s*{\s*readonly namespace:/);
      expect(contractDts).toContain("readonly discriminator: { readonly field: 'type' }");
      expect(contractDts).toContain('readonly users: {');
      expect(contractDts).toContain('readonly indexes:');
      expect(contractDts).toContain("readonly kind: 'mongo-index'");
      expect(contractDts).toContain("readonly field: 'email'");
      expect(contractDts).toContain('readonly direction: 1');
      expect(contractDts).toContain('readonly unique: true');
      expect(contractDts).toContain('readonly options:');
      expect(contractDts).toContain("readonly kind: 'mongo-collection-options'");
      expect(contractDts).toContain("readonly kind: 'mongo-collation-options'");
      expect(contractDts).toContain("readonly locale: 'en'");
      expect(contractDts).toContain('readonly strength: 2');

      expect(run.presented?.data).toMatchObject({
        ok: true,
        storageHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        files: {
          json: expect.stringContaining('contract.json'),
          dts: expect.stringContaining('contract.d.ts'),
        },
      });
    } finally {
      testSetup.cleanup();
    }
  });
});
