import { buildNativeTypeExpander } from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { normalizeSchemaNativeType, withLengthOneWhenBare } from '../native-type-normalizer';

/**
 * The family's native type expander, which expands a column's type parameters through its codec's hook, with the type named as introspection reports it: under PostgreSQL's canonical name rather than an alias such as `char` or `int`, and with `character` and `bit` without a length as `character(1)` and `bit(1)`.
 */
export function buildPostgresNativeTypeExpander(
  frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>> | undefined,
) {
  const expand = buildNativeTypeExpander(frameworkComponents);
  return (input: {
    readonly nativeType: string;
    readonly codecId?: string;
    readonly typeParams?: Record<string, unknown>;
  }): string => {
    return withLengthOneWhenBare(
      normalizeSchemaNativeType(expand === undefined ? input.nativeType : expand(input)),
    );
  };
}
