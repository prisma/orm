import { existsSync } from 'node:fs';
import { detect, getUserAgent } from 'package-manager-detector/detect';
import { join } from 'pathe';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun' | 'deno';

const KNOWN: ReadonlySet<string> = new Set<PackageManager>(['pnpm', 'npm', 'yarn', 'bun', 'deno']);

function isPackageManager(name: string): name is PackageManager {
  return KNOWN.has(name);
}

/**
 * Resolves the package manager `init` should drive for `add` / `install`
 * commands. Tries, in order:
 *
 *  1. **`detect()`** — walks up from `cwd` looking for a lockfile, the
 *     `packageManager` field, the `devEngines.packageManager` field, or
 *     install metadata. This is the right answer whenever the user is
 *     anywhere inside an existing project, including a deep workspace
 *     subdirectory.
 *
 *  2. **`getUserAgent()`** — parses `npm_config_user_agent`, the env var
 *     every PM sets when it spawns a script. This catches the
 *     bare-directory case where there's no project to walk up to but the
 *     user invoked us via `pnpm dlx prisma@next orm init` / `bunx
 *     prisma@next orm init` / `yarn dlx …`. Same signal used by every
 *     `create-*` tool in the ecosystem (`create-vite`, `create-next-app`,
 *     `create-astro`, `@antfu/ni`, …).
 *
 *  3. **`npm`** — final fallback. Always present alongside Node.
 */
export async function detectPackageManager(cwd: string): Promise<PackageManager> {
  const detected = await detect({ cwd });
  if (detected && isPackageManager(detected.name)) {
    return detected.name;
  }
  const userAgent = getUserAgent();
  if (userAgent !== null && isPackageManager(userAgent)) {
    return userAgent;
  }
  return 'npm';
}

export function hasProjectManifest(cwd: string): boolean {
  return (
    existsSync(join(cwd, 'package.json')) ||
    existsSync(join(cwd, 'deno.json')) ||
    existsSync(join(cwd, 'deno.jsonc'))
  );
}

export function formatRunCommand(pm: PackageManager, bin: string, args: string): string {
  if (pm === 'npm') {
    return `npx ${bin} ${args}`;
  }
  if (pm === 'deno') {
    return `deno run npm:${bin} ${args}`;
  }
  return `${pm} ${bin} ${args}`;
}

export function formatRunScriptCommand(pm: PackageManager, scriptName: string): string {
  switch (pm) {
    case 'deno':
      return `deno task ${scriptName}`;
    case 'bun':
      return `bun run ${scriptName}`;
    case 'pnpm':
      return `pnpm run ${scriptName}`;
    case 'yarn':
      return `yarn run ${scriptName}`;
    default:
      return `npm run ${scriptName}`;
  }
}

export function formatAddArgs(pm: PackageManager, packages: string[]): string[] {
  if (pm === 'deno') {
    return ['add', ...packages.map((p) => `npm:${p}`)];
  }
  return ['add', ...packages];
}

export function formatAddDevArgs(pm: PackageManager, packages: string[]): string[] {
  if (pm === 'deno') {
    return ['add', '--dev', ...packages.map((p) => `npm:${p}`)];
  }
  return ['add', '-D', ...packages];
}
