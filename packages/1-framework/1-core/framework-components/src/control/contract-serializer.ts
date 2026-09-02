import type { PreserveEmptyPredicate, StorageSort } from '@internal/contract/hashing';
import type { JsonObject } from '@internal/utils/json';

/**
 * Framework SPI for moving a contract between its canonical on-disk JSON
 * form and its in-memory class-hierarchy form. Both directions live on the
 * same SPI so the conceptual seam — "the boundary where the contract
 * crosses between persisted JSON and live class instances" — has a single
 * named home.
 *
 * Both faces are needed by the framework today (round-trip property tests,
 * drift detection, future canonicalization), not eventually. For most
 * targets `serializeContract` is identity over JSON-clean class instances;
 * the method exists because the seam is real, not as a convention placeholder.
 *
 * Implementers compose this SPI as a named property on their target
 * descriptor (`descriptor.contractSerializer`); the descriptor itself
 * remains the aggregator of all per-target SPIs.
 */
export interface ContractSerializer<TContract> {
  /**
   * Validate the JSON shape and construct typed class instances. Throws on
   * structural / domain / storage validation failures. Returns the typed
   * contract on success.
   *
   * The method-level type parameter lets call sites that hold a
   * precisely-typed contract literal (e.g. `typeof contract` from a
   * generated `contract.d.ts`) recover that literal type without an
   * external cast. The default `T = TContract` preserves the inferred
   * return type for every caller that does not opt in.
   */
  deserializeContract<T extends TContract = TContract>(json: unknown): T;

  /**
   * Serialize a typed contract to its canonical JSON shape. Returns
   * `JsonObject` so callers can stringify, hash, or feed the result into
   * another SPI without re-asserting JSON-cleanness. Targets whose contract
   * fields are JSON-clean by construction return the contract unchanged
   * (the symmetric pair to `deserializeContract`); targets that need to
   * canonicalize on the way out (key ordering, dropping computed-only
   * fields, normalizing numeric encodings) do that work here.
   */
  serializeContract(contract: TContract): JsonObject;

  /**
   * Optional family-contributed preserve-empty predicate for the
   * framework canonicalizer. When present, the canonicalizer calls this
   * inside its default-omission walk to let the family veto the stripping
   * of empty objects/arrays/`false` values at family-specific storage paths.
   * Families whose storage has no such special-case paths omit this hook.
   */
  readonly shouldPreserveEmpty?: PreserveEmptyPredicate;

  /**
   * Optional family-contributed storage sort hook for the framework
   * canonicalizer. When present, the canonicalizer applies this to the
   * serialized `storage` subtree after the omission walk and before the
   * final key sort. Families that need deterministic ordering of storage
   * arrays (e.g. SQL `indexes`/`uniques`) supply this hook.
   */
  readonly sortStorage?: StorageSort;

  /**
   * The canonicalization hooks the family's emit pipeline computes storage
   * hashes with. Distinct from {@link shouldPreserveEmpty} /
   * {@link sortStorage}: those govern on-disk serialization and may be
   * broader per target (Postgres preserves required entity-kind fields at
   * default values so the persisted contract re-deserializes), while a hash
   * recompute must reproduce the exact canonical form the published
   * `storageHash` was derived from. Integrity checks that recompute storage
   * hashes (snapshot content verification, descriptor self-consistency)
   * must use these hooks, never the serialization pair.
   */
  readonly hashCanonicalizationHooks?: {
    readonly shouldPreserveEmpty?: PreserveEmptyPredicate;
    readonly sortStorage?: StorageSort;
  };
}
