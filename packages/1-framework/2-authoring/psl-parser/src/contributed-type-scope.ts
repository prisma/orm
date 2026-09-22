import type {
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { isAuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';

export interface ContributedTypeSymbol {
  readonly kind: 'contributedType';
  readonly name: string;
  readonly path: readonly string[];
  readonly descriptor: AuthoringTypeConstructorDescriptor;
}

export interface ContributedTypeScope {
  lookup(path: readonly string[]): ContributedTypeSymbol | undefined;
}

const scopes = new WeakMap<AuthoringTypeNamespace, ContributedTypeScope>();

export function contributedTypeScope(
  typeConstructors: AuthoringTypeNamespace,
): ContributedTypeScope {
  const existing = scopes.get(typeConstructors);
  if (existing !== undefined) return existing;
  const created = buildScope(typeConstructors);
  scopes.set(typeConstructors, created);
  return created;
}

function buildScope(typeConstructors: AuthoringTypeNamespace): ContributedTypeScope {
  const symbols = new Map<string, ContributedTypeSymbol>();
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
  symbols: Map<string, ContributedTypeSymbol>,
): void {
  for (const [name, value] of Object.entries(namespace)) {
    const path = [...prefix, name];
    if (isAuthoringTypeConstructorDescriptor(value)) {
      symbols.set(path.join('.'), { kind: 'contributedType', name, path, descriptor: value });
    } else {
      collect(value, path, symbols);
    }
  }
}
