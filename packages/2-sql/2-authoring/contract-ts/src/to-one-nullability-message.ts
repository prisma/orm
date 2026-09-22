import type { ToOneRelationNullabilityContradiction } from '@internal/contract-authoring';

export function toOneNullabilityContradictionMessage(
  location: string,
  contradiction: ToOneRelationNullabilityContradiction,
): string {
  return contradiction === 'declared-optional'
    ? `${location} is optional but every local field it joins on is required`
    : `${location} is required but a local field it joins on is nullable`;
}
