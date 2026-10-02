import type { Type } from 'arktype';
import { contractError } from './contract-errors';

export interface IndexTypeEntry<TOptions = unknown> {
  readonly type: string;
  readonly options: Type<TOptions>;
  /**
   * Whether an index of this type over a foreign key's columns serves the foreign key's lookups,
   * so no separate backing index is derived for it.
   */
  readonly backsForeignKey: boolean;
}

type IndexTypeDeclaration<TOpts> = {
  readonly options: Type<TOpts>;
  readonly backsForeignKey: boolean;
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
        backsForeignKey: entry.backsForeignKey,
      },
    ]);
  }
}

export function defineIndexTypes(): IndexTypeBuilder<Record<never, never>> {
  return new IndexTypeBuilderImpl([]);
}

export interface IndexTypeRegistry {
  /** `registrant` names the pack the entry comes from, for the refusal of a malformed entry. */
  register(entry: IndexTypeEntry, registrant?: string): void;
  get(typeLiteral: string): IndexTypeEntry | undefined;
  has(typeLiteral: string): boolean;
  /** Whether an index of this type can back a foreign key; false for a type nobody registered. */
  backsForeignKey(typeLiteral: string): boolean;
}

class IndexTypeRegistryImpl implements IndexTypeRegistry {
  private readonly entries = new Map<string, IndexTypeEntry>();

  register(entry: IndexTypeEntry, registrant?: string): void {
    if (typeof entry.backsForeignKey !== 'boolean') {
      const source = registrant === undefined ? '' : ` registered by pack "${registrant}"`;
      throw contractError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Index type "${entry.type}"${source} does not declare backsForeignKey.`,
        {
          why: "Each index type says whether an index of that type can serve a foreign key's lookups, so a foreign key gets a backing index only when no declared index can serve it.",
          fix: `Upgrade ${registrant === undefined ? 'the pack that registers this index type' : `the pack "${registrant}"`}, or add \`backsForeignKey\` to its registration: \`true\` only for an index that answers equality lookups on its leading columns, as btree and hash do; \`false\` for search, spatial and range-summary indexes.`,
          meta: {
            indexType: entry.type,
            ...(registrant === undefined ? {} : { packId: registrant }),
          },
        },
      );
    }
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

  backsForeignKey(typeLiteral: string): boolean {
    return this.entries.get(typeLiteral)?.backsForeignKey === true;
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
 * The registry of every index type the given packs register: the target and the extension packs a
 * contract is built or inferred with.
 */
export function indexTypeRegistryOf(
  registrants: readonly IndexTypeRegistrant[],
): IndexTypeRegistry {
  const registry = createIndexTypeRegistry();
  for (const registrant of registrants) {
    const registration = registrant.indexTypes;
    if (registration === undefined) continue;
    if (!isIndexTypeRegistration(registration)) {
      throw contractError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Pack "${registrant.id ?? '<unknown>'}" declares "indexTypes" but its value is not an IndexTypeRegistration (expected an object with an "entries" array; got ${typeof registration}).`,
        {
          meta: { packId: registrant.id, contribution: 'indexTypes', reason: 'invalid-shape' },
        },
      );
    }
    for (const entry of registration.entries) {
      registry.register(entry, registrant.id);
    }
  }
  return registry;
}
