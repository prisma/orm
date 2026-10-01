import { execFile, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { storageHashHex } from '@internal/framework-components/control';
import { writeMigrationTs } from '@internal/migration-tools/migration-ts';
import { join, resolve } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SNAPSHOTS_IMPORT_PATH = './snapshots';
const execFileAsync = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageRoot, '../../..');
const tsxPath = join(repoRoot, 'node_modules/.bin/tsx');

const familyMongoRoot = resolve(repoRoot, 'packages/2-mongo-family/9-family');
const migrationExport = pathToFileURL(join(familyMongoRoot, 'src/exports/migration.ts')).href;
const factoryExport = pathToFileURL(join(packageRoot, 'src/exports/migration.ts')).href;
const cliMigrationCliExport = pathToFileURL(
  resolve(repoRoot, 'packages/1-framework/3-tooling/cli/src/migration-cli.ts'),
).href;
const cliConfigTypesExport = pathToFileURL(
  resolve(repoRoot, 'packages/1-framework/3-tooling/cli/src/exports/config-types.ts'),
).href;
const familyMongoControlExport = pathToFileURL(
  resolve(familyMongoRoot, 'src/exports/control.ts'),
).href;
const targetMongoControlExport = pathToFileURL(
  resolve(repoRoot, 'packages/3-mongo-target/1-mongo-target/src/exports/control.ts'),
).href;
const adapterMongoControlExport = pathToFileURL(
  resolve(repoRoot, 'packages/3-mongo-target/2-mongo-adapter/src/exports/control.ts'),
).href;

/**
 * `MigrationCLI.run` requires a `prisma.config.ts` to assemble a
 * `ControlStack`. Tests have no workspace `node_modules` resolution from
 * `tmpDir`, so we write a bespoke config alongside `migration.ts` whose
 * imports all use absolute `file://` URLs into the live workspace
 * sources. The driver is omitted — the E2E exercises the serialization
 * path only and never opens a MongoDB connection.
 */
const fixtureConfigSource = [
  `import mongoAdapter from '${adapterMongoControlExport}';`,
  `import { defineConfig } from '${cliConfigTypesExport}';`,
  `import { mongoFamilyDescriptor } from '${familyMongoControlExport}';`,
  `import { mongoTargetDescriptor } from '${targetMongoControlExport}';`,
  '',
  'export default { $prismaConfig: 1, orm: defineConfig({',
  '  family: mongoFamilyDescriptor,',
  '  target: mongoTargetDescriptor,',
  '  adapter: mongoAdapter,',
  '}) };',
  '',
].join('\n');

/**
 * `MigrationCLI.run(..., --dry-run)` prints both `--- migration.json ---` and
 * `--- ops.json ---` sections to stdout. Tests only care about the ops body,
 * so this helper extracts it.
 */
function extractDryRunOpsSection(stdout: string): string {
  const marker = '--- ops.json ---\n';
  const idx = stdout.indexOf(marker);
  if (idx < 0) return stdout;
  return stdout.slice(idx + marker.length);
}

