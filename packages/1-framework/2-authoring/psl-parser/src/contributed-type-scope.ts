import {
  type AuthoringTypeAliasDescriptor,
  type AuthoringTypeChoiceDescriptor,
  type AuthoringTypeConstructorDescriptor,
  type DataTypeSupport,
  type ResolvedAuthoringTypeChoice,
  resolveAuthoringTypeChoice,
  typeConstructorLookup,
} from '@internal/framework-components/authoring';
import { isInternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import { EMPTY_DATA_TYPES } from './attribute-spec/spec-context';
import { readPslHelperArgs } from './authoring-arguments';
import type { ResolvedTypeConstructorCall } from './resolve';

export type ContributedTypeDescriptor =
  | AuthoringTypeConstructorDescriptor
  | AuthoringTypeAliasDescriptor
  | AuthoringTypeChoiceDescriptor;

export type ContributedTypeNamespace = {
  readonly [name: string]: ContributedTypeDescriptor | ContributedTypeNamespace;
};

interface ContributedTypeSymbolBase {
  readonly kind: 'contributedType';
  readonly name: string;
  readonly path: readonly string[];
}

/** A contributed type choice, with the type constructors its rows name, by name, from the namespace that holds it. */
export interface ContributedTypeChoiceSymbol extends ContributedTypeSymbolBase {
  readonly descriptor: AuthoringTypeChoiceDescriptor;
  readonly choiceTypes: ReadonlyMap<string, AuthoringTypeConstructorDescriptor>;
}

export type ContributedTypeSymbol =
  | (ContributedTypeSymbolBase & {
      readonly descriptor: Exclude<ContributedTypeDescriptor, AuthoringTypeChoiceDescriptor>;
    })
  | ContributedTypeChoiceSymbol;

export function isContributedTypeChoice(
  symbol: ContributedTypeSymbol,
): symbol is ContributedTypeChoiceSymbol {
  return symbol.descriptor.kind === 'typeChoice';
}

/** A contributed type as a field or type alias uses it: the type, and the call it is written with, `undefined` when it is written bare. */
export interface ContributedTypeUse {
  readonly symbol: ContributedTypeSymbol;
  readonly call: ResolvedTypeConstructorCall | undefined;
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
  return (
    'kind' in value &&
    (value.kind === 'typeConstructor' || value.kind === 'typeAlias' || value.kind === 'typeChoice')
  );
}

/** The explicit type a call of the type choice `symbol` chooses and the arguments it is built with, reading the call as the column does, or why it chooses none. */
export function chosenTypeConstructor(
  symbol: ContributedTypeChoiceSymbol,
  call: ResolvedTypeConstructorCall | undefined,
  dataTypes: DataTypeSupport,
): Result<ResolvedAuthoringTypeChoice, string> {
  const helperPath = symbol.path.join('.');
  const args = readPslHelperArgs({
    args: call?.args ?? [],
    descriptors: symbol.descriptor.args,
    dataTypes,
  });
  if (args === undefined) return notOk(`The arguments of ${helperPath} do not read.`);
  try {
    return ok(
      resolveAuthoringTypeChoice({
        helperPath,
        descriptor: symbol.descriptor,
        args,
        constructorNamed: (name) => symbol.choiceTypes.get(name),
      }),
    );
  } catch (error) {
    if (isInternalError(error) || !(error instanceof Error)) throw error;
    return notOk(error.message);
  }
}

/** The codec a column typed by `use` is stored with; `undefined` for a type choice whose call chooses no type, which the column's resolution reports. */
export function contributedTypeCodecId(
  use: ContributedTypeUse,
  dataTypes: DataTypeSupport,
): string | undefined {
  const { symbol } = use;
  if (isContributedTypeChoice(symbol)) {
    const chosen = chosenTypeConstructor(symbol, use.call, dataTypes);
    return chosen.ok ? chosen.value.descriptor.output.codecId : undefined;
  }
  const { descriptor } = symbol;
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

/** The codec a column typed by `call` is stored with, reading the call's arguments as the column does, or `undefined` when no type is contributed at its path or it is a type choice whose arguments choose no type. */
export function writtenContributedTypeCodecId(
  namespace: ContributedTypeNamespace,
  call: ResolvedTypeConstructorCall,
): string | undefined {
  return codecIdAtPath(namespace, call.path, [], call);
}

function codecIdAtPath(
  namespace: ContributedTypeNamespace,
  path: readonly string[],
  prefix: readonly string[],
  call: ResolvedTypeConstructorCall,
): string | undefined {
  const [name, ...rest] = path;
  if (name === undefined || !Object.hasOwn(namespace, name)) return undefined;
  const value = namespace[name];
  if (value === undefined) return undefined;
  const at = [...prefix, name];
  if (!isContributedTypeDescriptor(value)) return codecIdAtPath(value, rest, at, call);
  if (rest.length > 0) return undefined;
  return contributedTypeCodecId(
    { symbol: contributedTypeSymbol(name, at, value, namespace), call },
    EMPTY_DATA_TYPES,
  );
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
        ? contributedTypeSymbol(name, path, value, namespace)
        : { kind: 'contributedNamespace', name, path, members: collect(value, path) },
    );
  }
  return members;
}

function contributedTypeSymbol(
  name: string,
  path: readonly string[],
  descriptor: ContributedTypeDescriptor,
  namespace: ContributedTypeNamespace,
): ContributedTypeSymbol {
  if (descriptor.kind !== 'typeChoice') return { kind: 'contributedType', name, path, descriptor };
  const constructorNamed = typeConstructorLookup(namespace);
  const choiceTypes = new Map<string, AuthoringTypeConstructorDescriptor>();
  for (const { type } of descriptor.choices) {
    const chosen = constructorNamed(type);
    if (chosen !== undefined) choiceTypes.set(type, chosen);
  }
  return { kind: 'contributedType', name, path, descriptor, choiceTypes };
}
