import { ifDefined } from '@internal/utils/defined';
import type { Type } from 'arktype';
import { contractError } from './contract-errors';

export interface IndexTypeEntry<TOptions = unknown> {
  readonly type: string;
  readonly options: Type<TOptions>;
  /**
   * The access method an index of this type is created with. It is the type literal itself for an
   * access method such as `btree`. When it differs, the type is a kind of index the target turns
   * into an index of that access method, rendering its body from the options. Only the target
   * provides that conversion, so {@link indexTypeRegistryOf} refuses such an entry from an extension
   * pack. Absent, it is the type literal.
   */
  readonly accessMethod?: string;
  /**
   * Traits the codec of every column an index of this type covers must carry. The contract build
   * checks them through the contract's codec lookup.
   */
  readonly columnTraits?: readonly string[];
}

type IndexTypeDeclaration<TOpts> = {
  readonly options: Type<TOpts>;
  readonly accessMethod?: string;
  readonly columnTraits?: readonly string[];
};

export type IndexTypeMap = { readonly [K in string]: { readonly options: unknown } };

export interface IndexTypeRegistration<TMap extends IndexTypeMap = Record<never, never>> {
  readonly IndexTypes: TMap;
  readonly entries: ReadonlyArray<IndexTypeEntry>;
}

export interface IndexTypeBuilder<TMap extends IndexTypeMap = Record<never, never>>
  extends IndexTypeRegistration<TMap> {
  add<TLit extends string, TOpts>(
    typeLiteral: TLit,
    entry: IndexTypeDeclaration<TOpts>,
  ): IndexTypeBuilder<TMap & Record<TLit, { readonly options: TOpts }>>;
}

class IndexTypeBuilderImpl<TMap extends IndexTypeMap> implements IndexTypeBuilder<TMap> {
  readonly entries: ReadonlyArray<IndexTypeEntry>;
  readonly IndexTypes: TMap;

  constructor(entries: ReadonlyArray<IndexTypeEntry>) {
    this.entries = entries;
    this.IndexTypes = {} as TMap;
  }

  add<TLit extends string, TOpts>(
    typeLiteral: TLit,
    entry: IndexTypeDeclaration<TOpts>,
  ): IndexTypeBuilder<TMap & Record<TLit, { readonly options: TOpts }>> {
    if (this.entries.some((e) => e.type === typeLiteral)) {
      throw contractError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Index type "${typeLiteral}" is already declared in this builder`,
        { meta: { indexType: typeLiteral } },
      );
    }
    return new IndexTypeBuilderImpl<TMap & Record<TLit, { readonly options: TOpts }>>([
      ...this.entries,
      {
        type: typeLiteral,
        options: entry.options as Type<unknown>,
        ...ifDefined('accessMethod', entry.accessMethod),
        ...ifDefined('columnTraits', entry.columnTraits),
      },
    ]);
  }
}

/**
 * Whether an index of this type is rendered from its options rather than written by its author: a
 * type whose access method is not its own literal. Its SQL body is the target's rendering, so an
 * exact-named index of the type is compared by that body.
 */
export function rendersIndexBody(entry: IndexTypeEntry): boolean {
  return accessMethodOf(entry) !== entry.type;
}

/** The access method an index of this type is created with. */
export function accessMethodOf(entry: IndexTypeEntry): string {
  return entry.accessMethod ?? entry.type;
}

export function defineIndexTypes(): IndexTypeBuilder<Record<never, never>> {
  return new IndexTypeBuilderImpl([]);
}

export interface IndexTypeRegistry {
  register(entry: IndexTypeEntry): void;
  get(typeLiteral: string): IndexTypeEntry | undefined;
  has(typeLiteral: string): boolean;
}

class IndexTypeRegistryImpl implements IndexTypeRegistry {
  private readonly entries = new Map<string, IndexTypeEntry>();

  register(entry: IndexTypeEntry): void {
    if (this.entries.has(entry.type)) {
      throw contractError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Index type "${entry.type}" is already registered`,
        { meta: { indexType: entry.type } },
      );
    }
    this.entries.set(entry.type, entry);
  }

  get(typeLiteral: string): IndexTypeEntry | undefined {
    return this.entries.get(typeLiteral);
  }

  has(typeLiteral: string): boolean {
    return this.entries.has(typeLiteral);
  }
}

export function createIndexTypeRegistry(): IndexTypeRegistry {
  return new IndexTypeRegistryImpl();
}

/** A pack as it offers index types: its id and, optionally, its `indexTypes` registration. */
export interface IndexTypeRegistrant {
  readonly id?: string;
  readonly indexTypes?: unknown;
}

function isIndexTypeRegistration(value: unknown): value is IndexTypeRegistration<IndexTypeMap> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'entries' in value &&
    Array.isArray(value.entries)
  );
}

/**
 * The registry of every index type the target and the extension packs a contract is built or
 * inferred with register. An extension pack's entry whose access method is not its type literal is
 * refused, because only the target converts such a type into an index of its access method.
 */
export function indexTypeRegistryOf(
  target: IndexTypeRegistrant,
  extensions: readonly IndexTypeRegistrant[] = [],
): IndexTypeRegistry {
  const registry = createIndexTypeRegistry();
  for (const entry of registeredEntriesOf(target)) {
    registry.register(entry);
  }
  for (const extension of extensions) {
    for (const entry of registeredEntriesOf(extension)) {
      if (rendersIndexBody(entry)) {
        throw extensionIndexTypeNotAccessMethod(entry, extension.id);
      }
      registry.register(entry);
    }
  }
  return registry;
}

function registeredEntriesOf(registrant: IndexTypeRegistrant): ReadonlyArray<IndexTypeEntry> {
  const registration = registrant.indexTypes;
  if (registration === undefined) return [];
  if (!isIndexTypeRegistration(registration)) {
    throw contractError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `Pack "${registrant.id ?? '<unknown>'}" declares "indexTypes" but its value is not an IndexTypeRegistration (expected an object with an "entries" array; got ${typeof registration}).`,
      {
        meta: { packId: registrant.id, contribution: 'indexTypes', reason: 'invalid-shape' },
      },
    );
  }
  return registration.entries;
}

function extensionIndexTypeNotAccessMethod(entry: IndexTypeEntry, packId: string | undefined) {
  const accessMethod = accessMethodOf(entry);
  const pack = packId === undefined ? 'an extension pack' : `extension pack "${packId}"`;
  return contractError(
    'CONTRACT.PACK_CONTRIBUTION_INVALID',
    `Index type "${entry.type}" registered by ${pack} declares the access method "${accessMethod}", but an extension pack's index type must be an access method itself.`,
    {
      why: `An index type whose access method differs from its name is turned into an index of that access method by the target, which renders the index body from the options. Only the target provides that conversion, so the database would be asked for an access method named "${entry.type}".`,
      fix: `Register the access method under its own name, or leave \`accessMethod\` out of the "${entry.type}" registration so the type name is the access method.`,
      meta: {
        indexType: entry.type,
        accessMethod,
        ...ifDefined('packId', packId),
      },
    },
  );
}
