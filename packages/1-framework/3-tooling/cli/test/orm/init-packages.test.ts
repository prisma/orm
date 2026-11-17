import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { PackageOperations } from '@prisma/cli-engine';
import { CliStructuredError, notOk, okVoid } from '@prisma/cli-engine/protocol';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installProjectDependencies } from '../../src/orm/init-packages';
import { createTestProjectDir } from '../utils/test-project-dir';
import {
  IGNORED_BUILDS_WARNING,
  PNPM_12_IGNORED_BUILDS,
  resolveWithin,
} from './init-install-fixtures';

type InstallRequest = Parameters<PackageOperations['install']>[0];

let projectDir: string;
let requests: InstallRequest[];
let results: Awaited<ReturnType<PackageOperations['install']>>[];

const packages: PackageOperations = {
  install: async (request) => {
    requests.push(request);
    return results.shift() ?? okVoid();
  },
  run: async () => okVoid(),
};

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-packages');
  requests = [];
  results = [];
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value), 'utf-8');
}

function writeToolchain(dir: string, peers: Record<string, string>): void {
  writeJson(join(dir, 'package.json'), {
    name: '@prisma/orm-toolchain',
    version: '8.0.0',
    peerDependencies: peers,
  });
}

function writeTarget(dir: string): void {
  writeJson(join(dir, 'package.json'), { name: '@prisma/orm-postgres', version: '8.0.0' });
}

function install(cwd: string, deps: readonly string[] = ['@prisma/orm-postgres', 'dotenv']) {
  return installProjectDependencies({
    packages,
    cwd,
    deps,
    targetPackage: '@prisma/orm-postgres',
    devDeps: ['prisma@latest'],
    catalogWarnings: [],
    resolveModule: resolveWithin(projectDir),
  });
}

function pnpmIgnoredBuilds() {
  return notOk(
    new CliStructuredError('CLI.PACKAGE_INSTALL_FAILED', 'pnpm add failed', {
      meta: { manager: 'pnpm', stderrTail: PNPM_12_IGNORED_BUILDS },
    }),
  );
}

describe('the engine version init installs', () => {
  it('reads the toolchain nested under the target package', async () => {
    const target = join(projectDir, 'node_modules/@prisma/orm-postgres');
    writeTarget(target);
    writeToolchain(join(target, 'node_modules/@prisma/orm-toolchain'), {
      '@prisma/cli-engine': '0.1.1',
    });

    const outcome = await install(projectDir);

    expect(outcome.devDeps).toEqual(['prisma@latest', '@prisma/cli-engine@0.1.1']);
  });

  it('reads the toolchain beside the target package in a pnpm store', async () => {
    const store = join(projectDir, 'node_modules/.pnpm/target/node_modules/@prisma');
    writeTarget(join(store, 'orm-postgres'));
    writeToolchain(join(store, 'orm-toolchain'), { '@prisma/cli-engine': '0.1.1' });
    mkdirSync(join(projectDir, 'node_modules/@prisma'), { recursive: true });
    symlinkSync(
      join(store, 'orm-postgres'),
      join(projectDir, 'node_modules/@prisma/orm-postgres'),
      'junction',
    );

    const outcome = await install(projectDir);

    expect(outcome.devDeps).toEqual(['prisma@latest', '@prisma/cli-engine@0.1.1']);
  });

  it('reads the toolchain hoisted to a parent folder of the project', async () => {
    const app = join(projectDir, 'packages/app');
    writeJson(join(app, 'package.json'), { name: 'app' });
    writeTarget(join(projectDir, 'node_modules/@prisma/orm-postgres'));
    writeToolchain(join(projectDir, 'node_modules/@prisma/orm-toolchain'), {
      '@prisma/cli-engine': '0.1.1',
    });

    const outcome = await install(app);

    expect(outcome.devDeps).toEqual(['prisma@latest', '@prisma/cli-engine@0.1.1']);
  });

  it('falls back to the latest tag when the toolchain manifest is unreadable', async () => {
    const target = join(projectDir, 'node_modules/@prisma/orm-postgres');
    writeTarget(target);
    const toolchain = join(target, 'node_modules/@prisma/orm-toolchain');
    mkdirSync(toolchain, { recursive: true });
    writeFileSync(join(toolchain, 'package.json'), '{ not json', 'utf-8');

    const outcome = await install(projectDir);

    expect(outcome.devDeps).toEqual(['prisma@latest', '@prisma/cli-engine@latest']);
  });

  it('falls back to the latest tag when the toolchain declares no engine peer', async () => {
    const target = join(projectDir, 'node_modules/@prisma/orm-postgres');
    writeTarget(target);
    writeToolchain(join(target, 'node_modules/@prisma/orm-toolchain'), {});

    const outcome = await install(projectDir);

    expect(outcome.devDeps).toEqual(['prisma@latest', '@prisma/cli-engine@latest']);
  });
});

describe('a pnpm add that failed only over ignored build scripts', () => {
  it('counts as installed when its first package resolves from the project', async () => {
    writeTarget(join(projectDir, 'node_modules/@prisma/orm-postgres'));
    writeJson(join(projectDir, 'node_modules/prisma/package.json'), { name: 'prisma' });
    results = [pnpmIgnoredBuilds(), pnpmIgnoredBuilds()];

    const outcome = await install(projectDir);

    expect(outcome).toEqual({
      failure: undefined,
      devDeps: ['prisma@latest', '@prisma/cli-engine@latest'],
      manager: undefined,
      warnings: [IGNORED_BUILDS_WARNING],
    });
  });

  it('returns the install failure when its first package does not resolve', async () => {
    const failed = pnpmIgnoredBuilds();
    results = [failed];

    const outcome = await install(projectDir);

    expect(outcome).toEqual({
      failure: failed.failure,
      devDeps: [],
      manager: undefined,
      warnings: [],
    });
    expect(requests).toHaveLength(1);
  });

  it('counts a package whose manifest is not exported as present', async () => {
    writeJson(join(projectDir, 'node_modules/closed/package.json'), {
      name: 'closed',
      exports: { '.': './index.js' },
    });
    results = [pnpmIgnoredBuilds()];

    const outcome = await install(projectDir, ['closed@^1.0.0']);

    expect(outcome.failure).toBeUndefined();
  });
});
