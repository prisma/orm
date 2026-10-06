import type {
  AuthoringFieldPresetDescriptor,
  AuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';

export type ContributedTypeDescriptor =
  | AuthoringTypeConstructorDescriptor
  | AuthoringFieldPresetDescriptor;

export type ContributedTypeNamespace = {
  readonly [name: string]: ContributedTypeDescriptor | ContributedTypeNamespace;
};

export interface ContributedTypeSymbol {
  readonly kind: 'contributedType';
  readonly name: string;
  readonly path: readonly string[];
  readonly descriptor: ContributedTypeDescriptor;
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
  entries(): Iterable<readonly [string, ContributedMember]>;
}

export function isContributedTypeDescriptor(
  value: ContributedTypeDescriptor | ContributedTypeNamespace,
): value is ContributedTypeDescriptor {
  return 'kind' in value && (value.kind === 'typeConstructor' || value.kind === 'fieldPreset');
}

export function mergeContributedTypes(
  ...namespaces: readonly ContributedTypeNamespace[]
): ContributedTypeNamespace {
  const merged: Record<string, ContributedTypeDescriptor | ContributedTypeNamespace> = {};
  for (const namespace of namespaces) {
    for (const [name, value] of Object.entries(namespace)) {
      const existing = Object.hasOwn(merged, name) ? merged[name] : undefined;
      merged[name] =
        existing !== undefined &&
        !isContributedTypeDescriptor(existing) &&
        !isContributedTypeDescriptor(value)
          ? mergeContributedTypes(existing, value)
          : value;
    }
  }
  return merged;
}

export function contributedTypeScope(
  contributedTypes: ContributedTypeNamespace,
): ContributedTypeScope {
  const members = collect(contributedTypes, []);
  return {
    lookup(name) {
      return members.get(name);
    },
    entries() {
      return members.entries();
    },
  };
}

function collect(
  namespace: ContributedTypeNamespace,
  prefix: readonly string[],
): ReadonlyMap<string, ContributedMember> {
  const members = new Map<string, ContributedMember>();
  for (const [name, value] of Object.entries(namespace)) {
    const path = [...prefix, name];
    members.set(
      name,
      isContributedTypeDescriptor(value)
        ? { kind: 'contributedType', name, path, descriptor: value }
        : { kind: 'contributedNamespace', name, path, members: collect(value, path) },
    );
  }
  return members;
}
