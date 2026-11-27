import type { NormalizeStorage } from '@internal/contract/hashing';
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
   * Optional family-contributed normal form of `storage` for the framework canonicalizer, which applies it to the serialized `storage` before the final key sort. The family leaves out the fields it defines as equal to their absence and orders its storage arrays; the framework itself leaves out nothing.
   */
  readonly normalizeStorage?: NormalizeStorage;

  /**
   * The canonicalization hooks storage hashes are recomputed with, the same hooks the family writes `storage` with. Integrity checks that recompute storage hashes (snapshot content verification, descriptor self-consistency) use these. A family whose hash input is not the persisted storage shape (Mongo hashes a projection) must not publish them; its snapshots then read without content verification.
   */
  readonly hashCanonicalizationHooks?: {
    readonly normalizeStorage?: NormalizeStorage;
  };
}
