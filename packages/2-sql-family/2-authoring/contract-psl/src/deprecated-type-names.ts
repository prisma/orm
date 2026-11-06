import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import type { FieldSymbol, NamedTypeSymbol } from '@internal/psl-parser';
import { diagnosticSource, mapPslDiagnostics, typeReferenceNode } from '@internal/psl-parser';
import type { PslSources } from '@internal/psl-parser/syntax';

/** Warns when a field or a `types {}` alias is typed with a deprecated type name. */
export type DeprecatedTypeNameWarner = (
  typed: FieldSymbol | NamedTypeSymbol,
  written: string,
  descriptor: AuthoringTypeConstructorDescriptor,
) => void;

/**
 * Reports `PSL_DEPRECATED_SCALAR_NAME` at the type of a field or `types {}` alias whose type constructor is a deprecated alias, naming the replacement. The alias gives the same codec, so the contract does not change. ADR 257.
 */
export function deprecatedTypeNameWarner(input: {
  readonly sources: PslSources;
  readonly reportWarning: ((diagnostic: ContractSourceDiagnostic) => void) | undefined;
}): DeprecatedTypeNameWarner {
  const { reportWarning } = input;
  if (reportWarning === undefined) return () => {};
  return (typed, written, descriptor) => {
    if (descriptor.deprecated === undefined) return;
    const typeNode = typeReferenceNode(typed) ?? typed.node.syntax;
    const [warning] = mapPslDiagnostics(
      [
        {
          code: 'PSL_DEPRECATED_SCALAR_NAME',
          message: `Scalar type "${written}" is deprecated and will be removed; use "${descriptor.deprecated.replacement}".`,
          ...diagnosticSource(input.sources, typeNode).at(),
        },
      ],
      input.sources,
    );
    if (warning !== undefined) reportWarning({ ...warning, severity: 'warning' });
  };
}
