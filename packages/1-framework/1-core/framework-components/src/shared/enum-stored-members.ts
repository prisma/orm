import type { JsonValue } from '@internal/contract/types';
import { canonicalStringify } from '@internal/utils/canonical-stringify';

export interface StoredEnumMember {
  readonly name: string;
  readonly stored: JsonValue;
}

export interface DuplicateStoredMember {
  readonly earlier: string;
  readonly later: string;
  readonly stored: JsonValue;
}

/**
 * Each enum member whose stored form equals an earlier member's, paired with the first such member. Stored forms are equal when `canonicalStringify` writes them the same, so two objects with the same entries in a different order are equal. Every enum authoring surface refuses the members this returns.
 */
export function duplicateStoredMembers(
  members: readonly StoredEnumMember[],
): readonly DuplicateStoredMember[] {
  const memberByStoredForm = new Map<string, string>();
  const duplicates: DuplicateStoredMember[] = [];
  for (const { name, stored } of members) {
    const key = canonicalStringify(stored);
    const earlier = memberByStoredForm.get(key);
    if (earlier === undefined) {
      memberByStoredForm.set(key, name);
    } else {
      duplicates.push({ earlier, later: name, stored });
    }
  }
  return duplicates;
}
