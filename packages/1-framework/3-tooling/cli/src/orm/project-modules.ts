import { existsSync, readFileSync } from 'node:fs';
import { createRequire, findPackageJSON } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'pathe';

/** What the project resolves a module specifier to, and what importing it gave. */
export type ProjectImport =
  | { readonly kind: 'not-installed' }
  | { readonly kind: 'not-exported' }
  | { readonly kind: 'unloadable'; readonly cause: unknown }
  | { readonly kind: 'loaded'; readonly module: Record<string, unknown> };

/** Imports a module as the project at `cwd` resolves it, not as the CLI's own location would. */
export type ImportFromProject = (cwd: string, specifier: string) => Promise<ProjectImport>;

/** The conditions Node's ESM loader resolves `import` with. */
const IMPORT_CONDITIONS: ReadonlySet<string> = new Set([
  'node',
  'import',
  'module-sync',
  'default',
]);

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

function resolveTarget(target: unknown, patternMatch: string | undefined): string | undefined {
  if (typeof target === 'string') {
    return patternMatch === undefined ? target : target.replaceAll('*', patternMatch);
  }
  if (Array.isArray(target)) {
    for (const candidate of target) {
      const resolved = resolveTarget(candidate, patternMatch);
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  }
  if (typeof target === 'object' && target !== null) {
    for (const [condition, value] of Object.entries(target)) {
      if (!IMPORT_CONDITIONS.has(condition)) continue;
      const resolved = resolveTarget(value, patternMatch);
      if (resolved !== undefined) return resolved;
    }
  }
  return undefined;
}

function isSubpathMap(exports: unknown): exports is Record<string, unknown> {
  return (
    typeof exports === 'object' &&
    exports !== null &&
    !Array.isArray(exports) &&
    Object.keys(exports).some((key) => key.startsWith('.'))
  );
}

/** The file a package's `exports` field maps `subpath` to under the import conditions. */
function resolveExports(exports: unknown, subpath: string): string | undefined {
  if (!isSubpathMap(exports)) {
    return subpath === '.' ? resolveTarget(exports, undefined) : undefined;
  }
  if (Object.hasOwn(exports, subpath)) {
    return resolveTarget(exports[subpath], undefined);
  }
  const patterns = Object.keys(exports)
    .filter((key) => key.includes('*'))
    .sort((a, b) => b.indexOf('*') - a.indexOf('*'));
  for (const pattern of patterns) {
    const [prefix = '', suffix = ''] = pattern.split('*');
    if (
      subpath.startsWith(prefix) &&
      subpath.endsWith(suffix) &&
      subpath.length >= pattern.length - 1
    ) {
      const match = subpath.slice(prefix.length, subpath.length - suffix.length);
      return resolveTarget(exports[pattern], match);
    }
  }
  return undefined;
}

type Resolution =
  | { readonly kind: 'not-installed' }
  | { readonly kind: 'not-exported' }
  | { readonly kind: 'resolved'; readonly path: string };

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
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const exports =
    typeof manifest === 'object' && manifest !== null
      ? Reflect.get(manifest, 'exports')
      : undefined;
  if (exports === undefined) {
    try {
      return { kind: 'resolved', path: createRequire(manifestPath).resolve(specifier) };
    } catch (error) {
      if (errorCode(error) === 'MODULE_NOT_FOUND') {
        return { kind: 'not-exported' };
      }
      throw error;
    }
  }
  const target = resolveExports(exports, subpath);
  return target === undefined
    ? { kind: 'not-exported' }
    : { kind: 'resolved', path: join(dirname(manifestPath), target) };
}

/**
 * Resolves with the import conditions, so a package that exports a module only under `import`
 * loads. A package the project does not have is `not-installed`; one that does not export the
 * subpath is `not-exported`; an export whose file is missing, or a module that throws while it
 * loads, is `unloadable` with the cause.
 */
export const importFromProject: ImportFromProject = async (cwd, specifier) => {
  const resolution = resolveFromProject(cwd, specifier);
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
