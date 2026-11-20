import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { SqlContractSerializerBase } from './sql-contract-serializer-base';

/**
 * Default SQL family `ContractSerializer` concretion. Inherits the
 * full SQL-shared deserialization pipeline (structural validation +
 * IR-class hydration) without pack-registered `storage.types`
 * hydration factories — targets that emit polymorphic JSON outside the
 * codec-typed envelope wire a target-specific subclass with a populated
 * registry (see Postgres). Family-level call sites instantiate this
 * default directly when no target serializer is supplied.
 *
 * Because this serializer has no target concretion, deserialization of
 * contracts that include namespace entries from JSON will throw unless
 * the caller provides pre-hydrated `NamespaceBase` instances. Production
 * paths always supply a target-specific serializer.
 */
export class SqlContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor() {
    super(new Map());
  }
}
