import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { storageHashHex } from '@internal/framework-components/control';
import { join, resolve } from 'pathe';
import { afterEach, beforeEach } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageRoot, '../../../..');
const tsxPath = join(repoRoot, 'node_modules/.bin/tsx');
const exportUrl = (path: string) => pathToFileURL(resolve(repoRoot, path)).href;

/** The module a rendered `migration.ts` imports its factories from, as a file URL into the workspace. */
export const factoryExport = pathToFileURL(join(packageRoot, 'src/exports/migration.ts')).href;

const configSource = [
  `import mongoAdapter from '${exportUrl('packages/3-targets/mongo/2-adapter/src/exports/control.ts')}';`,
  `import { defineConfig } from '${exportUrl('packages/1-framework/3-tooling/cli/src/exports/config-types.ts')}';`,
  `import { mongoFamilyDescriptor } from '${exportUrl('packages/2-mongo-family/9-family/src/exports/control.ts')}';`,
  `import { mongoTargetDescriptor } from '${exportUrl('packages/3-targets/mongo/1-target/src/exports/control.ts')}';`,
  '',
  'export default { $prismaConfig: 1, orm: defineConfig({',
  '  family: mongoFamilyDescriptor,',
  '  target: mongoTargetDescriptor,',
  '  adapter: mongoAdapter,',
  "  migrations: { dir: '.' },",
  '}) };',
  '',
].join('\n');

/**
 * A scratch migration directory for each test: writes a `migration.ts` with its config and contract
 * snapshots, runs it with `tsx`, and reads the `ops.json` it writes.
 */
export function useMigrationDirectory(snapshotsImportPath: string) {
  let directory = '';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'migration-file-'));
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await writeFile(join(directory, 'prisma.config.ts'), configSource);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function writeMigration(
    source: string,
    meta: { readonly from: string | null; readonly to: string },
  ): Promise<void> {
    await writeFile(join(directory, 'migration.ts'), source);
    const contractType =
      'export type Contract = { readonly storage: { readonly storageHash: string } };\n';
    for (const storageHash of [meta.to, ...(meta.from === null ? [] : [meta.from])]) {
      const snapshot = join(directory, snapshotsImportPath, storageHashHex(storageHash));
      await mkdir(snapshot, { recursive: true });
      await writeFile(
        join(snapshot, 'contract.json'),
        JSON.stringify({ storage: { storageHash } }),
      );
      await writeFile(join(snapshot, 'contract.ts'), contractType);
    }
  }

  async function runMigration(): Promise<{ readonly exitCode: number; readonly stderr: string }> {
    try {
      await execFileAsync(tsxPath, [join(directory, 'migration.ts')], { cwd: directory });
      return { exitCode: 0, stderr: '' };
    } catch (error) {
      const failed = error as { stderr?: string; code?: number };
      return { exitCode: failed.code ?? 1, stderr: failed.stderr ?? '' };
    }
  }

  async function readOps(): Promise<unknown> {
    return JSON.parse(await readFile(join(directory, 'ops.json'), 'utf-8'));
  }

  return { writeMigration, runMigration, readOps };
}
