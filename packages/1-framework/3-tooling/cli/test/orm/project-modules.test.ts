import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importFromProject } from '../../src/orm/project-modules';
import { createTestProjectDir } from '../utils/test-project-dir';

let projectDir: string;

beforeEach(() => {
  projectDir = createTestProjectDir('project-modules');
});

afterEach(() => {
  vi.unstubAllEnvs();
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
    [
      'the node-addons condition Node turns on by default',
      { './init': { 'node-addons': './init.mjs' } },
    ],
    [
      'a matched condition with nothing inside, falling back to default',
      { './init': { node: { types: './init.d.ts' }, default: './init.mjs' } },
    ],
  ])('loads an export given as %s', async (_case, exports) => {
    writePackage({ type: 'module', exports }, { 'init.mjs': 'export default 42;\n' });

    await expect(importFromProject(projectDir, 'acme-db/init')).resolves.toMatchObject({
      kind: 'loaded',
      module: { default: 42 },
    });
  });

  it('reads an export target as a URL, as Node does', async () => {
    writePackage(
      { type: 'module', exports: { './init': './init%20entry.mjs' } },
      { 'init entry.mjs': 'export default 42;\n' },
    );

    await expect(importFromProject(projectDir, 'acme-db/init')).resolves.toMatchObject({
      kind: 'loaded',
      module: { default: 42 },
    });
  });

  it('says a package whose package.json does not parse cannot be loaded', async () => {
    writeFile('node_modules/acme-db/package.json', '{ not json');

    const result = await importFromProject(projectDir, 'acme-db/init');

    expect(result).toMatchObject({ kind: 'unloadable' });
    expect(String(Reflect.get(result, 'cause'))).toContain('acme-db');
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

  describe('when the child Node that resolves the export misbehaves', () => {
    beforeEach(() => {
      writePackage(
        { type: 'module', exports: { './init': './init.mjs' } },
        { 'init.mjs': 'export default 42;\n' },
      );
    });

    it('ignores what a NODE_OPTIONS preload prints', async () => {
      writeFile('noisy-preload.cjs', "console.log('{ preload says hello');\n");
      vi.stubEnv('NODE_OPTIONS', `--require ${join(projectDir, 'noisy-preload.cjs')}`);

      await expect(importFromProject(projectDir, 'acme-db/init')).resolves.toMatchObject({
        kind: 'loaded',
        module: { default: 42 },
      });
    });

    it('says the export cannot be loaded when the child exits with an error', async () => {
      vi.stubEnv('NODE_OPTIONS', '--no-such-node-option');

      const result = await importFromProject(projectDir, 'acme-db/init');

      expect(result).toMatchObject({ kind: 'unloadable' });
      expect(String(Reflect.get(result, 'cause'))).toContain('--no-such-node-option');
    });

    it('says the export cannot be loaded when the child cannot start', async () => {
      const execPath = process.execPath;
      process.execPath = join(projectDir, 'no-such-runtime');
      try {
        const result = await importFromProject(projectDir, 'acme-db/init');

        expect(result).toMatchObject({ kind: 'unloadable' });
        expect(String(Reflect.get(result, 'cause'))).toContain('no-such-runtime');
      } finally {
        process.execPath = execPath;
      }
    });
  });
});
