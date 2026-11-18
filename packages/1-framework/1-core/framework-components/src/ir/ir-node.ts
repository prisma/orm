/**
 * Framework-level IR alphabet.
 *
 * The framework's contribution to Contract IR / Schema IR is a common
 * root for the IR class hierarchy and a freeze affordance. Family
 * abstract bases (e.g. `SqlNode`, `MongoSchemaIRNode`) refine the alphabet
 * for their family shape; targets ship the concrete classes.
 *
 * `kind` is an optional discriminator on the base. Families and leaves
 * that benefit from discriminated-union dispatch declare their own
 * literal `kind` at the level that earns it — Mongo leaves carry
 * per-class literals (`readonly kind = 'mongo-collection' as const`)
 * because Mongo IR has polymorphic walkers; SQL declares a single
 * family-level `kind = 'sql'` on `SqlNode` because SQL IR has no
 * polymorphic dispatch today. No framework consumer dispatches on
 * `IRNode.kind` at the BASE type — every dispatch site narrows
 * through a union of leaves where each leaf carries a literal kind, so
 * requiring `kind` at the base would be unearned. Future leaves that
 * earn polymorphic dispatch override with a required literal at that
 * leaf (e.g. `override readonly kind = 'pack-contributed-kind' as const`).
 *
 * `IRNodeBase` carries no methods: the freeze-and-assign affordance
 * lives in the free `freezeNode` helper below. Keeping `freezeNode` out
 * of the class type means an emitted contract literal type
 * (`{ readonly kind: 'mongo-collection', ... }` or an unkeyed literal
 * like `{ dataType, codecId, nullable }`) is structurally assignable
 * to its class type — a `protected freeze()` instance method would
 * otherwise leak into the public type surface and require the literal
 * to carry it too.
 *
 * Subclasses construct fields then call `freezeNode(this)` to seal the
 * instance. Frozen instances + plain readonly fields keep IR nodes
 * JSON-clean by construction, so `JSON.stringify(node)` produces canonical
 * JSON without a `toJSON()` method. The `ContractSerializer` SPI handles
 * round-trip from canonical JSON back to typed class instances.
 *
 * The name (`IRNode` / `IRNodeBase`) reflects the dual-hierarchy reality:
 * this base is the common root for both Contract IR and Schema IR class
 * hierarchies, not a Schema-IR-specific alphabet.
 */

export interface IRNode {
  readonly kind?: string;
}

export abstract class IRNodeBase implements IRNode {
  abstract readonly kind?: string;
}

/**
 * Seal an IR class instance after its constructor has assigned all
 * fields. The free-helper form (rather than a `protected freeze()`
 * instance method) keeps the class type structurally narrow so emitted
 * contract literal types remain assignable to their class types.
 *
 * The helper name stays `freezeNode` — it operates on IR nodes
 * regardless of root naming.
 */
export function freezeNode<T extends IRNode>(node: T): T {
  Object.freeze(node);
  return node;
}
