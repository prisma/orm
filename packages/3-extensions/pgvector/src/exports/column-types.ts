/**
 * Column type descriptor factory for pgvector extension. `vector(N)` is the canonical authoring surface; every pgvector column must declare a dimension via this factory.
 */

import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { VECTOR_CODEC_ID } from '../core/constants';

/**
 * Factory for creating dimensioned vector column descriptors.
 *
 * @example
 * ```typescript
 * .column('embedding', { type: vector(1536), nullable: false })
 * // Produces: codecId: 'pg/vector@1', typeParams: { length: 1536 }
 * ```
 * @param length - The dimension of the vector (e.g., 1536 for OpenAI embeddings)
 * @returns A column type descriptor with `typeParams.length` set
 */
export function vector<N extends number>(
  length: N,
): ColumnTypeDescriptor<typeof VECTOR_CODEC_ID> & { readonly typeParams: { readonly length: N } } {
  return {
    codecId: VECTOR_CODEC_ID,
    typeParams: { length },
  } as const;
}
