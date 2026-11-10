import type { TableIndexReferences } from '@internal/sql-relational-core/index-reference';
import type { NamespaceTable, TableProxyContract } from './db';

/**
 * A table's indexes, keyed by the name the contract source gave each: the `name:` prefix, or the `map:` name. An unnamed index, such as a derived foreign-key backing index, appears under its default prefix. A name that more than one index shares is left out, as reading it is refused at runtime.
 */
export type IndexReferences<
  C extends TableProxyContract,
  NsId extends string,
  Name extends string,
> = TableIndexReferences<NamespaceTable<C, NsId, Name>>;
