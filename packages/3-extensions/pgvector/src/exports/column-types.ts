/**
 * Column type descriptor factory for pgvector extension. `vector(N?)` is the canonical authoring surface; each pgvector column may optionally declare a dimension via this factory. When provided, the dimension threads into the runtime codec through `paramsSchema.length` and into the DDL via the data type declaration (e.g. `vector(1536)`).
 */

import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { VECTOR_CODEC_ID } from '../core/constants';

/**
 * Factory for creating non-dimensioned vector column descriptors.
 *
 * @example
 * ```typescript
 * .column('embedding', { type: vector(), nullable: false })
 * // Produces: typeParams: {}
 * ```
 * @returns A column type descriptor without `typeParams.length` set
 */
export function vector(): ColumnTypeDescriptor<typeof VECTOR_CODEC_ID> & {
  readonly typeParams: Record<string, never>;
};
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
): ColumnTypeDescriptor<typeof VECTOR_CODEC_ID> & { readonly typeParams: { readonly length: N } };

/** Creates a vector descriptor, omitting the dimension parameter when no length is supplied. */
export function vector(length?: number): ColumnTypeDescriptor<typeof VECTOR_CODEC_ID> {
  if (length === undefined) {
    return { codecId: VECTOR_CODEC_ID, typeParams: {} };
  }
  return {
    codecId: VECTOR_CODEC_ID,
    typeParams: { length },
  } as const;
}
