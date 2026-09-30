/**
 * Which published Postgres entries load `temporal-polyfill`, how the packages that ship them declare
 * it, and what a process with no `Temporal` gets from the date and time codecs.
 *
 * The target's control entry sets a fallback `Temporal` when it is loaded. The fallback is held
 * once per process, so every Postgres codec in that process uses it, the application's included.
 *
 * An entry is a control-plane entry when the last segment of its subpath is `control`, `config` or
 * `migration`, or when it is the aggregate of a namespace that has a `control` subpath, because an
 * aggregate re-exports every subpath of its namespace. Every other entry is one an application may
 * load at run time, and must not load `temporal-polyfill`.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');
const PUBLIC_PACKAGES_DIR = join(REPO_ROOT, 'packages/9-public');
const INTERNAL_TARGET_DIR = join(REPO_ROOT, 'packages/3-targets/3-targets/postgres');
const POLYFILL = 'temporal-polyfill';
const IMPORT_SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
const FALLBACK_STATE_DEFINITION = 'function setFallbackTemporal(';
const CONTROL_PLANE_SEGMENTS = new Set(['control', 'config', 'migration']);
const PUBLISHED_PACKAGES = ['@prisma/orm-target-postgres', '@prisma/orm-postgres'] as const;

interface Entry {
  readonly packageDir: string;
  readonly label: string;
  readonly subpath: string;
  readonly file: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function entriesOf(packageDir: string, label: string): readonly Entry[] {
  const manifest: unknown = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const exports = isRecord(manifest) ? manifest['exports'] : undefined;
  if (!isRecord(exports)) throw new Error(`${label} has no exports map`);
  return Object.entries(exports).flatMap(([subpath, target]) => {
    if (typeof target !== 'string' || !target.endsWith('.mjs')) return [];
    const file = join(packageDir, target);
    if (!existsSync(file)) throw new Error(`${file} is not built`);
    return [{ packageDir, label, subpath, file }];
  });
}

function publishedEntries(packageName: string): readonly Entry[] {
  return entriesOf(join(PUBLIC_PACKAGES_DIR, packageName), packageName);
}

function publishedEntry(packageName: string, subpath: string): Entry {
  const entry = publishedEntries(packageName).find((candidate) => candidate.subpath === subpath);
  if (entry === undefined) throw new Error(`${packageName} does not export ${subpath}`);
  return entry;
}

function isControlPlaneEntry(entry: Entry, all: readonly Entry[]): boolean {
  const lastSegment = entry.subpath.split('/').at(-1) ?? '';
  return (
    CONTROL_PLANE_SEGMENTS.has(lastSegment) ||
    all.some((other) => other.label === entry.label && other.subpath === `${entry.subpath}/control`)
  );
}

function importedFile(file: string, specifier: string): string | undefined {
  if (specifier.startsWith('.')) {
    const imported = resolve(dirname(file), specifier);
    return existsSync(imported) ? imported : undefined;
  }
  const match = /^(@prisma\/orm-[^/]+)(\/.*)?$/.exec(specifier);
  const packageName = match?.[1];
  if (packageName === undefined) return undefined;
  if (!existsSync(join(PUBLIC_PACKAGES_DIR, packageName, 'package.json'))) return undefined;
  return publishedEntry(packageName, `.${match?.[2] ?? ''}`).file;
}

/** Every file the entries load, through relative imports and through other published packages. */
function filesLoadedBy(entries: readonly Entry[]): {
  readonly files: readonly string[];
  readonly importsPolyfill: boolean;
} {
  const seen = new Set<string>();
  const pending = entries.map((entry) => entry.file);
  let importsPolyfill = false;
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1] ?? '';
      if (specifier === POLYFILL || specifier.startsWith(`${POLYFILL}/`)) {
        importsPolyfill = true;
        continue;
      }
      const imported = importedFile(file, specifier);
      if (imported !== undefined) pending.push(imported);
    }
  }
  return { files: [...seen], importsPolyfill };
}

const ALL_ENTRIES = PUBLISHED_PACKAGES.flatMap((packageName) => {
  const entries = publishedEntries(packageName);
  return entries.map((entry) => ({ entry, controlPlane: isControlPlaneEntry(entry, entries) }));
});

const APPLICATION_ENTRIES = ALL_ENTRIES.filter(({ controlPlane }) => !controlPlane).map(
  ({ entry }) => entry,
);

const ENTRIES_THAT_LOAD_THE_POLYFILL = ALL_ENTRIES.map(({ entry }) => entry).filter(
  (entry) => filesLoadedBy([entry]).importsPolyfill,
);

