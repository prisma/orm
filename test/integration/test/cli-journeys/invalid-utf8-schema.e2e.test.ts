/**
 * Invalid UTF-8 Schema Handling (Issue #30198)
 *
 * Verifies that contract emit fails with a non-zero exit code and explicit error
 * diagnostics when contract.prisma contains invalid UTF-8 byte sequences (such as a
 * lone Windows-1252 0x97 em-dash byte).
 */

import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { runContractEmit, setupJourney, timeouts } from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('Issue #30198: Invalid UTF-8 Schema Handling', () => {
    it(
      'fails with exit code 1 and outputs error when schema contains non-UTF-8 bytes',
      async () => {
        const ctx = setupJourney({ createTempDir, contractMode: 'psl' });

        const schemaPath = join(ctx.testDir, 'contract.prisma');
        const invalidSchemaContent = Buffer.concat([
          Buffer.from('model User {\n  id Int @id // comment with CP-1252 em-dash: ', 'utf-8'),
          Buffer.from([0x97]),
          Buffer.from('\n}\n', 'utf-8'),
        ]);
        writeFileSync(schemaPath, invalidSchemaContent);

        const result = await runContractEmit(ctx, ['--json']);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toMatch(/PSL_SCHEMA_READ_FAILED|invalid UTF-8|Failed to decode/i);
      },
      timeouts.typeScriptCompilation,
    );
  });
});
