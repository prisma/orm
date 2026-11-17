/**
 * An `Int @id @default(autoincrement())` field on SQLite, end to end: `db init` creates the table
 * as `INTEGER PRIMARY KEY AUTOINCREMENT`, and the database then satisfies the contract.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runDbInit,
  runDbVerify,
  sqlitePslConfigFixture,
  timeouts,
} from '../utils/journey-test-helpers';

const SCHEMA = `// use prisma-8

model Post {
  id    Int    @id @default(autoincrement())
  title String
}
`;

function setup(createTempDir: () => string): JourneyContext & { readonly dbPath: string } {
  const testDir = createTempDir();
  const dbPath = join(testDir, 'journey.db');
  const configPath = join(testDir, 'prisma.config.ts');
  const config = readFileSync(sqlitePslConfigFixture, 'utf-8').replace('{{DB_PATH}}', () => dbPath);
  writeFileSync(configPath, config, 'utf-8');
  writeFileSync(join(testDir, 'contract.prisma'), SCHEMA, 'utf-8');
  writeProjectManifest(testDir);
  return { testDir, configPath, outputDir: testDir, dbPath };
}

withTempDir(({ createTempDir }) => {
  describe('SQLite: an autoincrement() id', () => {
    it(
      'is created by db init and satisfies the contract',
      async () => {
        const ctx = setup(createTempDir);
        const emitted = await runContractEmit(ctx);
        expect(emitted.exitCode, `emit: ${emitted.stderr}`).toBe(0);

        const initialized = await runDbInit(ctx);
        expect(initialized.exitCode, `db init: ${initialized.stdout}\n${initialized.stderr}`).toBe(
          0,
        );
        const verified = await runDbVerify(ctx);
        expect(verified.exitCode, `db verify: ${verified.stdout}\n${verified.stderr}`).toBe(0);

        const db = new DatabaseSync(ctx.dbPath);
        try {
          expect(
            db
              .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'Post'`)
              .get(),
          ).toEqual({ sql: expect.stringContaining('"id" INTEGER PRIMARY KEY AUTOINCREMENT') });
        } finally {
          db.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });
});
