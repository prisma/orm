import type { ContractValueObjectField } from '@internal/contract/types';
import { freezeNode } from '@internal/framework-components/ir';
import { SqlNode } from './sql-node';

/** Hydration / construction input shape for {@link StorageValueObject}; mirrors the stored JSON. */
export interface StorageValueObjectInput {
  readonly fields: Readonly<Record<string, ContractValueObjectField>>;
}

/**
 * SQL Contract IR node for a value object in a namespace's `valueObject` map (`SqlNamespace.entries.valueObject`): the keys every row holds in a column that stores it (ADR 309). A domain field refers to it by its storage coordinate.
 *
 * A field that leaves out `many` holds `many: false`, as the authoring builders write it, so a contract read from JSON equals the one built from its source.
 *
 * The entry's name is not on the class: value objects are keyed by name in the parent namespace's `valueObject` map.
 */
export class StorageValueObject extends SqlNode {
  readonly fields: Readonly<Record<string, ContractValueObjectField>>;

  constructor(input: StorageValueObjectInput) {
    super();
    this.fields = Object.freeze(
      Object.fromEntries(
        Object.entries(input.fields).map(([name, field]) => [
          name,
          Object.freeze({ ...field, many: field.many ?? false }),
        ]),
      ),
    );
    freezeNode(this);
  }
}
