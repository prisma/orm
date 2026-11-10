import { IRNodeBase } from '@internal/framework-components/ir';

/**
 * SQL family IR node base. Carries the family-level `kind` discriminator
 * `'sql'` and inherits the framework's `freezeNode` affordance.
 *
 * Single family-level discriminator (not per-leaf) reflects the fact that
 * SQL IR has no polymorphic dispatch today — verifiers and serializers
 * walk by structural position (`storage.tables[name].columns[name]`),
 * not by inspecting `kind`. The abstract bar for per-leaf discriminators
 * isn't earned until a future polymorphic consumer arrives.
 *
 * `kind` is installed as a non-enumerable own property on every instance,
 * which keeps three things clean simultaneously:
 *
 * - `JSON.stringify(node)` produces the canonical pre-lift JSON envelope
 *   shape (no `kind` field), so emitted contract.json files and the
 *   `validateSqlContractFully` arktype schemas stay unchanged.
 * - Test assertions that use `toEqual({...})` against the pre-lift flat
 *   shape continue to pass — only enumerable own properties are
 *   compared.
 * - Direct access (`node.kind`) and runtime narrowing
 *   (`if (node.kind === 'sql')`) still work, so future polymorphic
 *   dispatch can begin reading `kind` without a runtime change.
 *
 * Future per-leaf overrides land cleanly: a class that gains a
 * polymorphic-dispatch consumer (e.g. an enum type instance walked
 * alongside other types) overrides `kind` with its narrower literal
 * at that leaf level. Per-leaf overrides will use enumerable kind
 * (matching the Mongo per-class-discriminator precedent) because they
 * encode dispatch-relevant information that callers need to see in
 * JSON envelopes; the family-level `'sql'` is uniform across all SQL
 * IR and carries no dispatch-relevant information.
 */
export abstract class SqlNode extends IRNodeBase {
  readonly kind?: string;

  constructor() {
    super();
    Object.defineProperty(this, 'kind', {
      value: 'sql',
      writable: false,
      enumerable: false,
      // configurable so per-leaf subclasses (e.g. StorageValueSet)
      // can override `kind` with their narrower
      // enumerable literal via a class-field initializer. SqlNode
      // itself never needs to mutate the property again, so
      // configurability has no surface impact at this layer.
      configurable: true,
    });
  }
}
