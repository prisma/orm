import type {
  AnyEntityKindDescriptor,
  EntityKindDescriptor,
} from '@internal/framework-components/ir';
import { ifDefined } from '@internal/utils/defined';
import { contractError } from './contract-errors';
import { CheckConstraint } from './ir/check-constraint';
import { Index } from './ir/sql-index';
import {
  SqlStorageValueObjectSchema,
  StorageTableSchema,
  StorageValueSetSchema,
} from './ir/storage-entry-schemas';
import { StorageTable, type StorageTableInput } from './ir/storage-table';
import { StorageValueObject, type StorageValueObjectInput } from './ir/storage-value-object';
import { StorageValueSet, type StorageValueSetInput } from './ir/storage-value-set';
import {
  checkConstraintInputFromSerialized,
  type SerializedCheckConstraint,
} from './serialized-check-constraint';
import { indexInputFromSerialized, type SerializedIndex } from './serialized-index';

/**
 * A table entry as it reaches hydration: from `contract.json` its indexes and
 * checks are still the stored flat records, from authoring they are already
 * `Index` / `CheckConstraint` nodes.
 */
export type HydratableStorageTable = Omit<StorageTableInput, 'indexes' | 'checks'> & {
  readonly indexes: ReadonlyArray<Index | SerializedIndex>;
  readonly checks?: ReadonlyArray<CheckConstraint | SerializedCheckConstraint>;
};

export const tableEntityKind: EntityKindDescriptor<HydratableStorageTable, StorageTable> = {
  kind: 'table',
  schema: StorageTableSchema,
  construct: (input) =>
    new StorageTable({
      ...input,
      indexes: input.indexes.map((i) => (i instanceof Index ? i : indexInputFromSerialized(i))),
      ...ifDefined(
        'checks',
        input.checks?.map((c) =>
          c instanceof CheckConstraint ? c : checkConstraintInputFromSerialized(c),
        ),
      ),
    }),
};

export const valueSetEntityKind: EntityKindDescriptor<StorageValueSetInput, StorageValueSet> = {
  kind: 'valueSet',
  schema: StorageValueSetSchema,
  construct: (input) => new StorageValueSet(input),
};

export const valueObjectEntityKind: EntityKindDescriptor<
  StorageValueObjectInput,
  StorageValueObject
> = {
  kind: 'valueObject',
  schema: SqlStorageValueObjectSchema,
  construct: (input) => new StorageValueObject(input),
};

/**
 * Assembles the `kind → descriptor` registry for SQL namespaces: the built-in
 * `table`, `valueSet` and `valueObject` kinds plus any target `packKinds`. This builds the
 * lookup table — it does not touch contract data. `hydrateNamespaceEntities`
 * later consumes this registry to turn a namespace's raw entries into IR
 * instances, and `createSqlContractSchema` derives validation from the same
 * registry. Throws on a duplicate kind.
 */
export function composeSqlEntityKinds(
  packKinds: readonly AnyEntityKindDescriptor[] = [],
): ReadonlyMap<string, AnyEntityKindDescriptor> {
  const kinds = new Map<string, AnyEntityKindDescriptor>([
    ['table', tableEntityKind],
    ['valueSet', valueSetEntityKind],
    ['valueObject', valueObjectEntityKind],
  ]);
  for (const descriptor of packKinds) {
    if (kinds.has(descriptor.kind)) {
      throw contractError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `composeSqlEntityKinds: duplicate entity kind "${descriptor.kind}" — each kind may be registered only once`,
        { meta: { entityKind: descriptor.kind } },
      );
    }
    kinds.set(descriptor.kind, descriptor);
  }
  return kinds;
}
