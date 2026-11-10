import {
  type AuthoringPslBlockDescriptor,
  type AuthoringPslBlockDescriptorNamespace,
  isAuthoringPslBlockDescriptor,
} from '@internal/framework-components/authoring';

export function findBlockDescriptor(
  descriptors: AuthoringPslBlockDescriptorNamespace | undefined,
  keyword: string,
): AuthoringPslBlockDescriptor | undefined {
  if (descriptors === undefined) return undefined;
  for (const value of Object.values(descriptors)) {
    if (value === undefined) continue;
    if (isAuthoringPslBlockDescriptor(value)) {
      if (value.keyword === keyword) return value;
      continue;
    }
    const nested = findBlockDescriptor(value, keyword);
    if (nested !== undefined) return nested;
  }
  return undefined;
}
