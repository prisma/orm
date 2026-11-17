import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'pathe';

export interface ContractDepsValidation {
  readonly missing: readonly string[];
  readonly warning?: string;
}

function readManifest(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
}

function nearestManifest(fromDir: string): string | undefined {
  let dir = fromDir;
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return join(dir, 'package.json');
}

function installedManifest(name: string, fromDir: string): string | undefined {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function mapsSubpath(map: unknown, subpath: string): boolean {
  if (typeof map !== 'object' || map === null) return subpath === '.';
  return Object.keys(map).some((key) => {
    const star = key.indexOf('*');
    if (star < 0) return key === subpath;
    return (
      subpath.startsWith(key.slice(0, star)) &&
      subpath.endsWith(key.slice(star + 1)) &&
      subpath.length >= key.length - 1
    );
  });
}

function packageAndSubpath(module: string): { readonly name: string; readonly subpath: string } {
  const segments = module.split('/');
  const nameLength = module.startsWith('@') ? 2 : 1;
  const rest = segments.slice(nameLength).join('/');
  return {
    name: segments.slice(0, nameLength).join('/'),
    subpath: rest === '' ? '.' : `./${rest}`,
  };
}

function resolves(module: string, fromDir: string): boolean {
  if (module.startsWith('./') || module.startsWith('../')) return true;
  if (module.startsWith('#')) {
    const manifest = nearestManifest(fromDir);
    return manifest !== undefined && mapsSubpath(readManifest(manifest)['imports'], module);
  }
  const { name, subpath } = packageAndSubpath(module);
  const manifestPath = installedManifest(name, fromDir);
  if (manifestPath === undefined) return false;
  const { exports } = readManifest(manifestPath);
  return exports === undefined || mapsSubpath(exports, subpath);
}

export function validateContractDeps(
  modules: readonly string[],
  outputDir: string,
): ContractDepsValidation {
  const fromDir = resolvePath(outputDir);
  const missing = [...new Set(modules)].filter((module) => !resolves(module, fromDir));
  if (missing.length === 0) {
    return { missing };
  }
  const warning = [
    'contract.d.ts imports modules that do not resolve from where it is written:',
    ...missing.map((module) => `  - ${module}`),
    '',
    'Install the package each one belongs to, or correct the module the config or the component names.',
  ].join('\n');
  return { missing, warning };
}
