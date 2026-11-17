import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateContractDeps } from '../../src/utils/validate-contract-deps';

let project: string;

function installPackage(name: string, manifest: Record<string, unknown>): void {
  const dir = join(project, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, ...manifest }));
}

function outputDir(): string {
  return join(project, 'src', 'prisma');
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'cli-validate-contract-deps-'));
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'app' }));
  installPackage('@acme/orm-db', { exports: { './generated-types': './generated-types.js' } });
  installPackage('prisma-orm-standin', {});
  mkdirSync(outputDir(), { recursive: true });
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe('validateContractDeps', () => {
  it('finds the package of every module installed, whatever subpaths it exports', () => {
    const result = validateContractDeps(
      ['@acme/orm-db/generated-types', '@acme/orm-db/not-exported', 'prisma-orm-standin/migration'],
      outputDir(),
    );

    expect(result).toEqual({ missing: [] });
  });

  it('does not check # imports or relative modules', () => {
    const result = validateContractDeps(
      ['#generated-types', './contract.json', '../shared/types'],
      outputDir(),
    );

    expect(result).toEqual({ missing: [] });
  });

  it('names each package that is not installed once, scoped or not', () => {
    const result = validateContractDeps(
      [
        '@nonexistent-scope/fake-package/types',
        '@nonexistent-scope/fake-package/more',
        'unscoped-missing/types',
      ],
      outputDir(),
    );

    expect(result).toEqual({
      missing: ['@nonexistent-scope/fake-package', 'unscoped-missing'],
      warning: [
        'contract.d.ts imports types from packages that are not installed:',
        '  - @nonexistent-scope/fake-package',
        '  - unscoped-missing',
        '',
        'Install them with your package manager:',
        '  @nonexistent-scope/fake-package',
        '  unscoped-missing',
      ].join('\n'),
    });
  });

  it('accepts a relative output directory', () => {
    const result = validateContractDeps(
      ['@acme/orm-db/generated-types', 'unscoped-missing'],
      `./${relative(process.cwd(), outputDir())}`,
    );

    expect(result.missing).toEqual(['unscoped-missing']);
  });
});