describe('migration file E2E', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'migration-e2e-'));
    await writeFile(join(tmpDir, 'package.json'), '{"type":"module"}');
    await writeFile(join(tmpDir, 'prisma.config.ts'), fixtureConfigSource);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function runFile(
    filename: string,
    args: string[] = [],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const filePath = join(tmpDir, filename);
    try {
      const result = await execFileAsync(tsxPath, [filePath, ...args], { cwd: tmpDir });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (error) {
      const e = error as { stdout: string; stderr: string; code: number };
      return { stdout: e.stdout || '', stderr: e.stderr || '', exitCode: e.code || 1 };
    }
  }

  /**
   * The rendered (new-shape) scaffold imports its from/to identity from the
   * deduplicated snapshot store. Write minimal `snapshots/<hex>/contract.json`
   * (carrying `storage.storageHash`, which the base's derived describe()
   * reads) and the matching `snapshots/<hex>/contract.ts` type module for
   * each of `meta.to` and (when non-null) `meta.from` so the executed
   * migration resolves its imports; the hashes match `meta` so describe() is
   * consistent. `SNAPSHOTS_IMPORT_PATH` matches the `snapshotsImportPath`
   * baked into the rendered source.
   */
  async function writeContractFixtures(meta: {
    readonly from: string | null;
    readonly to: string;
  }): Promise<void> {
    const contractType =
      'export type Contract = { readonly storage: { readonly storageHash: string } };\n';
    const writeSnapshot = async (storageHash: string) => {
      const snapshotDir = join(tmpDir, SNAPSHOTS_IMPORT_PATH, storageHashHex(storageHash));
      await mkdir(snapshotDir, { recursive: true });
      await writeFile(
        join(snapshotDir, 'contract.json'),
        JSON.stringify({ storage: { storageHash } }, null, 2),
      );
      await writeFile(join(snapshotDir, 'contract.ts'), contractType);
    };
    await writeSnapshot(meta.to);
    if (meta.from !== null) {
      await writeSnapshot(meta.from);
    }
  }

  describe('factory-based migration', () => {
    const factoryMigration = [
      `import { MigrationCLI } from '${cliMigrationCliExport}';`,
      `import { Migration } from '${migrationExport}';`,
      `import { createIndex, createCollection } from '${factoryExport}';`,
      '',
      'class M extends Migration {',
      "  describe() { return { from: '00', to: '01' }; }",
      '  get operations() {',
      '    return [',
      '      createCollection("users", {',
      '        validator: { $jsonSchema: { required: ["email"] } },',
      '        validationLevel: "strict",',
      '      }),',
      '      createIndex("users", [{ field: "email", direction: 1 }], { unique: true }),',
      '    ];',
      '  }',
      '}',
      'export default M;',
      '',
      'MigrationCLI.run(import.meta.url, M);',
    ].join('\n');

    it('produces ops.json with correct structure', async () => {
      await writeFile(join(tmpDir, 'migration.ts'), factoryMigration);

      const result = await runFile('migration.ts');
      expect(result.exitCode).toBe(0);

      const opsJson = await readFile(join(tmpDir, 'ops.json'), 'utf-8');
      const ops = JSON.parse(opsJson);

      expect(ops).toHaveLength(2);
      expect(ops[0].id).toBe('collection.users.create');
      expect(ops[0].operationClass).toBe('additive');
      expect(ops[0].execute[0].command.kind).toBe('createCollection');

      expect(ops[1].id).toContain('index.users.create');
      expect(ops[1].execute[0].command.kind).toBe('createIndex');
      expect(ops[1].execute[0].command.unique).toBe(true);
    });

    it('prints operations with --dry-run and does not write ops.json', async () => {
      await writeFile(join(tmpDir, 'migration.ts'), factoryMigration);

      const result = await runFile('migration.ts', ['--dry-run']);
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(extractDryRunOpsSection(result.stdout));
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe('collection.users.create');

      const opsExists = await readFile(join(tmpDir, 'ops.json'), 'utf-8').catch(() => null);
      expect(opsExists).toBeNull();
    });
  });

  describe('strategy-based migration', () => {
    const strategyMigration = [
      `import { MigrationCLI } from '${cliMigrationCliExport}';`,
      `import { Migration } from '${migrationExport}';`,
      `import { validatedCollection } from '${factoryExport}';`,
      '',
      'class M extends Migration {',
      "  describe() { return { from: '00', to: '01' }; }",
      '  get operations() {',
      '    return validatedCollection(',
      '      "users",',
      '      { required: ["email", "name"] },',
      '      [{ keys: [{ field: "email", direction: 1 }], unique: true }],',
      '    );',
      '  }',
      '}',
      'export default M;',
      '',
      'MigrationCLI.run(import.meta.url, M);',
    ].join('\n');

    it('produces ops.json from strategy composition', async () => {
      await writeFile(join(tmpDir, 'migration.ts'), strategyMigration);

      const result = await runFile('migration.ts');
      expect(result.exitCode).toBe(0);

      const opsJson = await readFile(join(tmpDir, 'ops.json'), 'utf-8');
      const ops = JSON.parse(opsJson);

      expect(ops).toHaveLength(2);

      expect(ops[0].id).toBe('collection.users.create');
      expect(ops[0].execute[0].command.validator).toEqual({
        $jsonSchema: { required: ['email', 'name'] },
      });
      expect(ops[0].execute[0].command.validationLevel).toBe('strict');

      expect(ops[1].id).toContain('index.users.create');
      expect(ops[1].execute[0].command.unique).toBe(true);
    });
  });

  describe('renderCallsToTypeScript round-trip', () => {
    const defaultMeta = {
      from: '0'.repeat(64),
      to: '1'.repeat(64),
      snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
    } as const;

    it('produces ops.json identical to direct factory invocation', async () => {
      const { renderCallsToTypeScript } = await import('../src/core/migrations/render-typescript');
      const { CreateCollectionCall, CreateIndexCall } = await import(
        '../src/core/migrations/op-factory-call'
      );
      const calls = [
        new CreateCollectionCall('users', {
          validator: { $jsonSchema: { required: ['email'] } },
          validationLevel: 'strict',
        }),
        new CreateIndexCall('users', [{ field: 'email', direction: 1 as const }], { unique: true }),
      ];

      const tsSource = renderCallsToTypeScript(calls, defaultMeta);
      const resolvedSource = tsSource.replace(
        "'@internal/target-mongo/migration'",
        `'${factoryExport}'`,
      );
      await writeFile(join(tmpDir, 'migration.ts'), resolvedSource);
      await writeContractFixtures(defaultMeta);

      const result = await runFile('migration.ts');
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));

      expect(ops).toHaveLength(2);
      expect(ops[0].id).toBe('collection.users.create');
      expect(ops[0].operationClass).toBe('additive');
      expect(ops[0].execute[0].command.kind).toBe('createCollection');
      expect(ops[0].execute[0].command.validator).toEqual({ $jsonSchema: { required: ['email'] } });

      expect(ops[1].id).toContain('index.users.create');
      expect(ops[1].execute[0].command.kind).toBe('createIndex');
      expect(ops[1].execute[0].command.unique).toBe(true);
    });

    it('round-trips collMod with meta through TypeScript execution', async () => {
      const { renderCallsToTypeScript } = await import('../src/core/migrations/render-typescript');
      const { CollModCall } = await import('../src/core/migrations/op-factory-call');
      const calls = [
        new CollModCall(
          'users',
          {
            validator: { $jsonSchema: { required: ['email'] } },
            validationLevel: 'strict',
            validationAction: 'error',
          },
          {
            id: 'validator.users.add',
            label: 'Add validator on users',
            operationClass: 'destructive',
          },
        ),
      ];

      const tsSource = renderCallsToTypeScript(calls, defaultMeta);
      const resolvedSource = tsSource.replace(
        "'@internal/target-mongo/migration'",
        `'${factoryExport}'`,
      );
      await writeFile(join(tmpDir, 'migration.ts'), resolvedSource);
      await writeContractFixtures(defaultMeta);

      const result = await runFile('migration.ts');
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));

      expect(ops).toHaveLength(1);
      expect(ops[0].id).toBe('validator.users.add');
      expect(ops[0].label).toBe('Add validator on users');
      expect(ops[0].operationClass).toBe('destructive');
      expect(ops[0].execute[0].command.kind).toBe('collMod');
    });

    it('round-trips describe() meta through TypeScript execution', async () => {
      const { renderCallsToTypeScript } = await import('../src/core/migrations/render-typescript');
      const { DropCollectionCall } = await import('../src/core/migrations/op-factory-call');
      const calls = [new DropCollectionCall('legacy')];

      const meta = {
        from: 'a'.repeat(64),
        to: 'b'.repeat(64),
        snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
      } as const;
      const tsSource = renderCallsToTypeScript(calls, meta);
      const resolvedSource = tsSource.replace(
        "'@internal/target-mongo/migration'",
        `'${factoryExport}'`,
      );
      await writeFile(join(tmpDir, 'migration.ts'), resolvedSource);
      await writeContractFixtures(meta);

      const result = await runFile('migration.ts');
      expect(result.exitCode).toBe(0);

      const opsJson = await readFile(join(tmpDir, 'ops.json'), 'utf-8');
      const ops = JSON.parse(opsJson);
      expect(ops).toHaveLength(1);
      expect(ops[0].id).toBe('collection.legacy.drop');

      const manifestJson = await readFile(join(tmpDir, 'migration.json'), 'utf-8');
      const manifest = JSON.parse(manifestJson);
      expect(manifest.from).toBe(meta.from);
      expect(manifest.to).toBe(meta.to);
    });
  });

  describe('data transform migration', () => {
    const dataTransformMigration = [
      `import { MigrationCLI } from '${cliMigrationCliExport}';`,
      `import { Migration } from '${migrationExport}';`,
      `import { createCollection, dataTransform } from '${factoryExport}';`,
      '',
      'class M extends Migration {',
      "  describe() { return { from: '00', to: '01' }; }",
      '  get operations() {',
      '    return [',
      '      createCollection("users"),',
      '      dataTransform("backfill-status", {',
      '        run: () => ({',
      '          collection: "users",',
      '          command: {',
      '            kind: "rawUpdateMany" as const,',
      '            collection: "users",',
      '            filter: { status: { $exists: false } },',
      '            update: { $set: { status: "active" } },',
      '          },',
      '          meta: { target: "mongo", storageHash: "x", lane: "mongo-raw" },',
      '        }),',
      '      }),',
      '    ];',
      '  }',
      '}',
      'export default M;',
      '',
      'MigrationCLI.run(import.meta.url, M);',
    ].join('\n');

    it('produces ops.json with mixed DDL and data transform operations', async () => {
      await writeFile(join(tmpDir, 'migration.ts'), dataTransformMigration);

      const result = await runFile('migration.ts');
      expect(result.exitCode).toBe(0);

      const opsJson = await readFile(join(tmpDir, 'ops.json'), 'utf-8');
      const ops = JSON.parse(opsJson);

      expect(ops).toHaveLength(2);

      expect(ops[0].operationClass).toBe('additive');
      expect(ops[0].execute[0].command.kind).toBe('createCollection');

      expect(ops[1].operationClass).toBe('data');
      expect(ops[1].name).toBe('backfill-status');
      expect(ops[1].precheck).toHaveLength(0);
      expect(ops[1].postcheck).toHaveLength(0);
      expect(ops[1].run).toHaveLength(1);
      expect(ops[1].run[0].command.kind).toBe('rawUpdateMany');
    });

    it('produces ops.json with check object', async () => {
      const migrationWithCheck = [
        `import { MigrationCLI } from '${cliMigrationCliExport}';`,
        `import { Migration } from '${migrationExport}';`,
        `import { dataTransform } from '${factoryExport}';`,
        '',
        'class M extends Migration {',
        "  describe() { return { from: '00', to: '01' }; }",
        '  get operations() {',
        '    return [',
        '      dataTransform("backfill-with-check", {',
        '        check: {',
        '          source: () => ({',
        '            collection: "users",',
        '            command: {',
        '              kind: "rawAggregate" as const,',
        '              collection: "users",',
        '              pipeline: [{ $match: { status: { $exists: false } } }, { $limit: 1 }],',
        '            },',
        '            meta: { target: "mongo", storageHash: "x", lane: "mongo-raw" },',
        '          }),',
        '        },',
        '        run: () => ({',
        '          collection: "users",',
        '          command: {',
        '            kind: "rawUpdateMany" as const,',
        '            collection: "users",',
        '            filter: { status: { $exists: false } },',
        '            update: { $set: { status: "active" } },',
        '          },',
        '          meta: { target: "mongo", storageHash: "x", lane: "mongo-raw" },',
        '        }),',
        '      }),',
        '    ];',
        '  }',
        '}',
        'export default M;',
        '',
        'MigrationCLI.run(import.meta.url, M);',
      ].join('\n');

      await writeFile(join(tmpDir, 'migration.ts'), migrationWithCheck);

      const result = await runFile('migration.ts');
      expect(result.exitCode).toBe(0);

      const opsJson = await readFile(join(tmpDir, 'ops.json'), 'utf-8');
      const ops = JSON.parse(opsJson);

      expect(ops).toHaveLength(1);
      const op = ops[0];
      expect(op.operationClass).toBe('data');
      expect(op.name).toBe('backfill-with-check');
      expect(op.precheck).toHaveLength(1);
      expect(op.precheck[0].source.command.kind).toBe('rawAggregate');
      expect(op.precheck[0].expect).toBe('exists');
      expect(op.postcheck).toHaveLength(1);
    });
  });

  describe('scaffolded migration is directly runnable', () => {
    const familyMongoDistMigrationPath = join(familyMongoRoot, 'dist/migration.mjs');
    const targetMongoDistMigrationPath = join(packageRoot, 'dist/migration.mjs');
    const cliMigrationCliDistPath = resolve(
      repoRoot,
      'packages/1-framework/3-tooling/cli/dist/migration-cli.mjs',
    );
    // Only the target's dist is named directly: the scaffold imports one
    // module now. The family and CLI dists still have to exist, because the
    // target's `migration` entry re-exports from them.
    const targetMongoDistMigration = pathToFileURL(targetMongoDistMigrationPath).href;

    it('runs via ./migration.ts on POSIX (or node migration.ts on Windows) and prints operations JSON', async (ctx) => {
      const distsExist = await Promise.all([
        stat(familyMongoDistMigrationPath).then(
          () => true,
          () => false,
        ),
        stat(targetMongoDistMigrationPath).then(
          () => true,
          () => false,
        ),
        stat(cliMigrationCliDistPath).then(
          () => true,
          () => false,
        ),
      ]);
      if (!distsExist.every(Boolean)) {
        ctx.skip(
          `dist migration entrypoints not built: ${familyMongoDistMigrationPath}, ${targetMongoDistMigrationPath}, ${cliMigrationCliDistPath} — run \`pnpm build\` for @internal/family-mongo, @internal/target-mongo, and @internal/cli`,
        );
      }

      const { renderCallsToTypeScript } = await import('../src/core/migrations/render-typescript');
      const { CreateCollectionCall, CreateIndexCall } = await import(
        '../src/core/migrations/op-factory-call'
      );
      const calls = [
        new CreateCollectionCall('users'),
        new CreateIndexCall('users', [{ field: 'email', direction: 1 as const }], { unique: true }),
      ];

      const directRunMeta = {
        from: '0'.repeat(64),
        to: '1'.repeat(64),
        snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
      } as const;
      const migrationSource = renderCallsToTypeScript(calls, directRunMeta).replace(
        "'@internal/target-mongo/migration'",
        `'${targetMongoDistMigration}'`,
      );
      await writeMigrationTs(tmpDir, migrationSource);
      await writeContractFixtures(directRunMeta);

      const migrationPath = join(tmpDir, 'migration.ts');
      const content = await readFile(migrationPath, 'utf-8');
      expect(content.split('\n')[0]).toBe('#!/usr/bin/env -S node');

      const isWindows = process.platform === 'win32';
      if (!isWindows) {
        const s = await stat(migrationPath);
        expect(s.mode & 0o100).toBe(0o100);
      }

      const spawn = isWindows
        ? spawnSync(process.execPath, [migrationPath, '--dry-run'], {
            cwd: tmpDir,
            encoding: 'utf-8',
          })
        : spawnSync(migrationPath, ['--dry-run'], {
            cwd: tmpDir,
            encoding: 'utf-8',
          });

      expect(spawn.status, `stderr: ${spawn.stderr}`).toBe(0);

      const ops = JSON.parse(extractDryRunOpsSection(spawn.stdout));
      expect(ops).toHaveLength(2);
      expect(ops[0].id).toBe('collection.users.create');
      expect(ops[1].id).toContain('index.users.create');
    });
  });

  describe('serialization format', () => {
    it('produces JSON that the runner can consume (correct kind discriminants)', async () => {
      const migration = [
        `import { MigrationCLI } from '${cliMigrationCliExport}';`,
        `import { Migration } from '${migrationExport}';`,
        `import { createIndex, dropIndex, createCollection, dropCollection, setValidation } from '${factoryExport}';`,
        '',
        'class M extends Migration {',
        "  describe() { return { from: '00', to: '01' }; }",
        '  get operations() {',
        '    return [',
        '      createCollection("users"),',
        '      createIndex("users", [{ field: "email", direction: 1 }]),',
        '      setValidation("users", { required: ["email"] }),',
        '      dropIndex("users", [{ field: "email", direction: 1 }]),',
        '      dropCollection("users"),',
        '    ];',
        '  }',
        '}',
        'export default M;',
        '',
        'MigrationCLI.run(import.meta.url, M);',
      ].join('\n');

      await writeFile(join(tmpDir, 'migration.ts'), migration);

      const result = await runFile('migration.ts');
      expect(result.exitCode).toBe(0);

      const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));
      expect(ops).toHaveLength(5);

      const commandKinds = ops.map((op: Record<string, unknown[]>) =>
        (op['execute'] as Record<string, unknown>[]).map(
          (s: Record<string, unknown>) => (s['command'] as Record<string, string>)['kind'],
        ),
      );
      expect(commandKinds).toEqual([
        ['createCollection'],
        ['createIndex'],
        ['collMod'],
        ['dropIndex'],
        ['dropCollection'],
      ]);

      for (const op of ops) {
        expect(op).toHaveProperty('id');
        expect(op).toHaveProperty('label');
        expect(op).toHaveProperty('operationClass');
        expect(op).toHaveProperty('precheck');
        expect(op).toHaveProperty('execute');
        expect(op).toHaveProperty('postcheck');
      }
    });
  });
});
