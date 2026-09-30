import { buildNativeTypeExpander } from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';

/** The types PostgreSQL stores with a length of 1 when none is written, and introspection reports that way. */
const LENGTH_ONE_WHEN_BARE: ReadonlySet<string> = new Set(['character', 'bit']);

/**
 * The family's native type expander, which expands a column's type parameters through its codec's hook, plus PostgreSQL's rule that `character` and `bit` without a length are `character(1)` and `bit(1)`, so a bare column compares equal to what introspection reports.
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
    const expanded = expand === undefined ? input.nativeType : expand(input);
    return LENGTH_ONE_WHEN_BARE.has(expanded) ? `${expanded}(1)` : expanded;
  };
}
