import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { CITEXT_CODEC_ID } from '../core/constants';

/**
 * A `citext` column: text PostgreSQL compares without regard to case.
 *
 * @example
 * ```typescript
 * email: field.column(citext())
 * ```
 */
export function citext(): ColumnTypeDescriptor<typeof CITEXT_CODEC_ID> {
  return { codecId: CITEXT_CODEC_ID } as const;
}

export { citextColumn } from '../core/codecs';
