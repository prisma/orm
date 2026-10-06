/**
 * Sentinel value representing the absence of a contract (empty/new project).
 * This is a human-readable marker, not a real SHA-256 hash.
 */
export const EMPTY_CONTRACT_HASH = 'empty' as const;

/** The contract hash a database is at: its marker's storage hash, or the empty contract when it has no marker. */
export function contractHashAtMarker(
  marker: { readonly storageHash: string } | null | undefined,
): string {
  return marker?.storageHash ?? EMPTY_CONTRACT_HASH;
}
