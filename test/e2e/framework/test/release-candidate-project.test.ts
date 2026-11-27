/**
 * A project exactly as the last release candidate left it keeps working: its config, its contract source and its emitted `contract.json` and `contract.d.ts` type-check against this release (the e2e package's typecheck covers the fixtures and this file), emit succeeds with a warning that says what to add, and a client created from the emitted contract warns nothing and runs a query and `transaction()`.
 *
 * The fixtures under `fixtures/release-candidate/` are copied unchanged from the tag `v8.0.0-rc.25` with `git show v8.0.0-rc.25:<path>`, and must never be emitted again in place:
 *
 * - `prisma-schema/` is `examples/multi-extension-monorepo/packages/feature-flags/` (`prisma.config.ts`, `src/contract.prisma`, `src/contract.json`, `src/contract.d.ts`).
 * - `typescript/` is `test/e2e/framework/test/fixtures/` (`prisma.config.ts`, `contract.ts`, `generated/contract.json`, `generated/contract.d.ts`).
 * - `ready-source/` builds its contract source itself, as `examples/supabase/README.md` and the PostgreSQL facade's README at the tag taught: its `prisma.config.ts` is that README form, with the imports the facade's README names, and `src/contract.prisma` is the `feature-flags` one.
 *
 * Emit runs on a copy, so the committed files stay as the release candidate wrote them, and the test pins each file's SHA-256 so that a regenerated fixture fails it.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import arktypeJson from '@prisma/orm-extension-arktype-json/runtime';
import pgvector from '@prisma/orm-extension-pgvector/runtime';
import {
  postgres18,
  postgresContractCapabilities,
  postgresDriver,
} from '@prisma/orm-postgres/config';
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

const notListed = (where: string, line: string, imports: string) =>
  `Your contract does not list the capabilities it requires, so it requires those of the newest PostgreSQL version and of the driver. Prisma 8.0 removes this default and requires the list. Write this ${where}, with its import:\n\n${line}\n\n${imports}`;

const projects = {
  prismaSchema: {
    dir: join(FIXTURES, 'prisma-schema'),
    contractJson: 'src/contract.json',
    warning: `src/contract.prisma ${notListed(
      'as the contract entry in the config',
      'contract: {\n  path: "./src/contract.prisma",\n  requiredCapabilities: [...postgres18, ...postgresDriver],\n}',
      "import { postgres18, postgresDriver } from '@prisma/orm-postgres/config';",
    )}`,
  },
  typescript: {
    dir: join(FIXTURES, 'typescript'),
    contractJson: 'generated/contract.json',
    warning: `contract.ts ${notListed(
      'in defineContract',
      'requiredCapabilities: [...postgres18, ...postgresDriver]',
      "import { postgres18, postgresDriver } from '@prisma/orm-postgres/contract-builder';",
    )}`,
  },
  readySource: {
    dir: join(FIXTURES, 'ready-source'),
    contractJson: 'src/contract.json',
    warning: `src/contract.prisma ${notListed(
      'in the options of the contract source given to defineConfig',
      'capabilities: postgresContractCapabilities([...postgres18, ...postgresDriver])',
      "import { postgres18, postgresContractCapabilities, postgresDriver } from '@prisma/orm-postgres/config';",
    )}`,
  },
} as const;

const fixtureHashes = {
  'prisma-schema/prisma.config.ts':
    'e21d5423d91379a1119d5ed350685e9aa96a848a4e14b83f7a8eaba1865e6bd2',
  'prisma-schema/src/contract.d.ts':
    'fa224237c65501c85eda39e0d6f3c2d99b5450c49780207b006f257504343f27',
  'prisma-schema/src/contract.json':
    'd8a3ac426dbff8fae3026097250d195ab6e6711a70f98a004e14ef33d14eaf85',
  'prisma-schema/src/contract.prisma':
    '3c9d00148e8ad4aec616b8dd757391155a7a2348c2351ad3c86e947870d9ad89',
  'ready-source/prisma.config.ts':
    '8d65802e94de5c7ce361bc1d978db527310fe5a7a1244b9ed05126f43560dbe4',
  'ready-source/src/contract.prisma':
    '3c9d00148e8ad4aec616b8dd757391155a7a2348c2351ad3c86e947870d9ad89',
  'typescript/contract.ts': '446f0459f69e7e9d036ec7c197366a86ef631a7b6662150e818d9e1f2ee09884',
  'typescript/generated/contract.d.ts':
    'ae568c77e8cb5974e0fadbcfd23a446396920056d5b5f5869b479c48aa0b4450',
  'typescript/generated/contract.json':
    '0e0ea3481159c4bbcf39542651d2b254ea4935f7f3c203c640e496a906d84add',
  'typescript/prisma.config.ts': 'c648ca42c27e9e298db037511c2e84b7603afb255be91b65d358709b7ab72b68',
};

const defaultCapabilities = postgresContractCapabilities([...postgres18, ...postgresDriver]);

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
  const contractJsonPath = join(scratch, project.contractJson);
  return {
    output: `${stdout}\n${stderr}`,
    contract: await readJson(contractJsonPath),
    contractJsonPath,
  };
}

function spyLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('a project as the last release candidate left it', {
  timeout: timeouts.spinUpPpgDev,
}, () => {
  it('keeps every fixture as the release candidate wrote it', async () => {
    const hashes = Object.fromEntries(
      await Promise.all(
        Object.keys(fixtureHashes).map(async (path) => [
          path,
          createHash('sha256')
            .update(await readFile(join(FIXTURES, path)))
            .digest('hex'),
        ]),
      ),
    );
    expect(hashes).toEqual(fixtureHashes);
  });

  it.each(Object.entries(projects))(
    '%s: emit succeeds with the newest version’s list and the driver’s, and warns what to write',
    async (_, project) => {
      const emitted = await emitCopyOf(project);

      expect(emitted.output).toContain(
        `[CONTRACT.REQUIRED_CAPABILITIES_NOT_LISTED] ${project.warning}`,
      );
      expect(emitted.contract).toHaveProperty('capabilities', defaultCapabilities);
    },
  );

  it('ready source: the contract it emits again creates a client with no warning, which runs a query and transaction()', async () => {
    const emitted = await emitCopyOf(projects.readySource);

    await withDevDatabase(async ({ connectionString }) => {
      await runDbInit({ connectionString, contractJsonPath: emitted.contractJsonPath });

      const log = spyLog();
      const db = postgres({
        contract: contractFromJson<PrismaSchemaContract>(emitted.contract),
        url: connectionString,
        log,
      });
      try {
        await db.transaction(async (tx) => {
          await tx.orm.public.FeatureFlag.create({ key: 'inside', enabled: true });
        });

        expect(await db.orm.public.FeatureFlag.select('key', 'enabled').all()).toEqual([
          { key: 'inside', enabled: true },
        ]);
        expect(log.warn).not.toHaveBeenCalled();
      } finally {
        await db.close();
      }
    });
  });

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
