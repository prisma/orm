import {
  assembleDataTypes,
  type DataType,
  type DataTypeId,
  type DataTypeLookup,
} from './data-type';
import {
  type AuthoringContributions,
  type AuthoringTypeConstructorDescriptor,
  type DataTypeAuthoringEntry,
  isAuthoringTypeConstructorDescriptor,
  isAuthoringTypeDescriptor,
} from './framework-authoring';
import { runtimeError } from './runtime-error';
import type { DataTypeSupport } from './written-value';

/** A component as data type assembly reads it: the data types it registers, their authoring entries, the codecs that name them, and the type constructors whose value arguments name them. */
export interface DataTypeComponent {
  readonly id?: string;
  readonly dataTypes?: ReadonlyArray<DataType>;
  readonly authoring?: Pick<AuthoringContributions, 'dataTypes' | 'type' | 'textDataTypes'>;
  readonly types?: {
    readonly [slot: string]: unknown;
    readonly codecTypes?: {
      readonly codecDescriptors?: ReadonlyArray<{
        readonly codecId: string;
        readonly dataType: DataTypeId;
      }>;
    };
  };
}

/** What the data type checks of assembly read, each item with the id of the component that contributed it. */
export interface DataTypeAssemblyInput {
  readonly lookup: DataTypeLookup;
  readonly declaredTypes: ReadonlyArray<{
    readonly type: DataType;
    readonly contributedBy: string;
  }>;
  readonly codecs: ReadonlyArray<{
    readonly codecId: string;
    readonly dataType: DataTypeId;
    readonly contributedBy: string;
  }>;
  readonly authoringEntries: ReadonlyArray<{
    readonly key: string;
    readonly entry: DataTypeAuthoringEntry;
    readonly contributedBy: string;
  }>;
  readonly textDataTypes: ReadonlyArray<{
    readonly dataType: DataTypeId;
    readonly contributedBy: string;
  }>;
}

/** A type constructor, the helper that takes arguments, with the path it is registered under and who registered it. */
export interface ContributedHelper {
  readonly path: string;
  readonly descriptor: AuthoringTypeConstructorDescriptor;
  readonly contributedBy: string;
}

export interface AssembledDataTypeSupport {
  readonly support: DataTypeSupport;
  /** Every data type the components register, with the id of the component that registered it. */
  readonly declared: ReadonlyArray<{ readonly type: DataType; readonly contributedBy: string }>;
}

const UNKNOWN_CONTRIBUTOR = '<unknown>';

/** Merge every component's PSL support for its data types, refusing two claims on one key. */
export function assembleAuthoringDataTypes(
  components: ReadonlyArray<Pick<DataTypeComponent, 'id' | 'authoring'>>,
): Readonly<Record<string, DataTypeAuthoringEntry>> {
  const merged: Record<string, DataTypeAuthoringEntry> = {};
  const owners = new Map<string, string>();

  for (const component of components) {
    const contributedBy = component.id ?? UNKNOWN_CONTRIBUTOR;
    for (const [key, entry] of Object.entries(component.authoring?.dataTypes ?? {})) {
      const existingOwner = owners.get(key);
      if (existingOwner !== undefined) {
        throw runtimeError(
          'CONTRACT.DATA_TYPE_ENTRY_DUPLICATE',
          `Duplicate authoring entry for "${key}". Component "${contributedBy}" conflicts with "${existingOwner}".`,
          { key, contributedBy, owner: existingOwner },
        );
      }
      owners.set(key, contributedBy);
      merged[key] = entry;
    }
  }

  return merged;
}

type AuthoringTree<D> = { readonly [name: string]: D | AuthoringTree<D> };

function descriptorsIn<D>(
  namespace: AuthoringTree<D> | undefined,
  isLeaf: (value: D | AuthoringTree<D>) => value is D,
  path: readonly string[] = [],
): ReadonlyArray<{ readonly path: string; readonly descriptor: D }> {
  return Object.entries(namespace ?? {}).flatMap(([key, value]) => {
    const currentPath = [...path, key];
    if (isLeaf(value)) return [{ path: currentPath.join('.'), descriptor: value }];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
    return descriptorsIn(value, isLeaf, currentPath);
  });
}

