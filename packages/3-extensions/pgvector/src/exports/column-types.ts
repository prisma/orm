/**
 * Column type descriptor factory for pgvector extension. `vector(N)` is the canonical authoring surface; every pgvector column must declare a dimension via this factory. The dimension threads into the runtime codec through `paramsSchema.length` and into the DDL via the family-layer `expandNativeType` hook (e.g. `vector(1536)`).
 */

import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { VECTOR_CODEC_ID, VECTOR_MAX_DIM } from '../core/constants';
import { pgVectorError } from '../core/errors';

/**
 * Factory for creating dimensioned vector column descriptors.
 *
 * @example
 * ```typescript
 * .column('embedding', { type: vector(1536), nullable: false })
 * // Produces: nativeType: 'vector', typeParams: { length: 1536 }
 * ```
 * @param length - The dimension of the vector (e.g., 1536 for OpenAI embeddings)
 * @returns A column type descriptor with `typeParams.length` set
 * @throws `CONTRACT.ARGUMENT_INVALID` if length is not an integer in the range [1, VECTOR_MAX_DIM]
 */
export function vector<N extends number>(
  length: N,
): ColumnTypeDescriptor<typeof VECTOR_CODEC_ID> & { readonly typeParams: { readonly length: N } } {
  if (!Number.isInteger(length) || length < 1 || length > VECTOR_MAX_DIM) {
    throw pgVectorError(
      'CONTRACT.ARGUMENT_INVALID',
      `pgvector: dimension must be an integer in [1, ${VECTOR_MAX_DIM}], got ${length}`,
      {
        fix: `Pass an integer dimension between 1 and ${VECTOR_MAX_DIM}, e.g. vector(1536).`,
        meta: {
          helperPath: 'vector',
          expected: `an integer in [1, ${VECTOR_MAX_DIM}]`,
          received: length,
        },
      },
    );
  }
  return {
    codecId: VECTOR_CODEC_ID,
    nativeType: 'vector',
    typeParams: { length },
  } as const;
}
