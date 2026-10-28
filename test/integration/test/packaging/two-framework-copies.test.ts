import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicShells, type ShellName } from '@internal/publish-surface/shells';
import { installShells, type PackedShell, packShell } from '@repo/tsdown/shell-testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const facade = '@prisma/orm-postgres';
const toolchain = '@prisma/orm-toolchain';
const platform: ShellName[] = [
  '@prisma/orm-framework',
  '@prisma/orm-toolchain',
  '@prisma/orm-family-sql',
  '@prisma/orm-target-postgres',
];

const workspaceVersion = (
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }
).version;

const cliEngineVersion = (
  JSON.parse(
    readFileSync(join(repoRoot, 'packages/9-public/@prisma/orm-toolchain/package.json'), 'utf8'),
  ) as { peerDependencies: { '@prisma/cli-engine': string } }
).peerDependencies['@prisma/cli-engine'];

const SCHEMA = `// use prisma-8

model User {
  id     Int     @id
  active Boolean @default(false)
}
`;

const CONFIG = `import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig } from '${facade}/config';

export default definePrismaConfig({
  orm: defineConfig({ contract: './schema.prisma', output: 'generated' }),
});
`;

const CLI = `import { runOrmBin } from '${toolchain}/cli';

await runOrmBin();
`;

const SECOND_VERSION = '8.0.0-rc.0';

/** An extension that nests its own framework copy and imports only its codec entry, as an extension pack does. */
const EXTENSION = `import * as codecs from '@prisma/orm-framework/components/codec';

export const codecEntry = codecs;
`;

const EXTENSION_CONFIG = `import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig } from '${facade}/config';
import './extension/index.mjs';

export default definePrismaConfig({
  orm: defineConfig({ contract: './schema.prisma', output: 'generated' }),
});
`;

interface Copy {
  readonly folder: string;
  readonly version?: string;
}

interface EmitResult {
  readonly exitCode: number | null;
  readonly envelope: {
    readonly ok: boolean;
    readonly error?: {
      readonly code: string;
      readonly summary?: string;
      readonly why?: string;
      readonly meta?: { readonly copies?: readonly Copy[] };
    };
  };
}

function pack(scratch: string, names: readonly ShellName[]): PackedShell[] {
  return names.map((name) => {
    const shell = publicShells.get(name);
    if (shell === undefined) throw new Error(`unknown shell ${name}`);
    return packShell(join(repoRoot, shell.dir), scratch);
  });
}

function emit(scratch: string, config = 'prisma.config.ts'): EmitResult {
  const args = ['cli.mjs', 'contract', 'emit', '--config', config, '--json', '--no-color'];
  const run = spawnSync(process.execPath, args, { cwd: scratch, encoding: 'utf8' });
  const lines = run.stdout.trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1] ?? '{}') as { envelope: EmitResult['envelope'] };
  return { exitCode: run.status, envelope: last.envelope };
}

/** The `@prisma/orm-framework` folder that `fromPackage`, installed in the scratch project, imports. */
function frameworkSeenBy(scratch: string, fromPackage: string): string {
  const packageDir = realpathSync(join(scratch, 'node_modules', fromPackage));
  return realpathSync(join(dirname(packageDir), 'orm-framework'));
}

/**
 * A second `@prisma/orm-framework` folder at another version: the framework's
 * pnpm folder copied beside the original, with the copy's `package.json`
 * version rewritten. Returns the copy's package folder.
 */
function secondFrameworkCopy(scratch: string): string {
  const original = frameworkSeenBy(scratch, facade);
  const originalStoreDir = join(original, '..', '..', '..');
  const copyStoreDir = `${originalStoreDir}-second-copy`;
  cpSync(originalStoreDir, copyStoreDir, { recursive: true, verbatimSymlinks: true });
  const copy = join(copyStoreDir, relative(originalStoreDir, original));
  const manifestPath = join(copy, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: SECOND_VERSION }, null, 2));
  return copy;
}

