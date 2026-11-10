import type { ContractValueObjectField } from '@internal/contract/types';
import { freezeNode, IRNodeBase } from '@internal/framework-components/ir';

/** Hydration / construction input shape for {@link MongoValueObject}; mirrors the stored JSON, where a field may leave out `many`. */
export interface MongoValueObjectInput {
  readonly fields: Readonly<Record<string, ContractValueObjectField>>;
}

/**
 * Mongo Contract IR node for a value object in a namespace's `valueObject` map (`entries.valueObject`): the fields every subdocument that holds it has (ADR 309). Same shape as SQL's `StorageValueObject`. A domain field refers to it by its storage coordinate. The `kind` is not enumerable, so the stored JSON holds the fields only, as in SQL. Value objects are keyed by name in the parent namespace's `valueObject` map, so the entry name is not on the class.
 */
export class MongoValueObject extends IRNodeBase {
  declare readonly kind: 'mongo-value-object';
  readonly fields: Readonly<Record<string, ContractValueObjectField>>;

  constructor(input: MongoValueObjectInput) {
    super();
    Object.defineProperty(this, 'kind', {
      value: 'mongo-value-object',
      writable: false,
      enumerable: false,
      configurable: false,
    });
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
