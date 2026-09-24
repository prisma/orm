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

export interface ContributedNamespaceSymbol {
  readonly kind: 'contributedNamespace';
  readonly name: string;
  readonly path: readonly string[];
  readonly members: ReadonlyMap<string, ContributedMember>;
}

export type ContributedMember = ContributedTypeSymbol | ContributedNamespaceSymbol;

export interface ContributedTypeScope {
  lookup(name: string): ContributedMember | undefined;
}

const scopes = new WeakMap<AuthoringTypeNamespace, ContributedTypeScope>();

export function contributedTypeScope(
  typeConstructors: AuthoringTypeNamespace,
): ContributedTypeScope {
  const existing = scopes.get(typeConstructors);
  if (existing !== undefined) return existing;
  const members = collect(typeConstructors, []);
  const created: ContributedTypeScope = {
    lookup(name) {
      return members.get(name);
    },
  };
  scopes.set(typeConstructors, created);
  return created;
}

function collect(
  namespace: AuthoringTypeNamespace,
  prefix: readonly string[],
): ReadonlyMap<string, ContributedMember> {
  const members = new Map<string, ContributedMember>();
  for (const [name, value] of Object.entries(namespace)) {
    const path = [...prefix, name];
    members.set(
      name,
      isAuthoringTypeConstructorDescriptor(value)
        ? { kind: 'contributedType', name, path, descriptor: value }
        : { kind: 'contributedNamespace', name, path, members: collect(value, path) },
    );
  }
  return members;
}
