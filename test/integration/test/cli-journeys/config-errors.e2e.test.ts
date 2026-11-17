/**
 * Config File Errors (Journey T)
 *
 * Verifies that contract emit fails gracefully for broken configuration:
 * missing config file, explicit nonexistent path, invalid TypeScript syntax,
 * and a config that compiles but is missing the contract field. No database
 * needed.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StreamEvent } from '@prisma/cli-engine';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type EngineCommandResult,
  runContractEmitWithConfig,
  setupJourney,
} from '../utils/journey-test-helpers';

/** The dotted code the run settled with, read off the terminal stream frame. */
function settledCode(result: EngineCommandResult): string | undefined {
  const terminal: StreamEvent | undefined = result.json.at(-1);
  if (terminal === undefined || terminal.kind !== 'result' || terminal.envelope.ok) {
    return undefined;
  }
  return terminal.envelope.error.code;
}

withTempDir(({ createTempDir }) => {
  describe('Journey T: Config Errors', () => {
    // T.01: contract emit with no config file
    it(
      'T.01: fails when config file does not exist',
      async () => {
        const ctx = setupJourney({ createTempDir });

        // Remove the config file to simulate missing config
        const result = await runContractEmitWithConfig(
          ctx.testDir,
          join(ctx.testDir, 'nonexistent-config.ts'),
          ['--json'],
        );
        expect(result.exitCode, 'T.01: missing config').toBe(2);
        expect(settledCode(result), 'T.01: settled code').toBe('CONFIG.FILE_NOT_FOUND');
      },
      timeouts.typeScriptCompilation,
    );

    // T.02: contract emit --config ./nonexistent.ts
    it(
      'T.02: fails when explicit config path does not exist',
      async () => {
        const ctx = setupJourney({ createTempDir });

        const result = await runContractEmitWithConfig(ctx.testDir, './this-does-not-exist.ts', [
          '--json',
        ]);
        expect(result.exitCode, 'T.02: explicit missing config').toBe(2);
        expect(settledCode(result), 'T.02: settled code').toBe('CONFIG.FILE_NOT_FOUND');
      },
      timeouts.typeScriptCompilation,
    );

    // T.03: contract emit with invalid TS in config
    it(
      'T.03: fails when config has invalid TypeScript',
      async () => {
        const ctx = setupJourney({ createTempDir });

        // Overwrite config with invalid TS
        const invalidConfigPath = join(ctx.testDir, 'prisma.config.ts');
        writeFileSync(invalidConfigPath, 'export default {{{INVALID SYNTAX', 'utf-8');

        const result = await runContractEmitWithConfig(ctx.testDir, invalidConfigPath, ['--json']);
        expect(result.exitCode, 'T.03: invalid config TS').toBe(2);
        expect(settledCode(result), 'T.03: settled code').toBe('CONFIG.EVALUATION_FAILED');
      },
      timeouts.typeScriptCompilation,
    );

    // T.04: contract emit with config missing contract field
    it(
      'T.04: fails when config is missing contract configuration',
      async () => {
        const ctx = setupJourney({ createTempDir });

        // Overwrite config with valid TS but missing contract field
        const emptyConfigPath = join(ctx.testDir, 'prisma.config.ts');
        writeFileSync(
          emptyConfigPath,
          `
import { definePrismaConfig } from '@prisma/cli-engine';
import sql from '@prisma/orm-postgres/family/control';
import postgres from '@prisma/orm-postgres/target/control';
import postgresAdapter from '@prisma/orm-postgres/adapter/control';

export default definePrismaConfig({
  orm: {
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    extensions: [],
  },
});
`,
          'utf-8',
        );

        const result = await runContractEmitWithConfig(ctx.testDir, emptyConfigPath, ['--json']);
        expect(result.exitCode, 'T.04: missing contract field').toBe(2);
        expect(settledCode(result), 'T.04: settled code').toBe('CONFIG.CONTRACT_MISSING');
      },
      timeouts.typeScriptCompilation,
    );
  });
});
