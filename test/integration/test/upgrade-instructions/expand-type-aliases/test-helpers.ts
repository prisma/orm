import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'pathe';

const SCRIPT_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.19-to-8.0.0-rc.20/scripts/expand-type-aliases/expand-type-aliases.ts',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.19-to-8.0.0-rc.20/scripts/expand-type-aliases/expand-type-aliases.ts',
} as const;

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '../../../../..');
export const fixturesDir = join(here, 'fixtures');
export const appScript = join(repoRoot, SCRIPT_PATHS.app);
export const extensionScript = join(repoRoot, SCRIPT_PATHS.extension);
const workDirs: string[] = [];

export type Tree = Record<string, string>;

export function removeWorkDirs(): void {
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function makeWorkDir(prefix = 'expand-type-aliases-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  workDirs.push(dir);
  return dir;
}

export function readTree(root: string, dir = root): Tree {
  const files: Tree = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, readTree(root, path));
    else if (entry.isFile()) files[relative(root, path)] = readFileSync(path, 'utf8');
  }
  return files;
}

export function writeTree(root: string, tree: Tree): void {
  for (const [path, text] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

export function copyFixture(side: 'before' | 'after'): string {
  const root = makeWorkDir();
  cpSync(join(fixturesDir, side), root, { recursive: true });
  return root;
}

export interface Run {
  readonly root: string;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function runScript(root: string, script = appScript): Run {
  const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  return { root, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function fixtureTree(side: 'before' | 'after'): Tree {
  return readTree(join(fixturesDir, side));
}

const SNAPSHOT_IMPORT = /^import [^;]*?'\.\.\/\.\.\/snapshots\/[\s\S]*?;\n/gm;

/** A `migration.ts` with its imports in source order, as a formatter leaves them after the script renames the snapshots they name. */
function withSortedImports(text: string): string {
  const imports = text.match(SNAPSHOT_IMPORT) ?? [];
  const source = (statement: string) => /from '([^']*)'/.exec(statement)?.[1] ?? '';
  const sorted = [...imports].sort((a, b) => (source(a) < source(b) ? -1 : 1));
  let index = 0;
  return text.replace(SNAPSHOT_IMPORT, () => sorted[index++] ?? '');
}

export function formatted(tree: Tree): Tree {
  return Object.fromEntries(
    Object.entries(tree).map(([path, text]) => [
      path,
      path.endsWith('migration.ts') ? withSortedImports(text) : text,
    ]),
  );
}

export function withoutMigration(tree: Tree, dir: string): Tree {
  return Object.fromEntries(Object.entries(tree).filter(([path]) => !path.startsWith(`${dir}/`)));
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  if (!isRecord(value)) throw new Error('expected an object');
  return value;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

export function postColumns(contract: JsonRecord): JsonRecord {
  const storage = record(contract['storage']);
  const namespace = record(record(storage['namespaces'])['public']);
  return record(record(record(record(namespace['entries'])['table'])['post'])['columns']);
}

export function snapshotForm(contract: JsonRecord): string {
  return `${JSON.stringify(sortKeys(contract))}\n`;
}

function snapshotImports(role: 'Start' | 'End', hash: string): readonly string[] {
  const value = role === 'Start' ? 'startContract' : 'endContract';
  return [
    `import type { Contract as ${role} } from '../../snapshots/${hash}/contract';`,
    `import ${value} from '../../snapshots/${hash}/contract.json' with {`,
    "  type: 'json',",
    '};',
  ];
}

/** A `migration.ts` of the shape `prisma migration plan` writes, its snapshot imports sorted as the formatter sorts them. */
function migrationTs(from: string | null, to: string): string {
  const imports = [
    { hash: to, lines: snapshotImports('End', to) },
    ...(from === null ? [] : [{ hash: from, lines: snapshotImports('Start', from) }]),
  ].sort((a, b) => (a.hash < b.hash ? -1 : 1));
  const contracts =
    from === null
      ? ['  override readonly endContractJson = endContract;']
      : [
          '  override readonly startContractJson = startContract;',
          '  override readonly endContractJson = endContract;',
        ];
  return [
    '#!/usr/bin/env -S node',
    "import { Migration, MigrationCLI } from '@internal/postgres/migration';",
    ...imports.flatMap((entry) => entry.lines),
    '',
    `export default class M extends Migration<${from === null ? 'never' : 'Start'}, End> {`,
    ...contracts,
    '',
    '  override get operations() {',
    '    return [];',
    '  }',
    '}',
    '',
    'MigrationCLI.run(import.meta.url, M);',
    '',
  ].join('\n');
}

export interface MigrationOp {
  readonly id: string;
  readonly label: string;
  readonly operationClass: 'additive' | 'widening' | 'destructive' | 'data';
}

export interface MigrationPackage {
  readonly name: string;
  readonly from: string | null;
  readonly to: string;
  readonly createdAt: string;
  readonly migrationHash: string;
  readonly ops?: readonly MigrationOp[];
}

export function migrationPackage({
  name,
  from,
  to,
  createdAt,
  migrationHash,
  ops = [],
}: MigrationPackage): Tree {
  const metadata = { from, to, providedInvariants: [], createdAt, migrationHash };
  return {
    [`migrations/app/${name}/migration.json`]: `${JSON.stringify(metadata, null, 2)}\n`,
    [`migrations/app/${name}/ops.json`]:
      ops.length === 0 ? '[]\n' : `${JSON.stringify(ops, null, 2)}\n`,
    [`migrations/app/${name}/migration.ts`]: migrationTs(from, to),
  };
}

/** The storage hash of each app contract in the before fixture and of what the upgrade makes of it: the initial migration's target, then the latest. */
export const HASHES: ReadonlyArray<readonly [string, string]> = [
  [
    'eac9a16cf3aae00acba34eeb8f738ba0dab4bc5cf1ed4bc76822727c30fb937f',
    'f9fe553123fbfef2c6915c522258b03161a755a2ce41757ef560bc17cf4196fe',
  ],
  [
    'b125bc8a23cb005d4a843e746b19417156e64c9104e9199ce1a059dac6f70fbb',
    'b780ffea90053c47ccc4c522fb690a6f7742e5be20c396b2801e4e9604110369',
  ],
];

export function initialHashes(): readonly [string, string] {
  const [oldHash, newHash] = HASHES[0] ?? [];
  return [oldHash ?? '', newHash ?? ''];
}
