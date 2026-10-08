import type { Type } from 'arktype';
import { contractError } from './contract-errors';

export interface IndexTypeEntry<TOptions = unknown> {
  readonly type: string;
  readonly options: Type<TOptions>;
}

export type IndexTypeMap = { readonly [K in string]: { readonly options: unknown } };

export interface IndexTypeRegistration<TMap extends IndexTypeMap = Record<never, never>> {
  readonly IndexTypes: TMap;
  readonly entries: ReadonlyArray<IndexTypeEntry>;
}

export interface IndexTypeBuilder<TMap extends IndexTypeMap = Record<never, never>>
  extends IndexTypeRegistration<TMap> {
  add<TLit extends string, TOpts>(
    typeLiteral: TLit,
    entry: { readonly options: Type<TOpts> },
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
    entry: { readonly options: Type<TOpts> },
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
      { type: typeLiteral, options: entry.options as Type<unknown> },
    ]);
  }
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
