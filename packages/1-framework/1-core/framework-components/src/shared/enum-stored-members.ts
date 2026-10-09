import type { JsonValue } from '@internal/contract/types';
import { canonicalStringify } from '@internal/utils/canonical-stringify';

export interface StoredEnumMember {
  readonly name: string;
  readonly stored: JsonValue;
}

export interface DuplicateStoredValue {
  readonly earlier: string;
  readonly later: string;
  readonly stored: JsonValue;
}

/**
 * Each enum member whose stored form equals an earlier member's, paired with the first such member. Stored forms are compared as `contract.json` holds them, so negative zero is zero, and by `canonicalStringify`, so two objects with the same entries in a different order are equal. Every enum authoring surface refuses the members this returns.
 */
export function duplicateStoredMembers(
  members: readonly StoredEnumMember[],
): readonly DuplicateStoredValue[] {
  const memberByStoredForm = new Map<string, string>();
  const duplicates: DuplicateStoredValue[] = [];
  for (const { name, stored } of members) {
    const key = canonicalStringify(JSON.parse(JSON.stringify(stored)));
    const earlier = memberByStoredForm.get(key);
    if (earlier === undefined) {
      memberByStoredForm.set(key, name);
    } else {
      duplicates.push({ earlier, later: name, stored });
    }
  }
  return duplicates;
}
