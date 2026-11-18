import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { PackageManagerRunRequest } from '@prisma/cli-engine';
import { join } from 'pathe';

/** The range a fake `add` declares, the way a package manager writes the version it resolved. */
export const FAKE_ADDED_RANGE = '^9.9.9-test';

function packageName(specifier: string): string {
  const at = specifier.indexOf('@', 1);
  return at === -1 ? specifier : specifier.slice(0, at);
}

/**
 * What a successful `<manager> add` does to the project's manifest: it declares each package it
 * was given, rewriting the range of one already declared. Nothing is put on disk.
 */
export function declareAddedPackages(
  request: Pick<PackageManagerRunRequest, 'args' | 'cwd'>,
): void {
  const [verb, ...rest] = request.args;
  if (verb !== 'add') return;
  const dev = rest.includes('-D');
  const names = rest.filter((arg) => !arg.startsWith('-')).map(packageName);
  const manifestPath = join(request.cwd, 'package.json');
  const manifest: Record<string, unknown> = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf-8'))
    : {};
  const field = dev ? 'devDependencies' : 'dependencies';
  const section = { ...(manifest[field] as Record<string, string> | undefined) };
  for (const name of names) {
    section[name] = FAKE_ADDED_RANGE;
  }
  manifest[field] = section;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}

/** A manifest's text with the declarations a fake `add` wrote taken out again. */
export function withoutFakeAdditions(manifestText: string): unknown {
  const manifest: Record<string, unknown> = JSON.parse(manifestText);
  for (const field of ['dependencies', 'devDependencies']) {
    const section = manifest[field] as Record<string, string> | undefined;
    if (section === undefined) continue;
    const kept = Object.fromEntries(
      Object.entries(section).filter(([, range]) => range !== FAKE_ADDED_RANGE),
    );
    if (Object.keys(kept).length === 0) {
      delete manifest[field];
    } else {
      manifest[field] = kept;
    }
  }
  return manifest;
}
