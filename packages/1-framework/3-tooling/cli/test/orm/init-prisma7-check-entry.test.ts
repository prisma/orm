import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { JsonValue } from '@internal/utils/json';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InitContribution } from '../../src/commands/init/init-contribution';
import { createPrisma7SourceCheck } from '../../src/orm/init-prisma7-check';
import {
  type ImportFromProject,
  importFromProject,
  type ProjectImport,
} from '../../src/orm/project-modules';
import { fixtureContribution } from '../utils/fixture-contribution';
import { createTestProjectDir } from '../utils/test-project-dir';
import { PRISMA7_POSTGRES_SCHEMA } from './init-prisma7-fixtures';

const PACKAGE = '@prisma/orm-postgres';
const TARGET_CONFIG = '@internal/postgres/config';
const OTHER_MODULE = '@internal/postgres/other';
const SCHEMA_PATH = 'prisma/schema.prisma';

let projectDir: string;
let imports: (readonly [cwd: string, specifier: string])[];

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-prisma7-check-entry');
  mkdirSync(join(projectDir, 'prisma'), { recursive: true });
  writeFileSync(join(projectDir, SCHEMA_PATH), PRISMA7_POSTGRES_SCHEMA, 'utf-8');
  imports = [];
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

/** The real config module, and `otherModule` for the module the entry calls into. */
async function importsWith(otherModule: ProjectImport): Promise<ImportFromProject> {
  const config = await importFromProject(projectDir, TARGET_CONFIG);
  return async (cwd, specifier) => {
    imports.push([cwd, specifier]);
    return specifier === OTHER_MODULE ? otherModule : config;
  };
}

/** The arguments the real contribution's Prisma 7 entry passes. */
async function realPrisma7Args(): Promise<readonly JsonValue[]> {
  const entry = (await fixtureContribution(PACKAGE)).contractEntry?.({
    kind: 'prisma7-schema',
    path: SCHEMA_PATH,
  });
  if (entry === undefined || !('call' in entry)) {
    throw new Error(`${PACKAGE} gives no call for a Prisma 7 schema`);
  }
  return entry.call.args;
}

/** The real contribution, with its Prisma 7 entry calling `symbol` from another module. */
async function callingOtherModule(symbol: string): Promise<InitContribution> {
  const real = await fixtureContribution(PACKAGE);
  const args = await realPrisma7Args();
  return {
    ...real,
    contractEntry: () => ({ call: { moduleSpecifier: OTHER_MODULE, symbol, args } }),
  };
}

async function check(contribution: InitContribution, importer: ImportFromProject) {
  return createPrisma7SourceCheck({ cwd: projectDir, importFromProject: importer })({
    packageName: PACKAGE,
    contribution,
    schemaPath: SCHEMA_PATH,
  });
}

describe('the Prisma 7 check runs a contract entry that calls into another module', {
  timeout: timeouts.coldTransformImport,
}, () => {
  it('imports that module from the project and calls the export with the arguments', async () => {
    const config = await importFromProject(projectDir, TARGET_CONFIG);
    const realPrisma7Schema = config.kind === 'loaded' ? config.module['prisma7Schema'] : undefined;
    if (typeof realPrisma7Schema !== 'function') {
      throw new Error(`${TARGET_CONFIG} exports no prisma7Schema`);
    }
    const calls: unknown[][] = [];
    const readSchema = (...args: unknown[]) => {
      calls.push(args);
      return Reflect.apply(realPrisma7Schema, undefined, args);
    };

    const result = await check(
      await callingOtherModule('readSchema'),
      await importsWith({ kind: 'loaded', module: { readSchema } }),
    );

    expect(result.outcome).toBe('readable');
    expect(calls).toEqual([await realPrisma7Args()]);
    expect(imports).toEqual([
      [projectDir, TARGET_CONFIG],
      [projectDir, OTHER_MODULE],
    ]);
  });

  it.each([
    [
      'cannot be found',
      { kind: 'not-installed' } as const,
      {
        reason: 'not-resolvable',
        why: `${PACKAGE} was installed, but the project cannot find \`${OTHER_MODULE}\`, a module its init contribution names, so init cannot check that Prisma 8 reads ${SCHEMA_PATH}.`,
      },
    ],
    [
      'throws while loading',
      { kind: 'unloadable', cause: new Error('boom') } as const,
      {
        reason: 'unloadable',
        why: `\`${OTHER_MODULE}\` could not be loaded: boom. init cannot check that Prisma 8 reads ${SCHEMA_PATH}.`,
      },
    ],
  ])('refuses when that module %s, and writes nothing', async (_case, otherModule, refusal) => {
    const before = readdirSync(projectDir, { recursive: true });

    await expect(
      check(await callingOtherModule('readSchema'), await importsWith(otherModule)),
    ).rejects.toMatchObject({
      code: 'CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE',
      why: refusal.why,
      meta: { reason: refusal.reason, module: OTHER_MODULE },
    });
    expect(readdirSync(projectDir, { recursive: true })).toEqual(before);
  });

  it('refuses an entry whose export is not a function', async () => {
    await expect(
      check(
        await callingOtherModule('readSchema'),
        await importsWith({ kind: 'loaded', module: { readSchema: 'not a function' } }),
      ),
    ).rejects.toMatchObject({
      code: 'CLI.INIT_CONTRIBUTION_UNAVAILABLE',
      why: expect.stringContaining(
        `its contractEntry calls readSchema from ${OTHER_MODULE}, which exports no function of that name`,
      ),
    });
  });
});

describe('the Prisma 7 check runs a value entry', { timeout: timeouts.coldTransformImport }, () => {
  it('gives the value to defineConfig as it is', async () => {
    const real = await fixtureContribution(PACKAGE);
    const contribution: InitContribution = {
      ...real,
      contractEntry: (input) => ({ value: input.path }),
    };

    await expect(
      check(contribution, await importsWith({ kind: 'not-installed' })),
    ).rejects.toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: expect.stringContaining(`contract: { path: '${SCHEMA_PATH}', databaseVersion:`),
    });
    expect(imports).toEqual([[projectDir, TARGET_CONFIG]]);
  });
});