/** Every type constructor a component contributes. */
export function contributedHelpers(
  component: Pick<DataTypeComponent, 'id' | 'authoring'>,
): readonly ContributedHelper[] {
  return descriptorsIn(component.authoring?.type, isAuthoringTypeDescriptor).flatMap(
    ({ path, descriptor }) =>
      isAuthoringTypeConstructorDescriptor(descriptor)
        ? [{ path, descriptor, contributedBy: component.id ?? UNKNOWN_CONTRIBUTOR }]
        : [],
  );
}

/** The data types a contract source can write: each entry's own, and every type a plain-number entry classifies a number as. */
function writableDataTypes(
  entries: DataTypeAssemblyInput['authoringEntries'],
): ReadonlySet<string> {
  return new Set(
    entries.flatMap(({ key, entry }) => [
      key,
      ...(entry.written.kind === 'plain' && entry.written.syntax === 'number'
        ? entry.written.types
        : []),
    ]),
  );
}

/** Refuses a value argument whose data type is unregistered, or that no contract source can write, directly or through a cast, and a type-constructor argument that is not a value. */
function enforceValueArguments(
  support: DataTypeSupport,
  contributed: ContributedHelper,
  writable: ReadonlySet<string>,
): void {
  const { path, descriptor, contributedBy } = contributed;
  for (const [index, argument] of (descriptor.args ?? []).entries()) {
    const label = `Argument ${argument.name === undefined ? `#${index + 1}` : `"${argument.name}"`} of type constructor "${path}"`;
    const argumentKind: string = argument.kind;
    if (argumentKind !== 'value') {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `${label} contributed by "${contributedBy}" is an argument of kind "${argumentKind}", but a type constructor's argument is a value of a data type. Declare it as { kind: 'value', dataType: ... }, naming the data type its value belongs to.`,
        {
          packId: contributedBy,
          contribution: path,
          reason: 'type-constructor-argument-not-a-value',
        },
      );
    }
    const type = support.lookup.get(argument.dataType);
    if (type === undefined) {
      throw runtimeError(
        'CONTRACT.DATA_TYPE_UNREGISTERED',
        `${label} names data type "${argument.dataType}", which no component registers. Contributed by "${contributedBy}".`,
        { dataType: argument.dataType, contributedBy },
      );
    }
    const admitted = [argument.dataType, ...Object.keys(type.casts)];
    if (!admitted.some((admittedType) => writable.has(admittedType))) {
      throw runtimeError(
        'CONTRACT.DATA_TYPE_NOT_WRITABLE',
        `${label} contributed by "${contributedBy}" takes a value of data type "${argument.dataType}", which no contract source can write.`,
        { dataType: argument.dataType, contributedBy },
      );
    }
  }
}

function textDataTypesOf(
  components: ReadonlyArray<DataTypeComponent>,
): DataTypeAssemblyInput['textDataTypes'] {
  return components.flatMap((component) =>
    (component.authoring?.textDataTypes ?? []).map((dataType) => ({
      dataType,
      contributedBy: component.id ?? UNKNOWN_CONTRIBUTOR,
    })),
  );
}

/**
 * The checks assembly makes across components on their data types, each naming the component and the id at fault:
 *
 * 1. every codec names a registered data type;
 * 2. every authoring entry, and every type a number classifier returns, names a registered data type;
 * 3. every type a cast takes values of is registered and can be written, because a cast from a type nobody can write is never exercised;
 * 4. no two entries claim one tag or one plain form;
 * 5. every text data type a component names is registered.
 */
