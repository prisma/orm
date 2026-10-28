import type {
  AuthoringTypeAliasDescriptor,
  AuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';

export type ContributedTypeDescriptor =
  | AuthoringTypeConstructorDescriptor
  | AuthoringTypeAliasDescriptor;

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
  return 'kind' in value && (value.kind === 'typeConstructor' || value.kind === 'typeAlias');
}

/** The codec a column typed by `descriptor` is stored with. */
export function contributedTypeCodecId(descriptor: ContributedTypeDescriptor): string {
  return descriptor.kind === 'typeAlias'
    ? descriptor.output.type.codecId
    : descriptor.output.codecId;
}

/** The descriptor at `path` in `namespace`, or `undefined` when none is contributed there. */
export function contributedTypeAt(
  namespace: ContributedTypeNamespace,
  path: readonly string[],
): ContributedTypeDescriptor | undefined {
  const [name, ...rest] = path;
  if (name === undefined || !Object.hasOwn(namespace, name)) return undefined;
  const value = namespace[name];
  if (value === undefined) return undefined;
  if (isContributedTypeDescriptor(value)) return rest.length === 0 ? value : undefined;
  return contributedTypeAt(value, rest);
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
