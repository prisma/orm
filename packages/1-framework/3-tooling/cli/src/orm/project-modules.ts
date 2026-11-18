import { existsSync, readFileSync } from 'node:fs';
import { createRequire, findPackageJSON } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'pathe';
import { exports as resolveExportsField } from 'resolve.exports';

/** What the project resolves a module specifier to, and what importing it gave. */
export type ProjectImport =
  | { readonly kind: 'not-installed' }
  | { readonly kind: 'not-exported' }
  | { readonly kind: 'unloadable'; readonly cause: unknown }
  | { readonly kind: 'loaded'; readonly module: Record<string, unknown> };

/** Imports a module as the project at `cwd` resolves it, not as the CLI's own location would. */
export type ImportFromProject = (cwd: string, specifier: string) => Promise<ProjectImport>;

/**
 * The conditions Node's ESM loader applies by default beyond those `resolve.exports` adds for
 * `import` (`import`, `node` and `default`).
 */
const IMPORT_CONDITIONS = ['module-sync', 'node-addons'];

function errorCode(error: unknown): unknown {
  return error instanceof Error ? Reflect.get(error, 'code') : undefined;
}

function splitSpecifier(specifier: string): { readonly name: string; readonly subpath: string } {
  const parts = specifier.split('/');
  const nameLength = specifier.startsWith('@') ? 2 : 1;
  const rest = parts.slice(nameLength);
  return {
    name: parts.slice(0, nameLength).join('/'),
    subpath: rest.length === 0 ? '.' : `./${rest.join('/')}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The file a package's `exports` field maps `subpath` to under the import conditions. */
function resolveExports(manifest: Record<string, unknown>, subpath: string): string | undefined {
  try {
    const [target] =
      resolveExportsField(manifest, subpath, { conditions: IMPORT_CONDITIONS }) ?? [];
    return target;
  } catch {
    return undefined;
  }
}

type Resolution =
  | { readonly kind: 'not-installed' }
  | { readonly kind: 'not-exported' }
  | { readonly kind: 'resolved'; readonly path: string }
  | { readonly kind: 'unreadable'; readonly cause: unknown };

function resolveFromProject(cwd: string, specifier: string): Resolution {
  const { name, subpath } = splitSpecifier(specifier);
  let manifestPath: string | undefined;
  try {
    manifestPath = findPackageJSON(name, pathToFileURL(join(cwd, 'package.json')));
  } catch (error) {
    if (errorCode(error) === 'ERR_MODULE_NOT_FOUND') {
      return { kind: 'not-installed' };
    }
    throw error;
  }
  if (manifestPath === undefined) {
    return { kind: 'not-installed' };
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (cause) {
    return {
      kind: 'unreadable',
      cause: new Error(`${manifestPath} cannot be read as JSON`, { cause }),
    };
  }
  if (!isRecord(manifest) || manifest['exports'] === undefined) {
    try {
      return { kind: 'resolved', path: createRequire(manifestPath).resolve(specifier) };
    } catch (error) {
      if (errorCode(error) === 'MODULE_NOT_FOUND') {
        return { kind: 'not-exported' };
      }
      throw error;
    }
  }
  const target = resolveExports(manifest, subpath);
  return target === undefined
    ? { kind: 'not-exported' }
    : { kind: 'resolved', path: fileURLToPath(new URL(target, pathToFileURL(manifestPath))) };
}

/** Whether the project at `cwd` has the package `name` where Node would find it. */
export function isInstalledInProject(cwd: string, name: string): boolean {
  try {
    return findPackageJSON(name, pathToFileURL(join(cwd, 'package.json'))) !== undefined;
  } catch (error) {
    if (errorCode(error) === 'ERR_MODULE_NOT_FOUND') {
      return false;
    }
    throw error;
  }
}

/**
 * Resolves with the import conditions, so a package that exports a module only under `import`
 * loads. A package the project does not have is `not-installed`; one that does not export the
 * subpath is `not-exported`; an export whose file is missing, or a module that throws while it
 * loads, is `unloadable` with the cause.
 */
export const importFromProject: ImportFromProject = async (cwd, specifier) => {
  const resolution = resolveFromProject(cwd, specifier);
  if (resolution.kind === 'unreadable') {
    return { kind: 'unloadable', cause: resolution.cause };
  }
  if (resolution.kind !== 'resolved') {
    return resolution;
  }
  if (!existsSync(resolution.path)) {
    return {
      kind: 'unloadable',
      cause: new Error(`${specifier} resolves to ${resolution.path}, which does not exist`),
    };
  }
  try {
    const module: Record<string, unknown> = await import(pathToFileURL(resolution.path).href);
    return { kind: 'loaded', module };
  } catch (cause) {
    return { kind: 'unloadable', cause };
  }
};
