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
   *
   * The `storage` it returns is not yet in its normal form: the framework applies `normalizeStorage` to it after this method, when it writes the contract, so a caller must write `storage` through the framework's canonicalizer, never from this result.
   */
  serializeContract(contract: TContract): JsonObject;

  /**
   * The family's normal form of `storage`, which the framework applies both when it writes `storage` and when it computes or checks a storage hash, so the written section and the hash input are one form. The family leaves out the fields it defines as equal to their absence and orders its storage arrays; the framework itself leaves out nothing. A family with neither passes a function that returns the storage it is given. A target does not override its family's function.
   */
  readonly normalizeStorage: NormalizeStorage;
}
