/**
 * A project exactly as the last release candidate left it keeps working: its config, its contract source and its emitted `contract.json` and `contract.d.ts` type-check against this release (the e2e package's typecheck covers the fixtures and this file), emit succeeds with a warning that says what to add, and a client created from the emitted contract warns nothing and runs a query and `transaction()`.
 *
 * The fixtures under `fixtures/release-candidate/` are copied unchanged from the tag `v8.0.0-rc.25` with `git show v8.0.0-rc.25:<path>`, and must never be emitted again in place:
 *
 * - `prisma-schema/` is `examples/multi-extension-monorepo/packages/feature-flags/` (`prisma.config.ts`, `src/contract.prisma`, `src/contract.json`, `src/contract.d.ts`).
 * - `typescript/` is `test/e2e/framework/test/fixtures/` (`prisma.config.ts`, `contract.ts`, `generated/contract.json`, `generated/contract.d.ts`).
 *
 * Emit runs on a copy, so the committed files stay as the release candidate wrote them.
 */

import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import arktypeJson from '@prisma/orm-extension-arktype-json/runtime';
import pgvector from '@prisma/orm-extension-pgvector/runtime';
import { createPostgresControlClient } from '@prisma/orm-postgres/control';
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Contract as PrismaSchemaContract } from './fixtures/release-candidate/prisma-schema/src/contract.d';
import type { Contract as TypeScriptContract } from './fixtures/release-candidate/typescript/generated/contract.d';
import { runDbInit } from './utils';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = resolve(__dirname, '../../../../packages/1-framework/3-tooling/cli/dist/bin.mjs');
const FIXTURES = resolve(__dirname, 'fixtures/release-candidate');
// Inside the fixtures package, so the copy resolves its packages and reads its manifest.
const SCRATCH_PARENT = resolve(__dirname, 'fixtures/.vitest');

const projects = {
  prismaSchema: {
    dir: join(FIXTURES, 'prisma-schema'),
    contractJson: 'src/contract.json',
    warning:
      "src/contract.prisma Your contract does not list the capabilities it requires, so it requires those of the newest PostgreSQL version and of the driver. Add `requiredCapabilities: [...postgres18, ...postgresDriver]` beside the contract path './src/contract.prisma' in the config, as `contract: { path, requiredCapabilities }`, with `import { postgres18, postgresDriver } from '@prisma/orm-postgres/config';`. Prisma 8.0 removes this default and requires the list.",
  },
  typescript: {
    dir: join(FIXTURES, 'typescript'),
    contractJson: 'generated/contract.json',
    warning:
      "contract.ts Your contract does not list the capabilities it requires, so it requires those of the newest PostgreSQL version and of the driver. Add `requiredCapabilities: [...postgres18, ...postgresDriver]` in defineContract, with `import { postgres18, postgresDriver } from '@prisma/orm-postgres/contract-builder';`. Prisma 8.0 removes this default and requires the list.",
  },
} as const;

const scratchDirs: string[] = [];

afterEach(async () => {
  for (const dir of scratchDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf-8'));
}

async function emitCopyOf(project: (typeof projects)[keyof typeof projects]) {
  await mkdir(SCRATCH_PARENT, { recursive: true });
  const scratch = await mkdtemp(join(SCRATCH_PARENT, 'release-candidate-'));
  scratchDirs.push(scratch);
  await cp(project.dir, scratch, { recursive: true });
  const { stdout, stderr } = await execFileAsync(
    'node',
    [CLI_BIN, 'contract', 'emit', '--config', 'prisma.config.ts'],
    { cwd: scratch },
  );
  return {
    output: `${stdout}\n${stderr}`,
    contract: await readJson(join(scratch, project.contractJson)),
  };
}

function spyLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('a project as the last release candidate left it', {
  timeout: timeouts.spinUpPpgDev,
}, () => {
  it.each(Object.entries(projects))(
    '%s: emit succeeds with the newest version’s list and the driver’s, and warns what to add',
    async (_, project) => {
      const emitted = await emitCopyOf(project);

      expect(emitted.output).toContain(
        `[CONTRACT.REQUIRED_CAPABILITIES_NOT_LISTED] ${project.warning}`,
      );
      expect(emitted.contract).toMatchObject({
        capabilities: {
          postgres: { distinctOn: true, forKeyShare: true, forNoKeyUpdate: true },
          sql: expect.objectContaining({ returning: true, interactiveTransactions: true }),
        },
      });
      expect(emitted.contract).not.toMatchObject({ capabilities: { postgres: { orderBy: true } } });
    },
  );

  it('prisma schema: the emitted contract creates a client with no warning, which runs a query and transaction()', async () => {
    const contractJsonPath = join(projects.prismaSchema.dir, projects.prismaSchema.contractJson);
    const contractJson = await readJson(contractJsonPath);

    await withDevDatabase(async ({ connectionString }) => {
      await mkdir(SCRATCH_PARENT, { recursive: true });
      const migrationsDir = await mkdtemp(join(SCRATCH_PARENT, 'migrations-'));
      scratchDirs.push(migrationsDir);
      const control = createPostgresControlClient({ connection: connectionString });
      try {
        const initialized = await control.dbInit({
          invocation: { cwd: process.cwd(), configPath: undefined, dbGiven: false },
          contract: contractJson,
          mode: 'apply',
          migrationsDir,
        });
        if (!initialized.ok) throw new Error(initialized.failure.message);
      } finally {
        await control.close();
      }

      const log = spyLog();
      const db = postgres({
        contract: contractFromJson<PrismaSchemaContract>(contractJson),
        url: connectionString,
        log,
      });
      try {
        await db.orm.public.FeatureFlag.create({ key: 'outside', enabled: false });
        await db.transaction(async (tx) => {
          await tx.orm.public.FeatureFlag.create({ key: 'inside', enabled: true });
        });

        expect(
          await db.orm.public.FeatureFlag.select('key', 'enabled')
            .orderBy((flag) => flag.key.asc())
            .all(),
        ).toEqual([
          { key: 'inside', enabled: true },
          { key: 'outside', enabled: false },
        ]);
        expect(log.warn).not.toHaveBeenCalled();
      } finally {
        await db.close();
      }
    });
  });

  it('typescript: the emitted contract creates a client with no warning, which runs a query and transaction()', async () => {
    const contractJsonPath = join(projects.typescript.dir, projects.typescript.contractJson);
    const contractJson = await readJson(contractJsonPath);

    await withDevDatabase(async ({ connectionString }) => {
      await runDbInit({ connectionString, contractJsonPath });

      const log = spyLog();
      const db = postgres({
        contract: contractFromJson<TypeScriptContract>(contractJson),
        url: connectionString,
        extensions: [pgvector, arktypeJson],
        log,
      });
      try {
        await db.orm.public.User.first();
        await db.transaction(async (tx) => {
          await tx.orm.public.User.create({ email: 'release-candidate@example.com' });
        });

        expect(
          await db.orm.public.User.select('email')
            .where({ email: 'release-candidate@example.com' })
            .all(),
        ).toEqual([{ email: 'release-candidate@example.com' }]);
        expect(log.warn).not.toHaveBeenCalled();
      } finally {
        await db.close();
      }
    });
  });
});
