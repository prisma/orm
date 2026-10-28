import { runtimeError } from './runtime-error';

/** One copy of the framework: the package folder it was loaded from, and that package's version when it could be read. */
export interface FrameworkCopy {
  readonly folder: string;
  readonly version?: string;
}

interface FileReader {
  readFileSync(path: URL, encoding: 'utf-8'): string;
}

interface FileUrlConverter {
  fileURLToPath(url: URL): string;
}

/** The names the framework's own package goes by: published, and in this repository's workspace. */
const frameworkPackageNames: ReadonlySet<string> = new Set([
  '@prisma/orm-framework',
  '@internal/framework-components',
]);

const frameworkCopiesKey = Symbol.for('prisma.orm.frameworkCopies');

function recordedModuleUrls(): Set<string> {
  const existing: unknown = Reflect.get(globalThis, frameworkCopiesKey);
  if (existing instanceof Set) {
    return existing;
  }
  const created = new Set<string>();
  Object.defineProperty(globalThis, frameworkCopiesKey, { value: created });
  return created;
}

function parsedUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function withoutQueryOrHash(url: string): string {
  const location = parsedUrl(url);
  if (location === undefined) {
    return url;
  }
  location.search = '';
  location.hash = '';
  return location.href;
}

const thisModuleUrl: unknown = import.meta.url;

/**
 * Records that this copy of the framework has loaded. A copy is identified by the URL of this
 * module, which each copy has exactly one of however its other modules are split into files.
 * Modules whose values another copy would not recognise call it, so loading any of them records
 * the copy. A host that gives modules no URL records nothing.
 */
export function registerFrameworkCopy(): void {
  if (typeof thisModuleUrl !== 'string') {
    return;
  }
  recordedModuleUrls().add(withoutQueryOrHash(thisModuleUrl));
}

registerFrameworkCopy();

function nodeFs(): FileReader | undefined {
  return globalThis.process?.getBuiltinModule?.('node:fs');
}

function nodeUrl(): FileUrlConverter | undefined {
  return globalThis.process?.getBuiltinModule?.('node:url');
}

function displayedPath(location: URL): string {
  const path = location.protocol === 'file:' ? nodeUrl()?.fileURLToPath(location) : undefined;
  return (path ?? location.href).replace(/[/\\]$/, '');
}

function frameworkVersionAt(fs: FileReader, folder: URL): string | undefined {
  try {
    const manifest: unknown = JSON.parse(fs.readFileSync(new URL('package.json', folder), 'utf-8'));
    if (typeof manifest !== 'object' || manifest === null) return undefined;
    const name: unknown = Reflect.get(manifest, 'name');
    const version: unknown = Reflect.get(manifest, 'version');
    return typeof name === 'string' &&
      frameworkPackageNames.has(name) &&
      typeof version === 'string'
      ? version
      : undefined;
  } catch {
    return undefined;
  }
}

const describedCopies = new Map<string, FrameworkCopy>();

/** The framework package folder `moduleUrl` belongs to, read once per URL. */
function copyOf(moduleUrl: string): FrameworkCopy {
  const described = describedCopies.get(moduleUrl);
  if (described !== undefined) {
    return described;
  }
  const copy = describeCopy(moduleUrl);
  describedCopies.set(moduleUrl, copy);
  return copy;
}

/** The framework package folder `moduleUrl` belongs to; the module itself when no framework `package.json` encloses it. */
function describeCopy(moduleUrl: string): FrameworkCopy {
  const location = parsedUrl(moduleUrl);
  if (location === undefined) {
    return { folder: moduleUrl };
  }
  const fs = location.protocol === 'file:' ? nodeFs() : undefined;
  if (fs !== undefined) {
    for (let folder = new URL('.', location); ; folder = new URL('..', folder)) {
      const version = frameworkVersionAt(fs, folder);
      if (version !== undefined) {
        return { folder: displayedPath(folder), version };
      }
      if (new URL('..', folder).href === folder.href) {
        break;
      }
    }
  }
  return { folder: displayedPath(location) };
}

/** Every framework copy loaded so far, one per package folder. */
function loadedFrameworkCopies(): readonly FrameworkCopy[] {
  const urls = recordedModuleUrls();
  if (urls.size <= 1) {
    return [];
  }
  const byFolder = new Map<string, FrameworkCopy>();
  for (const url of urls) {
    const copy = copyOf(url);
    if (!byFolder.has(copy.folder)) {
      byFolder.set(copy.folder, copy);
    }
  }
  return [...byFolder.values()];
}

function versionLabel(copy: FrameworkCopy): string {
  return copy.version ?? 'unknown version';
}

function copyLine(copy: FrameworkCopy, versionWidth: number): string {
  return `  ${versionLabel(copy).padEnd(versionWidth)}  ${copy.folder}`;
}

const findCopies =
  '`npm ls @prisma/orm-framework`, `pnpm why @prisma/orm-framework` or `bun why @prisma/orm-framework` shows which package brought each copy.';

function fixFor(copies: readonly FrameworkCopy[]): string {
  const versions = new Set(copies.map((copy) => copy.version));
  const [onlyVersion] = versions;
  if (versions.size === 1 && onlyVersion !== undefined) {
    return `Every copy is ${onlyVersion}, so the package manager installed one version more than once. Reinstall so it keeps one copy, for example by deleting node_modules and the lockfile and installing again. With pnpm, copies of one version can also differ by their peer dependencies; \`pnpm why @prisma/orm-framework\` shows the difference, and giving every dependent the same peer leaves one copy. ${findCopies}`;
  }
  return `Install the same version of every @prisma/orm-* package, and a prisma CLI that runs that version. ${findCopies}`;
}

/** Throws `RUNTIME.MULTIPLE_ORM_COPIES` when the framework has been loaded from more than one package folder. */
export function assertOneFrameworkCopy(): void {
  const copies = loadedFrameworkCopies();
  if (copies.length <= 1) {
    return;
  }
  const versionWidth = Math.max(...copies.map((copy) => versionLabel(copy).length));
  throw Object.assign(
    runtimeError(
      'RUNTIME.MULTIPLE_ORM_COPIES',
      `Prisma ORM is loaded from ${copies.length} copies (${copies.map(versionLabel).join(', ')})`,
      { copies },
    ),
    {
      why: [
        'Values and registries made by one copy are not recognised by another, so every @prisma/orm-* package and the prisma CLI must use one copy.',
        ...copies.map((copy) => copyLine(copy, versionWidth)),
      ].join('\n'),
      fix: fixFor(copies),
      meta: { copies },
    },
  );
}
