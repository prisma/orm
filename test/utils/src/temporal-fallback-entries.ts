import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

/** The published packages of one target, and what to check of them. */
export interface TemporalFallbackTarget {
  /** The target's name in test titles, such as `SQLite`. */
  readonly name: string;
  readonly repoRoot: string;
  /** The target package first, then the facade an application installs. */
  readonly publishedPackages: readonly [targetPackage: string, facadePackage: string];
  readonly internalTarget: {
    readonly name: string;
    readonly dir: string;
    readonly minimumEntries: number;
  };
  /** Application entries the exports maps must yield, as `<package> <subpath>`. */
  readonly expectedApplicationEntries: readonly string[];
  /** Every entry that loads `temporal-polyfill`, as `<package> <subpath>`. */
  readonly entriesThatLoadThePolyfill: readonly string[];
  /** A Temporal codec to decode, from the target package's `./target/codecs` entry. */
  readonly decode: {
    readonly lookupFactory: string;
    readonly codecId: string;
    readonly contractValue: string;
    readonly decoded: string;
  };
  /** Sets of facade entries an application may load with no control entry, each with a name. */
  readonly applicationLoadsWithoutControl: ReadonlyArray<
    readonly [name: string, subpaths: readonly string[]]
  >;
}

interface Entry {
  readonly label: string;
  readonly subpath: string;
  readonly file: string;
}

const POLYFILL = 'temporal-polyfill';
const IMPORT_SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
const FALLBACK_STATE_DEFINITION = 'function setFallbackTemporal(';
const CONTROL_PLANE_SEGMENTS = new Set(['control', 'config', 'migration']);
const TYPE_IMPLEMENTATIONS = '@internal/type-implementations';
const REMOVE_TEMPORAL = `data:text/javascript,${encodeURIComponent('delete globalThis.Temporal;')}`;
const execFileAsync = promisify(execFile);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function manifestOf(packageDir: string): unknown {
  return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
}

function entriesOf(packageDir: string, label: string): readonly Entry[] {
  const manifest = manifestOf(packageDir);
  const exports = isRecord(manifest) ? manifest['exports'] : undefined;
  if (!isRecord(exports)) throw new Error(`${label} has no exports map`);
  return Object.entries(exports).flatMap(([subpath, target]) => {
    if (typeof target !== 'string' || !target.endsWith('.mjs')) return [];
    const file = join(packageDir, target);
    if (!existsSync(file)) throw new Error(`${file} is not built`);
    return [{ label, subpath, file }];
  });
}

function isControlPlaneEntry(entry: Entry, all: readonly Entry[]): boolean {
  const lastSegment = entry.subpath.split('/').at(-1) ?? '';
  return (
    CONTROL_PLANE_SEGMENTS.has(lastSegment) ||
    all.some((other) => other.label === entry.label && other.subpath === `${entry.subpath}/control`)
  );
}

function nameOf(entry: Entry): string {
  return `${entry.label} ${entry.subpath}`;
}

/**
 * Checks which published entries of one target load `temporal-polyfill`, how the packages that ship them declare it, and what a process with no `Temporal` gets from a Temporal codec.
 *
 * The target's control entry sets a fallback `Temporal` when it is loaded. The fallback is held once per process, in `@prisma/orm-framework`, so every codec of every target in that process uses it, the application's included.
 *
 * An entry is a control-plane entry when the last segment of its subpath is `control`, `config` or `migration`, or when it is the aggregate of a namespace that has a `control` subpath, because an aggregate re-exports every subpath of its namespace. Every other entry is one an application may load at run time, and must not load `temporal-polyfill`.
 */
