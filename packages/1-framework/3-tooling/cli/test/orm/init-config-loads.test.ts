import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { timeouts } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { InitContribution } from '../../src/commands/init/init-contribution';
import { resolveTargetName } from '../../src/commands/init/input-values';
import { KNOWN_TARGET_PACKAGES, type TargetPackage } from '../../src/commands/init/target-packages';
import type { InitContractSource, ResolvedInitInputs } from '../../src/orm/init-inputs';
import { scaffoldProject } from '../../src/orm/init-scaffold';
import { loadOrmConfig } from '../../src/orm/load-config';
import { fixtureContribution } from '../utils/fixture-contribution';
import { createTestProjectDir } from '../utils/test-project-dir';
import { PRISMA7_POSTGRES_SCHEMA } from './init-prisma7-fixtures';

const CASES = KNOWN_TARGET_PACKAGES.map((entry) => ({
  label: entry.label,
  target: resolveTargetName(entry.shortName, 'flag'),
  prisma7: entry.provider.writtenBy === 7,
}));
const contributions = new Map<string, InitContribution>();
let projectDir: string;

beforeAll(async () => {
  for (const { target } of CASES) {
    contributions.set(target.packageName, await fixtureContribution(target.packageName));
  }
});

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-config-loads');
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function contributionOf(target: TargetPackage): InitContribution {
  const contribution = contributions.get(target.packageName);
  if (contribution === undefined) {
    throw new Error(`${target.packageName} was not loaded`);
  }
  return contribution;
}

function inputs(
  target: TargetPackage,
  schemaPath: string,
  contractSource: InitContractSource,
): ResolvedInitInputs {
  return {
    target,
    contribution: contributionOf(target),
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

describe.each(CASES)('the config init writes for $label', ({ target }) => {
  it.each([
    ['psl', 'src/prisma/contract.prisma'],
    ['typescript', 'src/prisma/contract.ts'],
  ] as const)(
    'loads for a fresh project with a %s contract',
    async (authoring, schemaPath) => {
      const loaded = await loadWrittenConfig(
        inputs(target, schemaPath, { kind: 'starter', authoring, schemaPath }),
      );

      expect(loaded.diagnostics).toEqual([]);
      expect(loaded.files).toHaveLength(1);
    },
    timeouts.coldTransformImport,
  );
});

describe.each(CASES.filter((entry) => entry.prisma7))(
  'the config init writes for $label',
  ({ target }) => {
    it(
      'loads for a project that keeps its Prisma 7 schema',
      async () => {
        const quickReference = contributionOf(target).prisma7QuickReference;
        if (quickReference === undefined) {
          throw new Error(`${target.packageName} has no Prisma 7 quick reference`);
        }
        const schemaPath = 'prisma/schema.prisma';
        mkdirSync(join(projectDir, dirname(schemaPath)), { recursive: true });
        writeFileSync(join(projectDir, schemaPath), PRISMA7_POSTGRES_SCHEMA, 'utf-8');

        const loaded = await loadWrittenConfig(
          inputs(target, schemaPath, {
            kind: 'prisma7-schema',
            schemaPath,
            provider: target.listed?.provider.name,
            prisma7Config: undefined,
            quickReference,
          }),
        );

        expect(loaded.diagnostics).toEqual([]);
        expect(loaded.files).toHaveLength(1);
      },
      timeouts.coldTransformImport,
    );
  },
);
