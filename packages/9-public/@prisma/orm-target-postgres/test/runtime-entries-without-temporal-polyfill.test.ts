import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const PUBLIC_PACKAGES_DIR = resolve(import.meta.dirname, '../../..');
const POLYFILL = 'temporal-polyfill';
const IMPORT_SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;

interface Entry {
  readonly packageName: string;
  readonly subpath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function entryFile({ packageName, subpath }: Entry): string {
  const packageDir = join(PUBLIC_PACKAGES_DIR, packageName);
  const manifest: unknown = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const exports = isRecord(manifest) ? manifest['exports'] : undefined;
  const target = isRecord(exports) ? exports[subpath] : undefined;
  if (typeof target !== 'string') {
    throw new Error(`${packageName} does not export ${subpath}`);
  }
  const file = join(packageDir, target);
  if (!existsSync(file)) {
    throw new Error(`${file} is not built`);
  }
  return file;
}

function publishedEntry(specifier: string): Entry | undefined {
  const match = /^(@prisma\/orm-[^/]+)(\/.*)?$/.exec(specifier);
  if (match === null) return undefined;
  const packageName = match[1] ?? '';
  if (!existsSync(join(PUBLIC_PACKAGES_DIR, packageName, 'package.json'))) return undefined;
  return { packageName, subpath: `.${match[2] ?? ''}` };
}

function importedSpecifiers(file: string): readonly string[] {
  return [...readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)].map((match) => match[1] ?? '');
}

/** Every file the entry loads, through relative imports and through other published packages. */
function filesLoadedBy(entry: Entry): { files: readonly string[]; importsPolyfill: boolean } {
  const seen = new Set<string>();
  const pending = [entryFile(entry)];
  let importsPolyfill = false;
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importedSpecifiers(file)) {
      if (specifier === POLYFILL || specifier.startsWith(`${POLYFILL}/`)) {
        importsPolyfill = true;
      } else if (specifier.startsWith('.')) {
        const imported = resolve(dirname(file), specifier);
        if (existsSync(imported)) pending.push(imported);
      } else {
        const published = publishedEntry(specifier);
        if (published !== undefined) pending.push(entryFile(published));
      }
    }
  }
  return { files: [...seen], importsPolyfill };
}

const RUNTIME_ENTRIES: readonly Entry[] = [
  { packageName: '@prisma/orm-target-postgres', subpath: './target/runtime' },
  { packageName: '@prisma/orm-target-postgres', subpath: './target/codecs' },
  { packageName: '@prisma/orm-target-postgres', subpath: './adapter/runtime' },
  { packageName: '@prisma/orm-target-postgres', subpath: './driver/runtime' },
  { packageName: '@prisma/orm-postgres', subpath: './runtime' },
  { packageName: '@prisma/orm-postgres', subpath: './serverless' },
  { packageName: '@prisma/orm-postgres', subpath: './contract-builder' },
];

const CONTROL_ENTRIES: readonly Entry[] = [
  { packageName: '@prisma/orm-target-postgres', subpath: './target/control' },
  { packageName: '@prisma/orm-postgres', subpath: './control' },
  { packageName: '@prisma/orm-postgres', subpath: './config' },
];

describe('which published Postgres entries load temporal-polyfill', () => {
  it.each(RUNTIME_ENTRIES)('$packageName $subpath does not', (entry) => {
    const loaded = filesLoadedBy(entry);

    expect(loaded.files.length).toBeGreaterThan(1);
    expect(loaded.importsPolyfill).toBe(false);
    for (const file of loaded.files) {
      expect(readFileSync(file, 'utf8'), file).not.toContain(POLYFILL);
    }
  });

  it.each(CONTROL_ENTRIES)('$packageName $subpath does', (entry) => {
    expect(filesLoadedBy(entry).importsPolyfill).toBe(true);
  });
});

const execFileAsync = promisify(execFile);

const REMOVE_TEMPORAL = `data:text/javascript,${encodeURIComponent('delete globalThis.Temporal;')}`;

function entryUrl(entry: Entry): string {
  return JSON.stringify(pathToFileURL(entryFile(entry)).href);
}

const DECODE_A_DEFAULT = `
  const { createPostgresBuiltinCodecLookup } = await import(${entryUrl({
    packageName: '@prisma/orm-target-postgres',
    subpath: './target/codecs',
  })});
  const before = typeof globalThis.Temporal;
  let decoded;
  try {
    decoded = String(
      createPostgresBuiltinCodecLookup()
        .get('pg/timestamptz-temporal@1')
        .decodeJson('2024-01-01T00:00:00Z'),
    );
  } catch (error) {
    decoded = error.code;
  }
  process.stdout.write(JSON.stringify({ before, decoded, after: typeof globalThis.Temporal }));
`;

async function runWithoutTemporal(script: string): Promise<unknown> {
  const { NODE_OPTIONS: _nodeOptions, ...env } = process.env;
  const { stdout } = await execFileAsync(
    'node',
    ['--import', REMOVE_TEMPORAL, '--input-type=module', '-e', script],
    { cwd: import.meta.dirname, env },
  );
  return JSON.parse(stdout);
}

describe('a process with no Temporal that loads the published entries', () => {
  it('decodes a date default once the target control entry is loaded, and gets no global', async () => {
    const control = entryUrl({
      packageName: '@prisma/orm-target-postgres',
      subpath: './target/control',
    });

    expect(await runWithoutTemporal(`await import(${control});${DECODE_A_DEFAULT}`)).toEqual({
      before: 'undefined',
      decoded: '2024-01-01T00:00:00Z',
      after: 'undefined',
    });
  });

  it('fails with RUNTIME.TEMPORAL_UNAVAILABLE when only runtime entries are loaded', async () => {
    const runtime = entryUrl({
      packageName: '@prisma/orm-target-postgres',
      subpath: './adapter/runtime',
    });

    expect(await runWithoutTemporal(`await import(${runtime});${DECODE_A_DEFAULT}`)).toEqual({
      before: 'undefined',
      decoded: 'RUNTIME.TEMPORAL_UNAVAILABLE',
      after: 'undefined',
    });
  });
});
