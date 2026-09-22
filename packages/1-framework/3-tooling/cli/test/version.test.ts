import { spawnSync } from 'node:child_process';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import packageJson from '../package.json' with { type: 'json' };

const binPath = join(import.meta.dirname, '../dist/bin.mjs');

describe('prisma --version', () => {
  it('--version reports the package.json version in the completed envelope', {
    timeout: timeouts.coldTransformImport,
  }, () => {
    const result = spawnSync(process.execPath, [binPath, '--version', '--format', 'json'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split('\n');
    const last = JSON.parse(lines.at(-1) ?? '{}');
    expect(last).toMatchObject({
      kind: 'result',
      envelope: { ok: true, result: { version: packageJson.version }, exitCode: 0 },
    });
  });
});
