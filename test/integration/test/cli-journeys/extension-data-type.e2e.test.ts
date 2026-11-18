/**
 * A data type an extension declares: with the test-only extension `testext` in the config, `contract infer` prints its constructor for a column of the type and for a list of it, and `db verify` against the emitted contract is clean. Without the extension, no data type in the stack claims the column: `db verify` names it with the type the database reports, and `contract infer` fails with `CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runContractInfer,
  runDbVerify,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const CREATE_ITEM_TABLE = `
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE item (
    id int4 PRIMARY KEY,
    thing vector(3) NOT NULL,
    things vector(3)[] NOT NULL
  );
`;

const TESTEXT_CONTROL = join(__dirname, '../fixtures/testext/control');

function declareTestext(ctx: JourneyContext): void {
  const config = readFileSync(ctx.configPath, 'utf-8');
  writeFileSync(
    ctx.configPath,
    `import testext from '${TESTEXT_CONTROL}';\n${config.replace('extensions: []', 'extensions: [testext]')}`,
  );
}

withTempDir(({ createTempDir }) => {
  describe('a data type an extension declares', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(CREATE_ITEM_TABLE)),
    });

    it(
      'is inferred as the extension constructor and verifies clean',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        declareTestext(ctx);

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        const psl = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8');
        expect(psl).toMatch(/\bthing\s+testext\.Thing\(3\)\n/);
        expect(psl).toMatch(/\bthings\s+testext\.Thing\(3\)\?\[\]/);

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);
        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(
          verify.exitCode,
          `db verify\n${stripAnsi(`${verify.stdout}\n${verify.stderr}`)}`,
        ).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'is reported by verify and refused by infer without the extension',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        const contractPath = join(ctx.testDir, 'contract.prisma');
        writeFileSync(
          contractPath,
          `// use prisma-8

model Item {
  id     Int      @id
  thing  String
  things String[]

  @@map("item")
}
`,
        );
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);

        const verify = await runDbVerify(ctx, ['--schema-only']);
        const verifyOutput = stripAnsi(`${verify.stdout}\n${verify.stderr}`);
        expect(verify.exitCode).not.toBe(0);
        expect(verifyOutput).toContain(
          'The database column is "vector(3)", which no data type in the configured stack declares.',
        );
        expect(verifyOutput).toContain(
          'The database column is "vector(3)[]", which no data type in the configured stack declares.',
        );

        const before = readFileSync(contractPath, 'utf-8');
        const infer = await runContractInfer(ctx);
        const inferOutput = stripAnsi(`${infer.stdout}\n${infer.stderr}`);
        expect(infer.exitCode).not.toBe(0);
        expect(readFileSync(contractPath, 'utf-8'), 'a failed infer writes no schema').toBe(before);
        expect(inferOutput).toContain('CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED');
        expect(inferOutput).toContain('public.item.thing: vector(3)');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