export function describeTemporalFallbackEntries(target: TemporalFallbackTarget): void {
  const publicPackagesDir = join(target.repoRoot, 'packages/9-public');
  const frameworkDistDir = join(publicPackagesDir, '@prisma/orm-framework/dist');
  const [targetPackage, facadePackage] = target.publishedPackages;

  function publishedEntries(packageName: string): readonly Entry[] {
    return entriesOf(join(publicPackagesDir, packageName), packageName);
  }

  function publishedEntry(packageName: string, subpath: string): Entry {
    const entry = publishedEntries(packageName).find((candidate) => candidate.subpath === subpath);
    if (entry === undefined) throw new Error(`${packageName} does not export ${subpath}`);
    return entry;
  }

  function importedFile(file: string, specifier: string): string | undefined {
    if (specifier.startsWith('.')) {
      const imported = resolve(dirname(file), specifier);
      return existsSync(imported) ? imported : undefined;
    }
    const match = /^(@prisma\/orm-[^/]+)(\/.*)?$/.exec(specifier);
    const packageName = match?.[1];
    if (packageName === undefined) return undefined;
    if (!existsSync(join(publicPackagesDir, packageName, 'package.json'))) return undefined;
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

  const allEntries = target.publishedPackages.flatMap((packageName) => {
    const entries = publishedEntries(packageName);
    return entries.map((entry) => ({ entry, controlPlane: isControlPlaneEntry(entry, entries) }));
  });
  const applicationEntries = allEntries
    .filter(({ controlPlane }) => !controlPlane)
    .map(({ entry }) => entry);
  const entriesThatLoadThePolyfill = allEntries
    .map(({ entry }) => entry)
    .filter((entry) => filesLoadedBy([entry]).importsPolyfill);

  describe(`which published ${target.name} entries load temporal-polyfill`, () => {
    it('the exports maps yield application entries to check', () => {
      expect(applicationEntries.length).toBeGreaterThan(100);
      expect(applicationEntries.map(nameOf)).toEqual(
        expect.arrayContaining([...target.expectedApplicationEntries]),
      );
    });

    it.each(applicationEntries)('$label $subpath, an application entry, does not', (entry) => {
      const loaded = filesLoadedBy([entry]);

      expect(loaded.importsPolyfill).toBe(false);
      for (const file of loaded.files) {
        expect(readFileSync(file, 'utf8'), file).not.toContain(POLYFILL);
      }
    });

    it('only control-plane entries do, and these are all of them', () => {
      expect(entriesThatLoadThePolyfill.map(nameOf)).toEqual(target.entriesThatLoadThePolyfill);
    });
  });

  describe('how a published package that ships the control entry declares temporal-polyfill', () => {
    function declarationOf(packageName: string, field: string): unknown {
      const manifest = manifestOf(join(publicPackagesDir, packageName));
      const declarations = isRecord(manifest) ? manifest[field] : undefined;
      return isRecord(declarations) ? declarations[POLYFILL] : undefined;
    }

    it.each([...new Set(entriesThatLoadThePolyfill.map((entry) => entry.label))])(
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

    it(`is built once, in ${TYPE_IMPLEMENTATIONS}, and in no entry of the target package`, () => {
      const entries = entriesOf(target.internalTarget.dir, target.internalTarget.name);

      expect(entries.length).toBeGreaterThan(target.internalTarget.minimumEntries);
      expect({
        target: filesThatDefineTheFallback(entries),
        typeImplementations: filesThatDefineTheFallback(
          entriesOf(
            join(target.repoRoot, 'packages/3-targets/0-shared/type-implementations'),
            TYPE_IMPLEMENTATIONS,
          ),
        ),
      }).toEqual({ target: [], typeImplementations: [expect.any(String)] });
    });

    it(`is built once across the entries of the published ${target.name} packages, in @prisma/orm-framework, which every target's packages load`, () => {
      const files = filesThatDefineTheFallback(allEntries.map(({ entry }) => entry));

      expect(files).toEqual([expect.stringContaining(frameworkDistDir)]);
    });
  });

  function importOf(packageName: string, subpath: string): string {
    return `await import(${JSON.stringify(pathToFileURL(publishedEntry(packageName, subpath).file).href)})`;
  }

  function loadFacade(subpaths: readonly string[]): string {
    return subpaths.map((subpath) => `${importOf(facadePackage, subpath)};`).join('');
  }

  const { decode } = target;
  const decodeATimestamp = `
    const { ${decode.lookupFactory} } = ${importOf(targetPackage, './target/codecs')};
    const before = typeof globalThis.Temporal;
    let decoded;
    try {
      const codec = ${decode.lookupFactory}().get(${JSON.stringify(decode.codecId)});
      decoded = String(
        codec.fromDataTypeValue(codec.dataType.fromContract(${JSON.stringify(decode.contractValue)}, {})),
      );
    } catch (error) {
      decoded = error.code;
    }
    process.stdout.write(JSON.stringify({ before, decoded, after: typeof globalThis.Temporal }));
  `;

  async function runWithoutTemporal(loadApplication: string): Promise<unknown> {
    const { NODE_OPTIONS: _nodeOptions, ...env } = process.env;
    const { stdout } = await execFileAsync(
      'node',
      [
        '--import',
        REMOVE_TEMPORAL,
        '--input-type=module',
        '-e',
        loadApplication + decodeATimestamp,
      ],
      { cwd: join(publicPackagesDir, targetPackage), env },
    );
    return JSON.parse(stdout);
  }

  describe('an application process that has no Temporal of its own', () => {
    it('decodes a timestamp once it has loaded the control entry, and still has no global Temporal', async () => {
      expect(await runWithoutTemporal(loadFacade(['./runtime', './control']))).toEqual({
        before: 'undefined',
        decoded: decode.decoded,
        after: 'undefined',
      });
    });

    it.each(target.applicationLoadsWithoutControl)(
      'gets RUNTIME.TEMPORAL_UNAVAILABLE from the same decode when it loads %s, and no control entry',
      async (_name, subpaths) => {
        expect(await runWithoutTemporal(loadFacade(subpaths))).toEqual({
          before: 'undefined',
          decoded: 'RUNTIME.TEMPORAL_UNAVAILABLE',
          after: 'undefined',
        });
      },
    );
  });
}
