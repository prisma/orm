import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ContractEntryNode,
  InitContribution,
} from '../../src/commands/init/init-contribution';
import { createPrisma7SourceCheck } from '../../src/orm/init-prisma7-check';
import { type ImportFromProject, importFromProject } from '../../src/orm/project-modules';
import { fixtureContribution } from '../utils/fixture-contribution';
import { createTestProjectDir } from '../utils/test-project-dir';
import { PRISMA7_POSTGRES_SCHEMA } from './init-prisma7-fixtures';

const PACKAGE = '@prisma/orm-postgres';
const TARGET_CONFIG = '@internal/postgres/config';
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

async function recordingImports(): Promise<ImportFromProject> {
  return async (cwd, specifier) => {
    imports.push([cwd, specifier]);
    return importFromProject(cwd, specifier);
  };
}

/** The real contribution, with its contract entry replaced by `entry`. */
async function withEntry(entry: (path: string) => unknown): Promise<InitContribution> {
  const real = await fixtureContribution(PACKAGE);
  return Object.assign({}, real, { contractEntry: ({ path }: { path: string }) => entry(path) });
}

function nodeWithValue(value: ContractEntryNode['contractValue']): ContractEntryNode {
  return {
    renderTypeScript: () => 'unused',
    importRequirements: () => [],
    contractValue: value,
  };
}

async function check(contribution: InitContribution) {
  return createPrisma7SourceCheck({ cwd: projectDir, importFromProject: await recordingImports() })(
    { packageName: PACKAGE, contribution, schemaPath: SCHEMA_PATH },
  );
}

describe('the Prisma 7 check runs the contract entry node', {
  timeout: timeouts.coldTransformImport,
}, () => {
  it("gives defineConfig the value the real contribution's node builds, importing nothing but the config module", async () => {
    const real = await fixtureContribution(PACKAGE);

    const result = await check(real);

    expect(result.outcome).toBe('readable');
    expect(imports).toEqual([[projectDir, TARGET_CONFIG]]);
  });

  it('builds the value with the node, once, from the exports of the config module', async () => {
    const real = await fixtureContribution(PACKAGE);
    const config = await importFromProject(projectDir, TARGET_CONFIG);
    const given: unknown[] = [];
    const contribution = await withEntry((path) => {
      const node = real.contractEntry?.({ kind: 'prisma7-schema', path });
      if (node === undefined) throw new Error(`${PACKAGE} gives no contract entry`);
      return nodeWithValue((exports) => {
        given.push(exports);
        return node.contractValue(exports);
      });
    });

    await expect(check(contribution)).resolves.toMatchObject({ outcome: 'readable' });
    expect(given).toEqual([config.kind === 'loaded' ? config.module : undefined]);
  });

  it('passes on the refusal of a value the config does not accept, and writes nothing', async () => {
    const before = readdirSync(projectDir, { recursive: true });
    const contribution = await withEntry((path) => nodeWithValue(() => ({ path })));

    await expect(check(contribution)).rejects.toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: expect.stringContaining('The list is missing.'),
    });
    expect(readdirSync(projectDir, { recursive: true })).toEqual(before);
  });

  it("runs the CLI's own entry node for a contribution that gives none, calling the config module's prisma7Schema with the path alone", async () => {
    const real = await fixtureContribution(PACKAGE);
    const contribution = Object.assign({}, real, { contractEntry: undefined });

    await expect(check(contribution)).rejects.toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: `State the capabilities your contract requires in requiredCapabilities in the options of prisma7Schema('${SCHEMA_PATH}'). The list is missing.`,
    });
    expect(imports).toEqual([[projectDir, TARGET_CONFIG]]);
  });

  it('refuses an entry that is not a node', async () => {
    const contribution = await withEntry((path) => ({ value: path }));

    await expect(check(contribution)).rejects.toMatchObject({
      code: 'CLI.INIT_CONTRIBUTION_UNAVAILABLE',
      why: expect.stringContaining(
        'its contractEntry returned no contract entry node with the methods renderTypeScript, importRequirements, contractValue',
      ),
    });
  });
});
