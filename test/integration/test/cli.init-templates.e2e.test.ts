import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AuthoringId,
  configFile,
  dbFile,
  starterSchema,
  type TargetId,
} from '../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates';
import {
  defaultTsConfig,
  REQUIRED_COMPILER_OPTIONS,
} from '../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/tsconfig';
import { createIntegrationTestDir } from './utils/cli-test-helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const tscPath = resolve(__dirname, '../node_modules/.bin/tsc');
const CONFIG_LOADER_ENTRY = resolve(
  __dirname,
  '../../../packages/1-framework/3-tooling/config-loader/dist/exports/index.mjs',
);

/**
 * Loads a config file through the CLI's own loader chain in a fresh process
 * and prints the resolved `db` section as JSON. Arguments: the config-loader
 * entry URL, then the config file path.
 */
const PROBE_SCRIPT = `\
const [, , loaderEntry, configPath] = process.argv;
const { loadConfigForSections } = await import(loaderEntry);
const loaded = await loadConfigForSections(configPath, [
  'contract',
  'family',
  'target',
  'adapter',
  'extensions',
]);
if (!loaded.ok) {
  console.error(\`probe failed: \${loaded.failure.code}\`);
  process.exit(1);
}
console.log(JSON.stringify(loaded.value.db ?? null));
`;

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
): { schemaPath: string; configPath: string } {
  const ext = authoring === 'typescript' ? 'ts' : 'prisma';
  const schemaPath = `prisma/contract.${ext}`;
  const schemaDir = dirname(schemaPath);

  mkdirSync(join(testDir, schemaDir), { recursive: true });
  writeFileSync(join(testDir, schemaPath), starterSchema(target, authoring), 'utf-8');

  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, configFile(target, `./${schemaPath}`), 'utf-8');

  writeFileSync(join(testDir, schemaDir, 'db.ts'), dbFile(target), 'utf-8');
  writeFileSync(join(testDir, 'tsconfig.json'), defaultTsConfig(), 'utf-8');

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
      projectDir: dirname(configPath),
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

const CELLS: ReadonlyArray<{ readonly target: TargetId; readonly authoring: AuthoringId }> = [
  { target: 'postgres', authoring: 'psl' },
  { target: 'postgres', authoring: 'typescript' },
  { target: 'mongo', authoring: 'psl' },
  { target: 'mongo', authoring: 'typescript' },
];

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

  // FR2.3: a freshly-initialised project typechecks across all four
  // (target × authoring) cells. Each cell is the full chain `init` users
  // see: scaffolded contract source + `prisma.config.ts` (with the
  // `import 'dotenv/config'` and `process.env['DATABASE_URL']!` shape that
  // requires `@types/node`) + `prisma/db.ts` (which imports `./contract.d`
  // and `./contract.json`) + emitted contract artefacts.
  for (const { target, authoring } of CELLS) {
    it(
      `${target} + ${authoring}: full project typechecks after emit`,
      async () => {
        const { configPath } = writeInitFiles(testDir, target, authoring);
        await emitContract(testDir, configPath);

        expect({
          contractJson: existsSync(join(testDir, 'prisma', 'contract.json')),
          contractDts: existsSync(join(testDir, 'prisma', 'contract.d.ts')),
        }).toMatchObject({ contractJson: true, contractDts: true });

        await typecheck(testDir);
      },
      TYPECHECK_TIMEOUT,
    );
  }

  // prisma/orm#30116: the scaffolded config reads `DATABASE_URL` and the
  // CLI's config loader does not read `.env` itself, so the config file's
  // `import 'dotenv/config'` is what makes a `DATABASE_URL` that exists only
  // in `.env` resolve. Without it, every command that loads the config fails
  // on a missing environment variable.
  describe('config loads DATABASE_URL from .env', () => {
    for (const { target, authoring } of CELLS) {
      it(
        `${target} + ${authoring}: db.connection resolves from .env alone`,
        async () => {
          const { configPath } = writeInitFiles(testDir, target, authoring);
          const databaseUrl =
            target === 'postgres'
              ? 'postgresql://user:password@localhost:5432/mydb'
              : 'mongodb://user:password@localhost:27017/mydb';
          writeFileSync(join(testDir, '.env'), `DATABASE_URL="${databaseUrl}"\n`, 'utf-8');

          // The load runs in a subprocess: jiti caches `dotenv/config` for
          // the lifetime of a process, so only the first config evaluation
          // in the vitest worker would load `.env` and later cells would
          // see an unset `DATABASE_URL` regardless of the template.
          const probePath = join(testDir, 'probe-db-connection.mjs');
          writeFileSync(probePath, PROBE_SCRIPT, 'utf-8');
          const childEnv: Record<string, string> = {};
          for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined && key !== 'DATABASE_URL') {
              childEnv[key] = value;
            }
          }
          const { stdout } = await execFileAsync(
            process.execPath,
            [probePath, CONFIG_LOADER_ENTRY, configPath],
            { cwd: testDir, env: childEnv },
          );

          expect(JSON.parse(stdout)).toEqual({ connection: databaseUrl });
        },
        timeouts.coldTransformImport,
      );
    }
  });
});
