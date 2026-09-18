import type {
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { isAuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';

export interface UniverseSymbol {
  readonly kind: 'universe';
  readonly name: string;
  readonly path: readonly string[];
  readonly descriptor: AuthoringTypeConstructorDescriptor;
}

export interface UniverseScope {
  lookup(path: readonly string[]): UniverseSymbol | undefined;
}

const scopes = new WeakMap<AuthoringTypeNamespace, UniverseScope>();

export function universeScope(typeConstructors: AuthoringTypeNamespace): UniverseScope {
  const existing = scopes.get(typeConstructors);
  if (existing !== undefined) return existing;
  const created = buildScope(typeConstructors);
  scopes.set(typeConstructors, created);
  return created;
}

function buildScope(typeConstructors: AuthoringTypeNamespace): UniverseScope {
  const symbols = new Map<string, UniverseSymbol>();
  collect(typeConstructors, [], symbols);
  return {
    lookup(path) {
      return symbols.get(path.join('.'));
    },
  };
}

function collect(
  namespace: AuthoringTypeNamespace,
  prefix: readonly string[],
  symbols: Map<string, UniverseSymbol>,
): void {
  for (const [name, value] of Object.entries(namespace)) {
    const path = [...prefix, name];
    if (isAuthoringTypeConstructorDescriptor(value)) {
      symbols.set(path.join('.'), { kind: 'universe', name, path, descriptor: value });
    } else {
      collect(value, path, symbols);
    }
  }
}
