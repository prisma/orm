/**
 * `contract infer` writes a pgvector column through the pgvector pack's data type: with the pack in
 * the config it prints `pgvector.Vector(3)`; without it, no data type claims the column, so infer
 * fails and names it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  declarePgvectorExtension,
  runContractInfer,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const CREATE_ITEM_TABLE = `
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE item (
    id int4 PRIMARY KEY,
    embedding vector(3) NOT NULL
  );
`;

withTempDir(({ createTempDir }) => {
  describe('contract infer over a pgvector column', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(CREATE_ITEM_TABLE)),
    });

    it(
      'prints pgvector.Vector(3) when pgvector is in the config',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        declarePgvectorExtension(ctx);

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        const psl = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8');
        expect(psl).toMatch(/\bembedding\s+pgvector\.Vector\(3\)/);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'fails and names the column when pgvector is not in the config',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const contractPath = join(ctx.testDir, 'contract.prisma');
        const before = readFileSync(contractPath, 'utf-8');

        const infer = await runContractInfer(ctx);
        const output = stripAnsi(`${infer.stdout}\n${infer.stderr}`);
        expect(infer.exitCode).not.toBe(0);
        expect(readFileSync(contractPath, 'utf-8'), 'a failed infer writes no schema').toBe(before);
        expect(output).toContain('CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED');
        expect(output).toContain('public.item.embedding: vector(3)');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
