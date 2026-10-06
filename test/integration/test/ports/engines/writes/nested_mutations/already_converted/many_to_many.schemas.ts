import parentIdSimpleChildIdSimpleJunction from './_fixture/many_to_many/parent_id_simple__child_id_simple__junction/generated/contract.json' with {
  type: 'json',
};
import type { SchemaVariant } from './relation_link_matrix';

export const schemas: readonly SchemaVariant[] = [
  ['parent id simple, child id simple, junction', parentIdSimpleChildIdSimpleJunction, 'simple'],
];
