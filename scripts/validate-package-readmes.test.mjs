import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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
});
