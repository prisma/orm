/**
 * The import root of the project being emitted for, read from its own
 * manifest.
 *
 * Generated files are kept by the application, so every package name in them
 * has to be one the application can resolve — which means one of its direct
 * dependencies (ADR 242). The application already states those in
 * `package.json`, so emission reads them instead of taking a mode from
 * configuration that could disagree with what is installed.
 */

import { readFileSync } from 'node:fs';
import {
  createImportSpecifierResolver,
  type ImportRoot,
  ImportRootError,
  type ImportSpecifierResolver,
  importRootForDependencies,
  internalImportRoot,
} from '@internal/publish-surface/import-roots';
import { dirname, join, resolve } from 'pathe';
import { errorRuntime } from './cli-errors';

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The error codes that mean "no manifest here", as opposed to "cannot read it". */
const MANIFEST_ABSENT_CODES = new Set(['ENOENT', 'ENOTDIR']);

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const code = error['code'];
  return typeof code === 'string' ? code : undefined;
}

/**
 * The nearest `package.json` at or above `from`, or `undefined` if there is
 * none. The nearest one wins: a package inside a workspace states its own
 * dependencies, and the workspace root's are somebody else's.
 *
 * @throws {CliStructuredError} when a manifest is there but cannot be used —
 * unreadable, not valid JSON, or not a JSON object. Only "there is no manifest
 * at this level" continues the walk up; treating a permissions failure that
 * way would silently emit against the wrong project's dependencies.
 */
function nearestManifest(
  from: string,
): { readonly manifest: Record<string, unknown>; readonly path: string } | undefined {
  let dir = from;
  while (true) {
    const path = join(dir, 'package.json');
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (cause) {
      if (!MANIFEST_ABSENT_CODES.has(errorCode(cause) ?? '')) {
        throw errorRuntime('CLI.PROJECT_MANIFEST_UNREADABLE', `Failed to read ${path}`, {
          why: `\`${path}\` exists but could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
          fix: `Make \`${path}\` readable, then re-run the command. Emission reads it to decide which package names generated files should import.`,
          meta: { path },
          cause,
        });
      }
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw errorRuntime('CLI.PROJECT_MANIFEST_INVALID', `Failed to parse ${path}`, {
        why: `\`${path}\` is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        fix: `Fix the JSON syntax in \`${path}\` (a missing comma or unbalanced brace is the most common cause), then re-run the command. Emission reads it to decide which package names generated files should import.`,
        meta: { path },
        cause,
      });
    }
    if (!isRecord(parsed)) {
      throw errorRuntime('CLI.PROJECT_MANIFEST_INVALID', `Failed to read ${path}`, {
        why: `\`${path}\` is valid JSON but not a JSON object, so it states no dependencies.`,
        fix: `Make \`${path}\` a JSON object with the usual manifest fields, then re-run the command. Emission reads it to decide which package names generated files should import.`,
        meta: { path },
      });
    }
    return { manifest: parsed, path };
  }
}

function declaredDependencies(manifest: Record<string, unknown>): string[] {
  return DEPENDENCY_FIELDS.flatMap((field) => {
    const value = manifest[field];
    return isRecord(value) ? Object.keys(value) : [];
  });
}

/**
 * The import root for the project that owns `configPath`, or for the working
 * directory when the config was discovered rather than named.
 *
 * A project with no manifest, or one that names no published package, is on
 * the internal root — which emits every specifier exactly as authored, so a
 * project that has not moved to published names is unaffected.
 */
export function projectImportRoot(configPath?: string): ImportRoot {
  const start = configPath === undefined ? resolve('.') : dirname(resolve(configPath));
  const nearest = nearestManifest(start);
  if (nearest === undefined) return internalImportRoot;
  try {
    return importRootForDependencies(declaredDependencies(nearest.manifest));
  } catch (cause) {
    if (!(cause instanceof ImportRootError)) throw cause;
    throw errorRuntime('CLI.PROJECT_MANIFEST_INVALID', `Failed to read ${nearest.path}`, {
      why: `\`${nearest.path}\` states dependencies emission cannot import from: ${cause.message}.`,
      fix: `Keep one database facade in \`${nearest.path}\`, then re-run the command. Emission reads it to decide which package names generated files should import.`,
      meta: { path: nearest.path },
      cause,
    });
  }
}

/** The specifier resolver emission should use for the project owning `configPath`. */
export function createProjectSpecifierResolver(configPath?: string): ImportSpecifierResolver {
  return createImportSpecifierResolver(projectImportRoot(configPath));
}
