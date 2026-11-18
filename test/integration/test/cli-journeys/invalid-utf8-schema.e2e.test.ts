import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { runContractEmit, setupJourney, timeouts } from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('contract emit with a schema that is not valid UTF-8', () => {
    it(
      'fails and reports PSL_SCHEMA_READ_FAILED for the file',
      async () => {
        const ctx = setupJourney({
          createTempDir,
          contractMode: 'psl',
          connectionString: 'postgresql://postgres:postgres@localhost:1/unreachable',
        });

        const schemaPath = join(ctx.testDir, 'contract.prisma');
        writeFileSync(
          schemaPath,
          Buffer.concat([
            readFileSync(schemaPath),
            Buffer.from('\n// a Windows-1252 em dash: ', 'utf-8'),
            Buffer.from([0x97]),
            Buffer.from('\n', 'utf-8'),
          ]),
        );

        const result = await runContractEmit(ctx, ['--json']);
        const output = `${result.stdout}\n${result.stderr}`;

        expect(result.exitCode, output).toBe(2);
        expect(output).toContain('PSL_SCHEMA_READ_FAILED');
        expect(output).toContain(schemaPath);
      },
      timeouts.typeScriptCompilation,
    );
  });
});