export function enforceDataTypeAssemblyInvariants(input: DataTypeAssemblyInput): void {
  const unregistered = (contributedBy: string, id: string, what: string): never => {
    throw runtimeError(
      'CONTRACT.DATA_TYPE_UNREGISTERED',
      `${what} names data type "${id}", which no component registers. Contributed by "${contributedBy}".`,
      { dataType: id, contributedBy },
    );
  };

  for (const codec of input.codecs) {
    if (!input.lookup.has(codec.dataType)) {
      unregistered(codec.contributedBy, codec.dataType, `Codec "${codec.codecId}"`);
    }
  }

  for (const { key, entry, contributedBy } of input.authoringEntries) {
    if (!input.lookup.has(key)) {
      unregistered(contributedBy, key, 'Authoring entry');
    }
    if (entry.written.kind === 'plain' && entry.written.syntax === 'number') {
      for (const classified of entry.written.types) {
        if (!input.lookup.has(classified)) {
          unregistered(contributedBy, classified, `The classifier of authoring entry "${key}"`);
        }
      }
    }
  }

  for (const { dataType, contributedBy } of input.textDataTypes) {
    if (!input.lookup.has(dataType)) {
      unregistered(contributedBy, dataType, 'The text data types');
    }
  }

  const writable = writableDataTypes(input.authoringEntries);
  for (const { type, contributedBy } of input.declaredTypes) {
    const sources = [...Object.keys(type.casts), ...(type.listCast?.of ?? [])];
    for (const source of sources) {
      if (!input.lookup.has(source)) {
        unregistered(contributedBy, source, `The casts of data type "${type.id}"`);
      }
      if (!writable.has(source)) {
        throw runtimeError(
          'CONTRACT.DATA_TYPE_NOT_WRITABLE',
          `Data type "${type.id}" casts from "${source}", which no contract source can write, so the cast is never exercised. Contributed by "${contributedBy}".`,
          { dataType: type.id, source, contributedBy },
        );
      }
    }
  }

  const claimants = new Map<string, { readonly key: string; readonly contributedBy: string }>();
  for (const { key, entry, contributedBy } of input.authoringEntries) {
    const written = entry.written;
    const claim = written.kind === 'tag' ? `tag "${written.tag}"` : `plain ${written.syntax}`;
    const existing = claimants.get(claim);
    if (existing !== undefined) {
      throw runtimeError(
        'CONTRACT.DATA_TYPE_WRITTEN_FORM_DUPLICATE',
        `Two authoring entries claim the ${claim}: "${key}" from "${contributedBy}" conflicts with "${existing.key}" from "${existing.contributedBy}".`,
        {
          claim,
          key,
          contributedBy,
          owner: existing.key,
          ownerContributedBy: existing.contributedBy,
        },
      );
    }
    claimants.set(claim, { key, contributedBy });
  }
}

/**
 * The data types the components register, with their authoring entries, as every contract source reads values with. Refuses two registrations of one data type or one entry key, every case {@link enforceDataTypeAssemblyInvariants} lists, a value argument of a type constructor whose data type is unregistered or that no contract source can write, and a type-constructor argument that is not a value. ADR 254.
 */
export function assembleDataTypeSupport(
  components: ReadonlyArray<DataTypeComponent>,
  dataTypeOfCodec: (codecId: string) => DataTypeId | undefined,
): AssembledDataTypeSupport {
  const { lookup, declared } = assembleDataTypes(components);
  const entries = assembleAuthoringDataTypes(components);
  const contributedBy = (component: DataTypeComponent) => component.id ?? UNKNOWN_CONTRIBUTOR;
  const authoringEntries = components.flatMap((component) =>
    Object.entries(component.authoring?.dataTypes ?? {}).map(([key, entry]) => ({
      key,
      entry,
      contributedBy: contributedBy(component),
    })),
  );
  enforceDataTypeAssemblyInvariants({
    lookup,
    declaredTypes: declared,
    codecs: components.flatMap((component) =>
      (component.types?.codecTypes?.codecDescriptors ?? []).map(({ codecId, dataType }) => ({
        codecId,
        dataType,
        contributedBy: contributedBy(component),
      })),
    ),
    authoringEntries,
    textDataTypes: textDataTypesOf(components),
  });
  const support: DataTypeSupport = {
    entries,
    lookup,
    dataTypeOfCodec,
    textDataTypes: [
      ...new Set(components.flatMap((component) => component.authoring?.textDataTypes ?? [])),
    ],
  };
  const writable = writableDataTypes(authoringEntries);
  for (const contributed of components.flatMap(contributedHelpers)) {
    enforceValueArguments(support, contributed, writable);
  }
  return { support, declared };
}
