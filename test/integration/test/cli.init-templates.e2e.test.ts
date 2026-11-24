import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { InitContribution } from '@internal/cli/init-contribution';
import type { ContractSourceFormat } from '@internal/config/config-types';
import mongoContribution from '@internal/mongo/init';
import mysqlContribution from '@internal/mysql/init';
import postgresContribution from '@internal/postgres/init';
import sqliteContribution from '@internal/sqlite/init';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configFile } from '../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates';
import {
  defaultTsConfig,
  mergeTsConfig,
  REQUIRED_COMPILER_OPTIONS,
} from '../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/tsconfig';
import { createIntegrationTestDir } from './utils/cli-test-helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

type TargetId = 'postgres' | 'mongo' | 'sqlite' | 'mysql';
type AuthoringId = ContractSourceFormat;

const CONTRIBUTIONS: Record<TargetId, InitContribution> = {
  postgres: postgresContribution,
  mongo: mongoContribution,
  sqlite: sqliteContribution,
  mysql: mysqlContribution,
};
const tscPath = resolve(__dirname, '../node_modules/.bin/tsc');

/**
 * Mirrors the file set `runInit` writes for a fresh project (no pre-existing
 * tsconfig). We exercise the templates directly rather than calling `runInit`
 * because the FR2.3 acceptance criterion is about the templates' composition
 * (`prisma.config.ts` + `prisma/db.ts` + `tsconfig.json` + emitted
 * contract artefacts) typechecking together; `runInit`'s surrounding I/O
 * (hygiene file merges, install spawn, prompts) is unit-tested elsewhere
 * (`init.test.ts`, `hygiene.test.ts`, `tsconfig-env.test.ts`) and is not what
 * `tsc --noEmit` exercises.
 */
function writeInitFiles(
  testDir: string,
  target: TargetId,
  authoring: AuthoringId,
  tsconfig: string,
): { schemaPath: string; configPath: string } {
  const ext = authoring === 'typescript' ? 'ts' : 'prisma';
  const schemaPath = `prisma/contract.${ext}`;
  const schemaDir = dirname(schemaPath);

  mkdirSync(join(testDir, schemaDir), { recursive: true });
  const contribution = CONTRIBUTIONS[target];
  writeFileSync(join(testDir, schemaPath), contribution.starterContract(authoring), 'utf-8');

  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, configFile(`./${schemaPath}`, contribution.configModule), 'utf-8');

  writeFileSync(join(testDir, schemaDir, 'db.ts'), contribution.databaseFile(), 'utf-8');
  writeFileSync(join(testDir, 'tsconfig.json'), tsconfig, 'utf-8');

  return { schemaPath, configPath };
}

async function emitContract(testDir: string, configPath: string): Promise<void> {
  const { executeContractEmit } = await import(
    '../../../packages/1-framework/3-tooling/cli/src/control-api/operations/contract-emit'
  );
  const { loadConfigForSections } = await import('@internal/config-loader');

  const originalCwd = process.cwd();
  try {
    process.chdir(testDir);
    const loaded = await loadConfigForSections(configPath, [
      'contract',
      'family',
      'target',
      'adapter',
      'extensions',
    ]);
    if (!loaded.ok) {
      throw loaded.failure;
    }
    await executeContractEmit({
      config: loaded.value,
      cwd: testDir,
    });
  } finally {
    process.chdir(originalCwd);
  }
}

async function typecheck(testDir: string): Promise<void> {
  if (!existsSync(tscPath)) {
    throw new Error(`tsc not found at ${tscPath}`);
  }
  try {
    await execFileAsync(tscPath, ['--noEmit', '--project', 'tsconfig.json'], {
      cwd: testDir,
    });
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    const details = [execError.stdout, execError.stderr, execError.message]
      .filter(Boolean)
      .join('\n');
    throw new Error(`tsc --noEmit failed in ${testDir}:\n${details}`);
  }
}

const TYPECHECK_TIMEOUT = timeouts.typeScriptCompilation;

interface ContractHashes {
  readonly storageHash: string;
  readonly executionHash?: string;
  readonly profileHash: string;
}

const POSTGRES_PROFILE_HASH = 'ae77f23935a24b8a63c81ef26bb0f186581670a56e603cef8314a629414e2632';
const MONGO_PROFILE_HASH = '8fe2b3350db5a83e2473520e59e52262982215115e17bb22a76239170eee6e69';
const SQLITE_PROFILE_HASH = '595b5c7dd6da0c70556bef798d80d453ba856772e83382b1b62238623cbd8790';
const MYSQL_PROFILE_HASH = 'a76864aec3e51292e5212754c5fa96988ddc2ce190204c23855cf9c5e5c5f5fa';