/** Points `linkFolder/orm-framework` at `copy`. */
function linkFramework(linkFolder: string, copy: string): void {
  const link = join(linkFolder, 'orm-framework');
  rmSync(link, { force: true });
  mkdirSync(linkFolder, { recursive: true });
  symlinkSync(relative(linkFolder, copy), link);
}

/** Gives an extension in the project its own nested copy, the way npm nests one under the package that needs it. */
function installExtensionWithCopy(scratch: string, copy: string): void {
  const extension = join(scratch, 'extension');
  linkFramework(join(extension, 'node_modules', '@prisma'), copy);
  writeFileSync(join(extension, 'index.mjs'), EXTENSION);
  writeFileSync(join(scratch, 'prisma.config.extension.ts'), EXTENSION_CONFIG);
}

/** Gives the toolchain its own nested copy, so the CLI loads it and the database package loads the original. */
function nestCopyUnderToolchain(scratch: string, copy: string): void {
  linkFramework(dirname(realpathSync(join(scratch, 'node_modules', toolchain))), copy);
}

function expectRefusalNaming(result: EmitResult, copies: readonly Copy[]): void {
  expect(result.exitCode).not.toBe(0);
  expect(result.envelope.ok).toBe(false);
  expect(result.envelope.error?.code).toBe('RUNTIME.MULTIPLE_ORM_COPIES');
  expect(result.envelope.error?.meta?.copies).toEqual(expect.arrayContaining([...copies]));
  for (const copy of copies) {
    expect(result.envelope.error?.summary).toContain(copy.version);
    expect(result.envelope.error?.why).toContain(copy.folder);
  }
}

describe('a project whose prisma CLI and database package load different framework folders', () => {
  let scratch: string;
  let copy: string | undefined;
  const secondCopy = (): string => {
    copy ??= secondFrameworkCopy(scratch);
    return copy;
  };

  beforeAll(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'orm-two-framework-copies-')));
    installShells(scratch, pack(scratch, [facade, ...platform]), {
      direct: [facade, toolchain],
      registryDependencies: { '@prisma/cli-engine': cliEngineVersion },
    });
    writeFileSync(join(scratch, 'schema.prisma'), SCHEMA);
    writeFileSync(join(scratch, 'prisma.config.ts'), CONFIG);
    writeFileSync(join(scratch, 'cli.mjs'), CLI);
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('emits the contract while both load one copy', () => {
    expect(frameworkSeenBy(scratch, toolchain)).toBe(frameworkSeenBy(scratch, facade));
    const result = emit(scratch);
    expect(result.envelope.ok, JSON.stringify(result.envelope)).toBe(true);
    expect(result.exitCode).toBe(0);
    const contract = JSON.parse(readFileSync(join(scratch, 'generated', 'contract.json'), 'utf8'));
    expect(contract.storage.storageHash).toEqual(expect.any(String));
  });

  it('refuses to emit when an extension loads a second copy through its codec entry alone', () => {
    const first = { folder: frameworkSeenBy(scratch, facade), version: workspaceVersion };
    const second = { folder: secondCopy(), version: SECOND_VERSION };
    installExtensionWithCopy(scratch, second.folder);
    expect(frameworkSeenBy(scratch, toolchain)).toBe(first.folder);

    expectRefusalNaming(emit(scratch, 'prisma.config.extension.ts'), [first, second]);
  });

  it('refuses to emit once the CLI loads a second copy, naming both versions and folders', () => {
    const first = { folder: frameworkSeenBy(scratch, facade), version: workspaceVersion };
    const second = { folder: secondCopy(), version: SECOND_VERSION };
    nestCopyUnderToolchain(scratch, second.folder);
    expect(frameworkSeenBy(scratch, toolchain)).toBe(second.folder);

    expectRefusalNaming(emit(scratch), [first, second]);
  });
});
