import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

describe('validate package READMEs', () => {
  it('allows READMEs with title and Responsibilities but no Dependencies section', () => {
    const root = mkdtempSync(join(tmpdir(), 'validate-package-readmes-'));

    try {
      mkdirSync(join(root, 'packages/example/src'), { recursive: true });
      writeFileSync(
        join(root, 'packages/example/README.md'),
        '# Example package\n\n## Responsibilities\n\nThis package wraps a tiny example.',
        'utf8',
      );

      const result = spawnSync(
        process.execPath,
        [join(process.cwd(), 'scripts/validate-package-readmes.mjs')],
        {
          cwd: root,
          encoding: 'utf8',
        },
      );

      assert.equal(result.status, 0);
      const output = `${result.stdout || ''}${result.stderr || ''}`;
      assert.doesNotMatch(output, /Dependencies/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails when package discovery fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'validate-package-readmes-'));

    try {
      const result = spawnSync(
        process.execPath,
        [join(process.cwd(), 'scripts/validate-package-readmes.mjs')],
        {
          cwd: root,
          encoding: 'utf8',
        },
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Failed to list package source directories/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires each published package to state the level levels.ts declares', () => {
    const root = mkdtempSync(join(tmpdir(), 'validate-package-readmes-'));
    const run = () =>
      spawnSync(process.execPath, [join(process.cwd(), 'scripts/validate-package-readmes.mjs')], {
        cwd: root,
        encoding: 'utf8',
      });

    try {
      const dir = join(root, 'packages/9-public/@prisma/orm-mongo');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@prisma/orm-mongo' }));
      writeFileSync(
        join(dir, 'README.md'),
        '# @prisma/orm-mongo\n\n> **From `8.0.0` this package is Generally Available.**\n',
      );
      const wrong = run();
      writeFileSync(
        join(dir, 'README.md'),
        '# @prisma/orm-mongo\n\n> **From `8.0.0` this package is in Preview.**\n',
      );
      const right = run();

      assert.deepEqual(
        {
          wrong: wrong.status,
          names: wrong.stderr.includes('orm-mongo/README.md'),
          right: right.status,
        },
        { wrong: 1, names: true, right: 0 },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
