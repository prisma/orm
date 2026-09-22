import type { Contract } from '@internal/contract/types';
import { emitterError } from './emitter-errors';

/**
 * The emitter only ever consumes a freshly authored contract, so every same-space to-one relation
 * must already state whether it is nullable. Hydration of an on-disk contract derives a missing
 * flag instead; that path never reaches here.
 */
export function requireToOneRelationNullability(contract: Contract): void {
  for (const [namespaceId, namespace] of Object.entries(contract.domain.namespaces)) {
    for (const [modelName, model] of Object.entries(namespace.models)) {
      for (const [relationName, relation] of Object.entries(model.relations ?? {})) {
        const isSameSpaceToOne =
          'on' in relation &&
          (relation.cardinality === '1:1' || relation.cardinality === 'N:1') &&
          relation.to.space === undefined;
        if (!isSameSpaceToOne || typeof relation.nullable === 'boolean') continue;
        throw emitterError(
          'CONTRACT.RELATION_INVALID',
          `Relation "${relationName}" on model "${namespaceId}:${modelName}" is a ${relation.cardinality} relation and must carry a boolean "nullable"`,
          {
            why: 'contract.d.ts types a to-one relation as nullable or required from this flag, and the authoring surfaces always set it.',
            fix: 'Author the contract through PSL or the contract builder, which derive the flag from the local fields the relation joins on.',
            meta: { modelName, relationName, reason: 'to-one-nullability-missing' },
          },
        );
      }
    }
  }
}