/** The hashes of each starter's contract. A template change that changes a starter's contract changes them. */
const CELLS: ReadonlyArray<{
  readonly target: TargetId;
  readonly authoring: AuthoringId;
  readonly hashes: ContractHashes;
}> = [
  {
    target: 'postgres',
    authoring: 'psl',
    hashes: {
      storageHash: '2291d86bb5a03397fc1be7e3082cf69d683f9fadd85cfa96de8da701dce20e39',
      executionHash: '9cff59780b7c673f5ee513c956d8d060bf403ba1c536c660f78704521ed5b4a9',
      profileHash: POSTGRES_PROFILE_HASH,
    },
  },
  {
    target: 'postgres',
    authoring: 'typescript',
    hashes: {
      storageHash: 'f0904497fbf22810445721e4f023981d03a691ab167b98ad1670fe8db0bf5c16',
      executionHash: '8a230035c801786beda6062a49558130a032fcd4442eaf124c363df2cd1eaa77',
      profileHash: POSTGRES_PROFILE_HASH,
    },
  },
  {
    target: 'mongo',
    authoring: 'psl',
    hashes: {
      storageHash: 'dbcd7e612c8991f8dc34ad93dc862643eff97cfe61d0f112f55cd4857ff6982e',
      profileHash: MONGO_PROFILE_HASH,
    },
  },
  {
    target: 'mongo',
    authoring: 'typescript',
    hashes: {
      storageHash: '31995de9d9e436c7bd523a346597b1d6a6f7bbca947a66c0cca558d42dcab037',
      profileHash: MONGO_PROFILE_HASH,
    },
  },
  {
    target: 'sqlite',
    authoring: 'psl',
    hashes: {
      storageHash: 'c880a71b373304bad573a37199c7724238390cb194f375b1ec178660c6fbe303',
      executionHash: 'f02c7dd2d8b80559c46f3ec6b3ee7a76566ab2a5ed3e5442478441fed05a1e8f',
      profileHash: SQLITE_PROFILE_HASH,
    },
  },
  {
    target: 'sqlite',
    authoring: 'typescript',
    hashes: {
      storageHash: '7c854047a8a888412230755fbe3f9edbfd9cb5099332f4f88f87c2f32b7a8d2e',
      executionHash: '01ccf09871aaa5f48234a0113287cab9ed4896e14fe3bd9bd3807fe49976a8aa',
      profileHash: SQLITE_PROFILE_HASH,
    },
  },
  {
    target: 'mysql',
    authoring: 'psl',
    hashes: {
      storageHash: 'b023d25fa8d3f20c3fa36c03dea388403623d3a438567701dc72e82cc0a63f3a',
      executionHash: 'bb6011974d46754c0023e978f782fd5895592f78ae2f841901ce88b25f3660f4',
      profileHash: MYSQL_PROFILE_HASH,
    },
  },
  {
    target: 'mysql',
    authoring: 'typescript',
    hashes: {
      storageHash: '7f068c4653abe214b732a3cd33430f8c45659da1163b7b080b2a75b9ab5769db',
      executionHash: '46e6861fd2112d201964231c2434341b3f07e749cd86dc4648358c9191d3eecf',
      profileHash: MYSQL_PROFILE_HASH,
    },
  },
];

function emittedHashes(testDir: string): ContractHashes {
  const contract = JSON.parse(readFileSync(join(testDir, 'prisma', 'contract.json'), 'utf-8')) as {
    readonly profileHash: string;
    readonly storage: { readonly storageHash: string };
    readonly execution?: { readonly executionHash: string };
  };
  return {
    storageHash: contract.storage.storageHash,
    ...(contract.execution === undefined
      ? {}
      : { executionHash: contract.execution.executionHash }),
    profileHash: contract.profileHash,
  };
}

describe('init generates a typecheckable project', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createIntegrationTestDir();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('generated tsconfig includes all required compiler options', () => {
    const config = JSON.parse(defaultTsConfig()) as Record<string, unknown>;
    const opts = config['compilerOptions'] as Record<string, unknown>;

    for (const [key, value] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
      expect(opts[key], `compilerOptions.${key}`).toBe(value);
    }
  });

  // FR2.3: a freshly-initialised project typechecks across every
  // (target × authoring) cells. Each cell is the full chain `init` users
  // see: scaffolded contract source + `prisma.config.ts` (with the
  // `import 'dotenv/config'` and `process.env['DATABASE_URL']!` shape that
  // requires `@types/node`) + `prisma/db.ts` (which imports `./contract.d.js`
  // and `./contract.json`) + emitted contract artefacts.
  for (const { target, authoring, hashes } of CELLS) {
    it(
      `${target} + ${authoring}: emits the starter contract's hashes and typechecks`,
      async () => {
        const { configPath } = writeInitFiles(testDir, target, authoring, defaultTsConfig());
        await emitContract(testDir, configPath);

        expect({
          contractJson: existsSync(join(testDir, 'prisma', 'contract.json')),
          contractDts: existsSync(join(testDir, 'prisma', 'contract.d.ts')),
        }).toMatchObject({ contractJson: true, contractDts: true });
        expect(emittedHashes(testDir)).toEqual(hashes);

        await typecheck(testDir);
      },
      TYPECHECK_TIMEOUT,
    );
  }

  const NODENEXT_TSCONFIG = JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'nodenext',
      moduleResolution: 'nodenext',
      strict: true,
      skipLibCheck: true,
    },
  });

  for (const { target, authoring } of CELLS) {
    it(
      `${target} + ${authoring}: an ES module project on nodenext keeps it and typechecks`,
      async () => {
        const tsconfig = mergeTsConfig(NODENEXT_TSCONFIG, 'module');
        expect(JSON.parse(tsconfig).compilerOptions).toMatchObject({
          module: 'nodenext',
          moduleResolution: 'nodenext',
        });
        const { configPath } = writeInitFiles(testDir, target, authoring, tsconfig);
        await emitContract(testDir, configPath);

        await typecheck(testDir);
      },
      TYPECHECK_TIMEOUT,
    );
  }
});
