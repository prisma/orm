import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type } from 'arktype';
import { dirname, join } from 'pathe';
import { resolverChildCommand } from './resolver-child-command';

/** What the project resolves a module specifier to, and what importing it gave. */
export type ProjectImport =
  | { readonly kind: 'not-installed' }
  | { readonly kind: 'not-exported' }
  | { readonly kind: 'unloadable'; readonly cause: unknown }
  | { readonly kind: 'loaded'; readonly module: Record<string, unknown> };

/** Imports a module as the project at `cwd` resolves it, not as the CLI's own location would. */
export type ImportFromProject = (cwd: string, specifier: string) => Promise<ProjectImport>;

const ANSWER_START = '\u0000prisma-resolution-start\u0000';
const ANSWER_END = '\u0000prisma-resolution-end\u0000';

/**
 * Asks a child, started in the project folder, to resolve the specifier with
 * `import.meta.resolve`, so the project's own resolution, conditions and all, decides. The answer
 * sits between fixed markers, so output from a `NODE_OPTIONS` preload cannot be mistaken for it.
 */
const RESOLVE_IN_PROJECT = `
const answer = (value) => process.stdout.write(${JSON.stringify(ANSWER_START)} + JSON.stringify(value) + ${JSON.stringify(ANSWER_END)});
try {
  answer({ url: import.meta.resolve(process.argv.at(-1)) });
} catch (error) {
  answer({ code: error?.code, message: String(error?.message ?? error) });
}`;

const nodeResolution = type({ url: 'string' }).or({
  'code?': 'string',
  message: 'string',
});

type NodeResolution = typeof nodeResolution.infer | { readonly failed: Error };

function answerIn(stdout: string): string | undefined {
  const start = stdout.lastIndexOf(ANSWER_START);
  const end = stdout.lastIndexOf(ANSWER_END);
  return start === -1 || end < start ? undefined : stdout.slice(start + ANSWER_START.length, end);
}

/**
 * The child runs on the runtime running the CLI. Node, Bun and Deno each load an exported module
 * and report a missing package the same way, but report a subpath the package does not export
 * differently: Node sets `ERR_PACKAGE_PATH_NOT_EXPORTED`, Bun sets `ERR_MODULE_NOT_FOUND` and Deno
 * sets no code. Under Bun and Deno that case is therefore `unloadable`, not `not-exported`.
 */
function resolveWithNode(cwd: string, specifier: string): NodeResolution {
  const { command: runtime, args } = resolverChildCommand(
    process.versions,
    process.execPath,
    RESOLVE_IN_PROJECT,
    specifier,
  );
  const child = spawnSync(runtime, args, { cwd, encoding: 'utf-8' });
  const command = `${process.execPath} resolving ${specifier} in ${cwd}`;
  if (child.error !== undefined) {
    return { failed: new Error(`${command} could not start`, { cause: child.error }) };
  }
  if (child.status !== 0) {
    return {
      failed: new Error(`${command} exited with ${child.status ?? child.signal}: ${child.stderr}`),
    };
  }
  const answer = answerIn(child.stdout);
  let parsed: unknown;
  try {
    parsed = answer === undefined ? undefined : JSON.parse(answer);
  } catch {
    parsed = undefined;
  }
  const resolution = nodeResolution(parsed);
  if (resolution instanceof type.errors) {
    return { failed: new Error(`${command} gave no answer it could read: ${child.stdout}`) };
  }
  return resolution;
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

/**
 * The `package.json` of `name` in the nearest `node_modules` from `cwd` upwards, where Node looks
 * for a bare specifier. `module.findPackageJSON` does this too, but Bun and Deno do not have it.
 */
export function installedManifest(cwd: string, name: string): string | undefined {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) {
      return candidate;
    }
    if (dirname(dir) === dir) {
      return undefined;
    }
  }
}

type Resolution =
  | { readonly kind: 'not-installed' }
  | { readonly kind: 'not-exported' }
  | { readonly kind: 'resolved'; readonly path: string }
  | { readonly kind: 'unreadable'; readonly cause: unknown };

function resolveFromProject(cwd: string, specifier: string): Resolution {
  const name = packageOf(specifier);
  const manifestPath = installedManifest(cwd, name);
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
  if ('failed' in resolved) {
    return { kind: 'unreadable', cause: resolved.failed };
  }
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
  return installedManifest(cwd, name) !== undefined;
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
