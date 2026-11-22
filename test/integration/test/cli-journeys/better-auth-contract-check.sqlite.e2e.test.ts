/**
 * Better Auth's `auth generate` and `auth check` against a Prisma 8 contract (SQLite).
 *
 * The project turns on Better Auth's two-factor plugin while its contract holds only Better Auth's four core models. Both commands print what the contract lacks, exit 1 and leave the contract as it is; once the printed models and fields are added and emitted, both pass.
 */

import { execFile } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { fixtureAppDir, withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type CommandResult,
  type JourneyContext,
  runContractEmit,
  timeouts,
} from '../utils/journey-test-helpers';

const authBin = fileURLToPath(new URL('../../node_modules/.bin/auth', import.meta.url));

const missing = `Your Prisma contract is missing models or fields that Better Auth needs.

Add to your contract:

model User {
  twoFactorEnabled Boolean?
  twoFactors       TwoFactor[]
}

model TwoFactor {
  id                      String    @id
  secret                  String
  backupCodes             String
  userId                  String
  user                    User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  verified                Boolean?
  failedVerificationCount Int?
  lockedUntil             DateTime?

  @@index([secret])
  @@index([userId])
  @@map("twoFactor")
}

Then run \`prisma contract emit\` and update your database.`;

function setupProject(createTempDir: () => string): JourneyContext {
  const testDir = createTempDir();
  cpSync(join(fixtureAppDir, 'fixtures/better-auth'), testDir, { recursive: true });
  writeProjectManifest(testDir);
  return {
    testDir,
    configPath: join(testDir, 'prisma.config.ts'),
    outputDir: join(testDir, 'src/prisma'),
  };
}

function runAuth(ctx: JourneyContext, args: readonly string[]): Promise<CommandResult> {
  return promisify(execFile)(authBin, [...args], {
    cwd: ctx.testDir,
    env: {
      ...process.env,
      BETTER_AUTH_SECRET: 'a-test-secret-that-is-long-enough-for-better-auth',
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_TELEMETRY: '0',
      NO_COLOR: '1',
    },
  }).then(
    ({ stdout, stderr }) => ({ exitCode: 0, stdout, stderr }),
    (error: { code: number; stdout: string; stderr: string }) => ({
      exitCode: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    }),
  );
}

/** The message, without what the command logs while it loads the configuration. */
function printedMessage(result: CommandResult): string {
  expect(result.stderr).not.toContain('Error running Better Auth CLI');
  return result.stderr.slice(result.stderr.indexOf('Your Prisma contract')).trim();
}

withTempDir(({ createTempDir }) => {
  describe('Journey: auth generate and auth check with the two-factor plugin (SQLite)', () => {
    it(
      'print what the contract lacks until it is added, and then pass',
      async () => {
        const ctx = setupProject(createTempDir);
        const contractPath = join(ctx.testDir, 'prisma/contract.prisma');
        const contract = readFileSync(contractPath, 'utf-8');

        const emitted = await runContractEmit(ctx);
        expect(emitted.exitCode, `A.01: contract emit: ${emitted.stderr}`).toBe(0);

        const generated = await runAuth(ctx, ['generate', '--yes']);
        expect(generated.exitCode, 'A.02: auth generate').toBe(1);
        expect(printedMessage(generated), 'A.02: auth generate').toBe(missing);

        const checked = await runAuth(ctx, ['check']);
        expect(checked.exitCode, 'A.03: auth check').toBe(1);
        expect(printedMessage(checked), 'A.03: auth check').toBe(missing);

        expect(readFileSync(contractPath, 'utf-8'), 'A.04: the contract is unchanged').toBe(
          contract,
        );

        const twoFactorModel = missing.slice(
          missing.indexOf('model TwoFactor'),
          missing.indexOf('\n\nThen run'),
        );
        const completed = contract.replace(
          '  accounts      Account[]\n',
          '  accounts      Account[]\n  twoFactorEnabled Boolean?\n  twoFactors       TwoFactor[]\n',
        );
        expect(completed, 'A.05: the User model takes the printed fields').not.toBe(contract);
        writeFileSync(contractPath, `${completed}\n${twoFactorModel}\n`);
        const reEmitted = await runContractEmit(ctx);
        expect(reEmitted.exitCode, `A.05: contract emit: ${reEmitted.stderr}`).toBe(0);

        const regenerated = await runAuth(ctx, ['generate', '--yes']);
        expect(regenerated.exitCode, `A.06: auth generate: ${regenerated.stderr}`).toBe(0);
        expect(regenerated.stdout).toContain('Your schema is already up to date.');

        const rechecked = await runAuth(ctx, ['check']);
        expect(rechecked.exitCode, `A.07: auth check: ${rechecked.stderr}`).toBe(0);
        expect(rechecked.stdout).toContain('Schema check passed against adapter "prisma-8".');
      },
      timeouts.repeatedScriptRuns,
    );
  });
});
