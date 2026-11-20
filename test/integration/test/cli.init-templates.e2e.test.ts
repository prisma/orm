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

const POSTGRES_PROFILE_HASH = '3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2';
const MONGO_PROFILE_HASH = '251b3ce23f6c9f561892e7c1af9d2cc941a13d64ba1aa7226b90036b09568cc3';
const SQLITE_PROFILE_HASH = '260b8608d1aacaf1f690779a6cff39a12947c599597c5ba464ca75b9e775df53';
const MYSQL_PROFILE_HASH = '5212eb1a1220f2d24de13f4efadd4c703f3a1098a5f57e09da0dc26ebb7201d0';

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
      storageHash: '920a87b50729a867e21706dd0fa5c3739e273a84ed89eb2f3525633b2d6ef85c',
      executionHash: '0ff7f5c55037616d53a67c7c581c1178658b41c7a674a85dd59fc3b8f9dd8a49',
      profileHash: POSTGRES_PROFILE_HASH,
    },
  },
  {
    target: 'postgres',
    authoring: 'typescript',
    hashes: {
      storageHash: 'd901307c194c817cfa0a28ababa391bd1b2342a2ebb5f8ac3280534f2295f96f',
      executionHash: 'c478b201602051bfaeddbe71eb44664a34764bf959a3d00c206e7dcf71393533',
      profileHash: POSTGRES_PROFILE_HASH,
    },
  },
  {
    target: 'mongo',
    authoring: 'psl',
    hashes: {
      storageHash: 'bdf84c83adcc796638599553a64e4fc95ddda80ce50f4cc0d34c348404705ac3',
      profileHash: MONGO_PROFILE_HASH,
    },
  },
  {
    target: 'mongo',
    authoring: 'typescript',
    hashes: {
      storageHash: '530517580da72a6b8c5800c90776cbbe73272007bcfac6c8418c202a6f6ea5b4',
      profileHash: MONGO_PROFILE_HASH,
    },
  },
  {
    target: 'sqlite',
    authoring: 'psl',
    hashes: {
      storageHash: '057e2e5025d03e9bad7973158b5e0d195d824c0e11f6518cd68a049d84af8b2a',
      executionHash: '6a55777d5f51e57189d17f214f1decf0d1ee4cff0fd12c141707cf7fd5e37dda',
      profileHash: SQLITE_PROFILE_HASH,
    },
  },
  {
    target: 'sqlite',
    authoring: 'typescript',
    hashes: {
      storageHash: 'e8c6b55da273ae62cd82898bbba8dc818a79eebd2b45639c364a977cf600de52',
      executionHash: '3c0829282bfb14800598318a98f795990cdff27501ab82540adfb6334939ac6c',
      profileHash: SQLITE_PROFILE_HASH,
    },
  },
  {
    target: 'mysql',
    authoring: 'psl',
    hashes: {
      storageHash: 'b79a338d0cb4947e5e5196dccfc66056c75df0047d50d30c73d247c55d98ea65',
      executionHash: 'cd95b7242e7b62e7ae3034802f0768b948cfaf9c4a6f2a6d78614cc2311d0362',
      profileHash: MYSQL_PROFILE_HASH,
    },
  },
  {
    target: 'mysql',
    authoring: 'typescript',
    hashes: {
      storageHash: '40b2792d6591923f25adbc1f9841f0fc2247514ee51862885acaa86201912452',
      executionHash: '85d521eeef0d411b07dde5cb23f035535f9033ded707549052b29a30402e03b9',
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
