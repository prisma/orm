import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importSubpaths, installShells, packShell, runInScratch } from '@repo/tsdown/shell-testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const shellDir = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('@prisma/orm-framework tarball smoke test', () => {
  let scratch: string;
  let installedDir: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'orm-framework-smoke-'));
    installShells(scratch, [packShell(shellDir, scratch)]);
    installedDir = join(scratch, 'node_modules', '@prisma', 'orm-framework');
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('resolves and imports every declared entrypoint', () => {
    const subpaths = importSubpaths(installedDir);
    expect(subpaths.length).toBeGreaterThan(40);
    const script = [
      `const subpaths = ${JSON.stringify(subpaths)};`,
      'for (const subpath of subpaths) {',
      `  await import('@prisma/orm-framework' + subpath.slice(1));`,
      '}',
      `console.log('resolved ' + subpaths.length);`,
    ].join('\n');
    expect(runInScratch(scratch, script)).toContain(`resolved ${subpaths.length}`);
  });

  it('keeps shared internal modules identical across entrypoints', () => {
    const script = `
      import { strict as assert } from 'node:assert';
      const pslParser = await import('@prisma/orm-framework/psl-parser');
      const pslAst = await import('@prisma/orm-framework/components/psl-ast');
      assert.equal(pslParser.flatPslModels, pslAst.flatPslModels);
      const contract = await import('@prisma/orm-framework/contract/is-plain-record');
      const ir = await import('@prisma/orm-framework/components/ir');
      assert.equal(contract.isPlainRecord, ir.isPlainRecord);
      console.log('identity ok');
    `;
    expect(runInScratch(scratch, script)).toContain('identity ok');
  });
});
