import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { timeouts } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { InitContribution } from '../../src/commands/init/init-contribution';
import { resolveTargetName } from '../../src/commands/init/input-values';
import type { InitContractSource, ResolvedInitInputs } from '../../src/orm/init-inputs';
import { scaffoldProject } from '../../src/orm/init-scaffold';
import { loadOrmConfig } from '../../src/orm/load-config';
import { fixtureContribution } from '../utils/fixture-contribution';
import { createTestProjectDir } from '../utils/test-project-dir';
import { PRISMA7_POSTGRES_SCHEMA } from './init-prisma7-fixtures';

const target = resolveTargetName('postgres', 'flag');
let contribution: InitContribution;
let projectDir: string;

beforeAll(async () => {
  contribution = await fixtureContribution(target.packageName);
});

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-config-loads');
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function inputs(schemaPath: string, contractSource: InitContractSource): ResolvedInitInputs {
  return {
    target,
    contribution,
    authoring: contractSource.kind === 'starter' ? contractSource.authoring : 'psl',
    schemaPath,
    contractSource,
    sideBySide: null,
    warnings: [],
    install: false,
    requiredPeers: { facade: target.packageName, packages: [], unread: [], warnings: [] },
    preinstalled: [],
    writeEnv: false,
    probeDb: false,
    strictProbe: false,
    reinit: false,
    removePreviousFacade: null,
  };
}

async function loadWrittenConfig(resolved: ResolvedInitInputs) {
  await scaffoldProject({ cwd: projectDir, inputs: resolved, packageManager: 'pnpm' });
  return loadOrmConfig({ cwd: projectDir });
}

describe('the config init writes for PostgreSQL', { timeout: timeouts.coldTransformImport }, () => {
  it.each([
    ['psl', 'src/prisma/contract.prisma'],
    ['typescript', 'src/prisma/contract.ts'],
  ] as const)('loads for a fresh project with a %s contract', async (authoring, schemaPath) => {
    const loaded = await loadWrittenConfig(
      inputs(schemaPath, { kind: 'starter', authoring, schemaPath }),
    );

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.files).toHaveLength(1);
  });

  it('loads for a project that keeps its Prisma 7 schema', async () => {
    const schemaPath = 'prisma/schema.prisma';
    mkdirSync(join(projectDir, dirname(schemaPath)), { recursive: true });
    writeFileSync(join(projectDir, schemaPath), PRISMA7_POSTGRES_SCHEMA, 'utf-8');
    const quickReference = contribution.prisma7QuickReference;
    if (quickReference === undefined) {
      throw new Error(`${target.packageName} has no Prisma 7 quick reference`);
    }

    const loaded = await loadWrittenConfig(
      inputs(schemaPath, {
        kind: 'prisma7-schema',
        schemaPath,
        provider: 'postgresql',
        prisma7Config: undefined,
        quickReference,
      }),
    );

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.files).toHaveLength(1);
  });
});
