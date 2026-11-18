import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importFromProject } from '../../src/orm/project-modules';
import { createTestProjectDir } from '../utils/test-project-dir';

let projectDir: string;

beforeEach(() => {
  projectDir = createTestProjectDir('project-modules');
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function writeFile(relative: string, content: string): void {
  mkdirSync(join(projectDir, dirname(relative)), { recursive: true });
  writeFileSync(join(projectDir, relative), content, 'utf-8');
}

function writePackage(manifest: Record<string, unknown>, files: Record<string, string> = {}) {
  writeFile('node_modules/acme-db/package.json', JSON.stringify({ name: 'acme-db', ...manifest }));
  for (const [file, content] of Object.entries(files)) {
    writeFile(`node_modules/acme-db/${file}`, content);
  }
}

describe('importFromProject', () => {
  it('says a package the project does not have is not installed', async () => {
    await expect(importFromProject(projectDir, 'no-such-package-anywhere/init')).resolves.toEqual({
      kind: 'not-installed',
    });
  });

  it('says a subpath the package does not export is not exported', async () => {
    writePackage({ exports: { './config': './config.mjs' } });

    await expect(importFromProject(projectDir, 'acme-db/init')).resolves.toEqual({
      kind: 'not-exported',
    });
  });

  it.each([
    ['a plain string', { './init': './init.mjs' }],
    ['the import condition only', { './init': { import: './init.mjs' } }],
    [
      'a nested condition with a fallback',
      { './init': { types: './init.d.ts', node: { import: './init.mjs' } } },
    ],
    ['a subpath pattern', { './*': './*.mjs' }],
  ])('loads an export given as %s', async (_case, exports) => {
    writePackage({ type: 'module', exports }, { 'init.mjs': 'export default 42;\n' });

    await expect(importFromProject(projectDir, 'acme-db/init')).resolves.toMatchObject({
      kind: 'loaded',
      module: { default: 42 },
    });
  });

  it('loads a package with no exports field the way Node requires it', async () => {
    writePackage({}, { 'init.js': 'module.exports = 42;\n' });

    const result = await importFromProject(projectDir, 'acme-db/init');

    expect(result.kind).toBe('loaded');
    expect(result.kind === 'loaded' ? result.module['default'] : undefined).toBe(42);
  });

  it('says an export whose file is missing cannot be loaded', async () => {
    writePackage({ exports: { './init': './dist/init.mjs' } });

    const result = await importFromProject(projectDir, 'acme-db/init');

    expect(result).toMatchObject({ kind: 'unloadable' });
    expect(String(Reflect.get(result, 'cause'))).toContain('dist/init.mjs, which does not exist');
  });

  it('carries the error a module throws while it loads', async () => {
    writePackage(
      { type: 'module', exports: { './init': './init.mjs' } },
      { 'init.mjs': "throw new Error('init exploded');\n" },
    );

    const result = await importFromProject(projectDir, 'acme-db/init');

    expect(result).toMatchObject({ kind: 'unloadable', cause: new Error('init exploded') });
  });
});
