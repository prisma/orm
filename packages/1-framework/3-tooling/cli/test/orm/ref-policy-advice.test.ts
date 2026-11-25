import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupRefProjects, harness } from './ref-fixtures';
import { PLAIN_REF, projectWithRef } from './ref-policy-fixtures';

afterEach(cleanupRefProjects);

const REPO_ROOT = join(import.meta.dirname, '../../../../../..');
const PACKAGES = join(REPO_ROOT, 'packages');
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.turbo', 'coverage']);

/** The files that may name the commands: the commands themselves, and where the CLI mounts them and declares their group. */
const NAMING_FILES = [
  'packages/1-framework/3-tooling/cli/src/orm/cli.ts',
  'packages/1-framework/3-tooling/cli/src/orm/family.ts',
];
const COMMAND_DIRECTORY = 'packages/1-framework/3-tooling/cli/src/orm/ref/policy/';

function sourceFiles(dir: string, inSrc: boolean): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, inSrc || entry.name === 'src');
    return inSrc && /\.(ts|tsx|mts|js|mjs|json|md)$/.test(entry.name) ? [path] : [];
  });
}

describe('advice about ref policies', () => {
  it('names the policy commands only in their own files and where the CLI mounts them', () => {
    const files = sourceFiles(PACKAGES, false).map((path) => relative(REPO_ROOT, path));
    const naming = files.filter((path) =>
      /ref policy/.test(readFileSync(join(REPO_ROOT, path), 'utf-8')),
    );

    expect(files.length).toBeGreaterThan(500);
    expect(naming.filter((path) => !path.startsWith(COMMAND_DIRECTORY)).sort()).toEqual(
      NAMING_FILES,
    );
  });

  it('never names the consent flag in any output of the policy commands', async () => {
    const { dir } = await projectWithRef('production', {
      ...PLAIN_REF,
      policies: { change: ['migrate'], dataProtection: { dataLoss: 'data-loss-forbidden' } },
    });
    const invocations = [
      ['--help'],
      ['show', '--help'],
      ['set', '--help'],
      ['delete', '--help'],
      ['show', 'production'],
      ['show', 'production', '--json'],
      ['set', 'production', '--change', 'migrate', '--change', 'reconcile'],
      ['set', 'production', '--data-loss', 'permitted', '--access-widening', 'permitted', '--json'],
      ['set', 'production', '--data-loss', 'permitted'],
      ['set', 'production', '--data-loss', 'never'],
      ['set', 'production'],
      ['set', 'head', '--change', 'migrate'],
      ['set', 'staging', '--change', 'migrate'],
      ['delete', 'production', 'change', 'data-loss', 'access-widening'],
      ['delete', 'production', 'change', '--json'],
      ['delete', 'production'],
      ['delete', 'production', 'push'],
    ];

    const outputs: string[] = [];
    for (const args of invocations) {
      const run = await harness().run(['migration', 'ref', 'policy', ...args], {
        cwd: dir,
        isTty: { stdout: true, stderr: true },
      });
      outputs.push(`${args.join(' ')}\n${run.stdout}${run.stderr}${JSON.stringify(run.json)}`);
    }

    expect(outputs.filter((output) => output.includes('--permit-policy-change'))).toEqual([]);
    expect(outputs.join('\n')).toContain('loosens');
  });
});
