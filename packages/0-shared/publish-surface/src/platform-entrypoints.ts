/**
 * The published name of an internal workspace specifier, for the build of the
 * published packages. The mapping itself is `./shells`; nothing here
 * duplicates it.
 */

import { publicShells, type ShellDefinition, type ShellName } from './shells';

/** The shell table maps a package twice, or a specifier to no package. */
export class ShellMappingError extends Error {}

interface OwningShell {
  readonly shell: ShellName;
  readonly entry: string;
}

/**
 * Takes the shell map as an argument rather than closing over `publicShells`
 * so the duplicate-owner guard is reachable from a test: the real map is
 * valid by construction, and a guard nothing can exercise is a guard nobody
 * knows still works.
 */
export function buildOwnerIndex(
  shells: ReadonlyMap<ShellName, ShellDefinition>,
): Map<string, OwningShell> {
  const index = new Map<string, OwningShell>();
  for (const [shell, definition] of shells) {
    for (const pkg of definition.packages) {
      const existing = index.get(pkg.name);
      if (existing !== undefined) {
        throw new ShellMappingError(
          `${pkg.name} is mapped to both ${existing.shell} and ${shell}; ` +
            'one module may live in only one published package (ADR 242)',
        );
      }
      index.set(pkg.name, { shell, entry: pkg.entry });
    }
  }
  return index;
}

const owners: ReadonlyMap<string, OwningShell> = buildOwnerIndex(publicShells);

/**
 * The published entrypoint of an internal specifier, with the shell that owns
 * it. The shell build needs both: an import that stays inside the shell being
 * built is bundled rather than externalized.
 */
export function platformEntrypointOf(specifier: string): { shell: ShellName; id: string } {
  const [scope, pkg, ...rest] = specifier.split('/');
  const owner = owners.get(`${scope}/${pkg}`);
  if (owner === undefined) {
    throw new ShellMappingError(`${specifier} is not mapped to any published shell`);
  }
  const tail = [owner.entry, rest.join('/')].filter(Boolean).join('/');
  return { shell: owner.shell, id: tail === '' ? owner.shell : `${owner.shell}/${tail}` };
}
