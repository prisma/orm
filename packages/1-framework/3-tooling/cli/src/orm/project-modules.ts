import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, findPackageJSON } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'pathe';

/** What the project resolves a module specifier to, and what importing it gave. */
export type ProjectImport =
  | { readonly kind: 'not-installed' }
  | { readonly kind: 'not-exported' }
  | { readonly kind: 'unloadable'; readonly cause: unknown }
  | { readonly kind: 'loaded'; readonly module: Record<string, unknown> };

/** Imports a module as the project at `cwd` resolves it, not as the CLI's own location would. */
export type ImportFromProject = (cwd: string, specifier: string) => Promise<ProjectImport>;

/**
 * Asks a child Node, started in the project folder, to resolve the specifier with
 * `import.meta.resolve`, so the project's own resolution, conditions and all, decides.
 */
const RESOLVE_IN_PROJECT = `
try {
  process.stdout.write(JSON.stringify({ url: import.meta.resolve(process.argv[1]) }));
} catch (error) {
  process.stdout.write(JSON.stringify({ code: error?.code, message: String(error?.message ?? error) }));
}`;

type NodeResolution =
  | { readonly url: string }
  | { readonly code: string | undefined; readonly message: string };

function resolveWithNode(cwd: string, specifier: string): NodeResolution {
  const output = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', RESOLVE_IN_PROJECT, specifier],
    { cwd, encoding: 'utf-8' },
  );
  return JSON.parse(output);
}

function errorCode(error: unknown): unknown {
  return error instanceof Error ? Reflect.get(error, 'code') : undefined;
}

/** The package a bare specifier names: `@scope/name` or `name`. */
function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return parts.slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Resolution =
  | { readonly kind: 'not-installed' }
  | { readonly kind: 'not-exported' }
  | { readonly kind: 'resolved'; readonly path: string }
  | { readonly kind: 'unreadable'; readonly cause: unknown };

function resolveFromProject(cwd: string, specifier: string): Resolution {
  const name = packageOf(specifier);
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
  const resolved = resolveWithNode(cwd, specifier);
  if ('url' in resolved) {
    return { kind: 'resolved', path: fileURLToPath(resolved.url) };
  }
  if (resolved.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
    return { kind: 'not-exported' };
  }
  return {
    kind: 'unreadable',
    cause: Object.assign(new Error(resolved.message), { code: resolved.code }),
  };
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
