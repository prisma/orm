import { publicShells, type ShellDefinition, type ShellName } from './shells';

export class ShellMappingError extends Error {}

interface OwningShell {
  readonly shell: ShellName;
  readonly entry: string;
}

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

export function platformEntrypointOf(specifier: string): { shell: ShellName; id: string } {
  const [scope, pkg, ...rest] = specifier.split('/');
  const owner = owners.get(`${scope}/${pkg}`);
  if (owner === undefined) {
    throw new ShellMappingError(`${specifier} is not mapped to any published shell`);
  }
  const tail = [owner.entry, rest.join('/')].filter(Boolean).join('/');
  return { shell: owner.shell, id: tail === '' ? owner.shell : `${owner.shell}/${tail}` };
}
