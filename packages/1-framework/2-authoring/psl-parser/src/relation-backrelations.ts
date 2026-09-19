import { diagnosticSource, type PslDiagnostic } from './diagnostic';
import type { PslSources } from './source-file';
import type { FieldSymbol } from './symbol-table';

/**
 * An FK-side relation that was rejected (for example by the nullability check) and so never
 * became relation metadata. Its back-relation candidate is not orphaned; the FK-side diagnostic
 * already names the problem.
 */
export type InvalidFkPairing = {
  readonly pairKey: string;
  readonly relationName?: string;
};

export function fkRelationPairKey(declaringModelName: string, targetModelName: string): string {
  // NOTE: We assume PSL model identifiers do not contain the `::` separator.
  return `${declaringModelName}::${targetModelName}`;
}

/**
 * Claims the one rejected FK side that pairs with this back-relation candidate: same model pair
 * and the same relation name, where an unnamed candidate pairs only with an unnamed FK side.
 * A claimed pairing is removed, so a second candidate on the same pair reports its own problem.
 */
export function consumeInvalidFkPairing(
  candidate: { readonly relationName?: string },
  pairKey: string,
  invalidFkPairings: InvalidFkPairing[],
): boolean {
  const index = invalidFkPairings.findIndex(
    (pairing) => pairing.pairKey === pairKey && pairing.relationName === candidate.relationName,
  );
  if (index === -1) return false;
  invalidFkPairings.splice(index, 1);
  return true;
}

export function requiredOneToOneBackrelationDiagnostic(input: {
  readonly modelName: string;
  readonly field: FieldSymbol;
  readonly targetModelName: string;
  readonly sources: PslSources;
  readonly recordNoun: 'row' | 'document';
}): PslDiagnostic {
  const { modelName, field, targetModelName, sources, recordNoun } = input;
  return {
    code: 'PSL_REQUIRED_ONE_TO_ONE_BACKRELATION',
    message: `Backrelation field "${modelName}.${field.name}" is required, but "${targetModelName}" holds the relation fields, so nothing in storage guarantees a "${targetModelName}" ${recordNoun} exists. Make it optional: "${field.name} ${targetModelName}?".`,
    ...diagnosticSource(sources, field.node.syntax).at(field.span),
  };
}
