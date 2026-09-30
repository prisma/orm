import { buildNativeTypeExpander } from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { canonicalPostgresTypeName } from '../native-type-normalizer';

/** The types PostgreSQL stores with a length of 1 when none is written, and introspection reports that way. */
const LENGTH_ONE_WHEN_BARE: ReadonlySet<string> = new Set(['character', 'bit']);

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
    const expanded = canonicalPostgresTypeName(
      expand === undefined ? input.nativeType : expand(input),
    );
    return LENGTH_ONE_WHEN_BARE.has(expanded) ? `${expanded}(1)` : expanded;
  };
}
