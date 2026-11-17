import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateContractDeps } from '../../src/utils/validate-contract-deps';

let project: string;

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'cli-validate-contract-deps-'));
  writeJson(join(project, 'package.json'), {
    name: 'app',
    imports: { '#generated-types': './src/generated-types.ts' },
  });
  writeJson(join(project, 'node_modules', '@acme', 'orm-db', 'package.json'), {
    name: '@acme/orm-db',
    exports: { './generated-types': './dist/generated-types.mjs', './codecs/*': './dist/*.mjs' },
  });
  writeJson(join(project, 'node_modules', 'prisma-orm-standin', 'package.json'), {
    name: 'prisma-orm-standin',
  });
  mkdirSync(join(project, 'src', 'prisma'), { recursive: true });
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe('validateContractDeps', () => {
  it('finds every module the generated file imports, by its package exports or the project imports', () => {
    const result = validateContractDeps(
      [
        '@acme/orm-db/generated-types',
        '@acme/orm-db/codecs/vector',
        '#generated-types',
        'prisma-orm-standin/anything',
        './contract.json',
      ],
      join(project, 'src', 'prisma'),
    );

    expect(result).toEqual({ missing: [] });
  });

  it('reports a package that is not installed, a subpath its package does not export, and a # import the project does not declare', () => {
    const result = validateContractDeps(
      [
        '@nonexistent-scope/fake-package/types',
        '@acme/orm-db/types',
        '#missing-types',
        'unscoped-missing/types',
      ],
      join(project, 'src', 'prisma'),
    );

    expect(result.missing).toEqual([
      '@nonexistent-scope/fake-package/types',
      '@acme/orm-db/types',
      '#missing-types',
      'unscoped-missing/types',
    ]);
    expect(result.warning).toContain('  - #missing-types');
  });

  it('accepts a relative project root', () => {
    const result = validateContractDeps(
      ['@acme/orm-db/generated-types'],
      `./${relative(process.cwd(), join(project, 'src', 'prisma'))}`,
    );

    expect(result).toEqual({ missing: [] });
  });
});
