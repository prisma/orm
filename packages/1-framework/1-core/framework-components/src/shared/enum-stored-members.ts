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
  /** The earlier member's stored form, present when it differs from `stored` and the data type's equality holds the two equal. */
  readonly earlierStored?: JsonValue;
}

function storedFormOf(stored: JsonValue): string {
  return canonicalStringify(JSON.parse(JSON.stringify(stored)));
}

/** The key two stored values are equal by: the data type's `equalityKey` when it declares one, else the stored form as `contract.json` holds it, compared by `canonicalStringify`. */
export function storedValueKey(
  stored: JsonValue,
  equalityKey: ((json: JsonValue) => string) | undefined,
): string {
  return equalityKey?.(stored) ?? storedFormOf(stored);
}

/**
 * Each enum member whose stored form equals an earlier member's, paired with the first such member. Stored forms are compared as `contract.json` holds them, so negative zero is zero, and by `canonicalStringify`, so two objects with the same entries in a different order are equal; or, when the enum's data type declares an `equalityKey`, by that key, so `0.5` and `0.50` are one `numeric` value. Every enum authoring surface refuses the members this returns.
 */
export function duplicateStoredMembers(
  members: readonly StoredEnumMember[],
  equalityKey?: (json: JsonValue) => string,
): readonly DuplicateStoredValue[] {
  const memberByKey = new Map<string, StoredEnumMember>();
  const duplicates: DuplicateStoredValue[] = [];
  for (const member of members) {
    const { name, stored } = member;
    const key = storedValueKey(stored, equalityKey);
    const earlier = memberByKey.get(key);
    if (earlier === undefined) {
      memberByKey.set(key, member);
    } else if (storedFormOf(earlier.stored) === storedFormOf(stored)) {
      duplicates.push({ earlier: earlier.name, later: name, stored });
    } else {
      duplicates.push({
        earlier: earlier.name,
        later: name,
        stored,
        earlierStored: earlier.stored,
      });
    }
  }
  return duplicates;
}