describe('which published Postgres entries load temporal-polyfill', () => {
  it('the exports maps yield application entries to check', () => {
    expect(APPLICATION_ENTRIES.length).toBeGreaterThan(100);
    expect(APPLICATION_ENTRIES.map((entry) => `${entry.label} ${entry.subpath}`)).toEqual(
      expect.arrayContaining([
        '@prisma/orm-target-postgres ./target/runtime',
        '@prisma/orm-target-postgres ./target/codecs',
        '@prisma/orm-target-postgres ./adapter/runtime',
        '@prisma/orm-target-postgres ./driver/runtime',
        '@prisma/orm-postgres ./runtime',
        '@prisma/orm-postgres ./serverless',
        '@prisma/orm-postgres ./contract-builder',
      ]),
    );
  });

  it.each(APPLICATION_ENTRIES)('$label $subpath, an application entry, does not', (entry) => {
    const loaded = filesLoadedBy([entry]);

    expect(loaded.importsPolyfill).toBe(false);
    for (const file of loaded.files) {
      expect(readFileSync(file, 'utf8'), file).not.toContain(POLYFILL);
    }
  });

  it('only control-plane entries do, and these are all of them', () => {
    expect(
      ENTRIES_THAT_LOAD_THE_POLYFILL.map((entry) => `${entry.label} ${entry.subpath}`),
    ).toEqual([
      '@prisma/orm-target-postgres ./target',
      '@prisma/orm-target-postgres ./target/control',
      '@prisma/orm-postgres ./config',
      '@prisma/orm-postgres ./control',
      '@prisma/orm-postgres ./target/control',
    ]);
  });
});

describe('how a published package that ships the control entry declares temporal-polyfill', () => {
  const PACKAGES_THAT_SHIP_THE_CONTROL_ENTRY = [
    ...new Set(ENTRIES_THAT_LOAD_THE_POLYFILL.map((entry) => entry.label)),
  ];

  function declarationOf(packageName: string, field: string): unknown {
    const manifest: unknown = JSON.parse(
      readFileSync(join(PUBLIC_PACKAGES_DIR, packageName, 'package.json'), 'utf8'),
    );
    const declarations = isRecord(manifest) ? manifest[field] : undefined;
    return isRecord(declarations) ? declarations[POLYFILL] : undefined;
  }

  it('the packages are the target package and the facade', () => {
    expect(PACKAGES_THAT_SHIP_THE_CONTROL_ENTRY).toEqual([
      '@prisma/orm-target-postgres',
      '@prisma/orm-postgres',
    ]);
  });

  it.each(PACKAGES_THAT_SHIP_THE_CONTROL_ENTRY)(
    '%s declares it as a required peer dependency, not a dependency',
    (packageName) => {
      expect({
        dependencies: declarationOf(packageName, 'dependencies'),
        peerDependencies: declarationOf(packageName, 'peerDependencies'),
        peerDependenciesMeta: declarationOf(packageName, 'peerDependenciesMeta'),
      }).toEqual({
        dependencies: undefined,
        peerDependencies: expect.any(String),
        peerDependenciesMeta: undefined,
      });
    },
  );
});

describe('the module that holds the fallback Temporal', () => {
  function filesThatDefineTheFallback(entries: readonly Entry[]): readonly string[] {
    return filesLoadedBy(entries).files.filter((file) =>
      readFileSync(file, 'utf8').includes(FALLBACK_STATE_DEFINITION),
    );
  }

  it('is built once across the entries of the target package', () => {
    const entries = entriesOf(INTERNAL_TARGET_DIR, '@internal/target-postgres');

    expect(entries.length).toBeGreaterThan(30);
    expect(filesThatDefineTheFallback(entries)).toHaveLength(1);
  });

  it('is built once across the entries of the published Postgres packages', () => {
    expect(filesThatDefineTheFallback(ALL_ENTRIES.map(({ entry }) => entry))).toHaveLength(1);
  });
});

const execFileAsync = promisify(execFile);

const REMOVE_TEMPORAL = `data:text/javascript,${encodeURIComponent('delete globalThis.Temporal;')}`;

function importOf(packageName: string, subpath: string): string {
  return `await import(${JSON.stringify(pathToFileURL(publishedEntry(packageName, subpath).file).href)});`;
}

const DECODE_A_TIMESTAMP = `
  const { createPostgresBuiltinCodecLookup } = ${importOf(
    '@prisma/orm-target-postgres',
    './target/codecs',
  ).replace(/;$/, '')};
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

describe('an application process that has no Temporal of its own', () => {
  it('decodes a timestamp once it has loaded the control entry, and still has no global Temporal', async () => {
    const loadApplication = `${importOf('@prisma/orm-postgres', './runtime')}${importOf(
      '@prisma/orm-postgres',
      './control',
    )}`;

    expect(await runWithoutTemporal(`${loadApplication}${DECODE_A_TIMESTAMP}`)).toEqual({
      before: 'undefined',
      decoded: '2024-01-01T00:00:00Z',
      after: 'undefined',
    });
  });

  it('gets RUNTIME.TEMPORAL_UNAVAILABLE from the same decode when it loads no control entry', async () => {
    const loadApplication = importOf('@prisma/orm-postgres', './runtime');

    expect(await runWithoutTemporal(`${loadApplication}${DECODE_A_TIMESTAMP}`)).toEqual({
      before: 'undefined',
      decoded: 'RUNTIME.TEMPORAL_UNAVAILABLE',
      after: 'undefined',
    });
  });
});
