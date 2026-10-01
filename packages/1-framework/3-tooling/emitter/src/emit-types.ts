import type {
  PreserveEmptyPredicate,
  SerializeContract,
  StorageSort,
} from '@internal/contract/hashing';
import type { Contract } from '@internal/contract/types';
import type { AnyCodecDescriptor, CodecLookup } from '@internal/framework-components/codec';
import type { AggregateDescriptor } from '@internal/framework-components/components';
import type {
  ImportSpecifierResolver,
  TypesImportSpec,
} from '@internal/framework-components/emission';

/**
 * The subset of ControlStack that emit() reads.
 * All fields are optional so tests can pass minimal objects.
 * A full ControlStack satisfies this via structural typing.
 */
export interface EmitStackInput {
  readonly codecTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly queryOperationTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds?: ReadonlyArray<string>;
  readonly codecLookup?: CodecLookup;
  readonly codecDescriptors?: ReadonlyArray<AnyCodecDescriptor>;
  readonly aggregateDescriptors?: ReadonlyArray<AggregateDescriptor>;
}

export interface EmitOptions {
  readonly outputJsonPath?: string;
  /**
   * Per-target serializer that converts the in-memory contract into its
   * canonical on-disk JsonObject shape before the framework's
   * key-ordering / default-omission walk runs. Threaded from the
   * descriptor (`descriptor.contractSerializer.serializeContract`) at
   * the CLI / control-API call site so target classes decide what
   * appears in the JSON envelope rather than the framework guessing
   * via property enumerability.
   */
  readonly serializeContract: SerializeContract;
  /**
   * Optional family-contributed preserve-empty predicate. Threaded from
   * `descriptor.contractSerializer.shouldPreserveEmpty` when present.
   */
  readonly shouldPreserveEmpty?: PreserveEmptyPredicate;
  /**
   * Optional family-contributed storage sort hook. Threaded from
   * `descriptor.contractSerializer.sortStorage` when present.
   */
  readonly sortStorage?: StorageSort;
  /**
   * Rewrites the package names the generated `contract.d.ts` imports from, for
   * the import root the consuming application installed. Defaults to leaving
   * every specifier as authored, which is what the repository itself needs
   * while its own code still imports workspace names.
   */
  readonly resolveImportSpecifier?: ImportSpecifierResolver;
  /**
   * Threaded from `descriptor.supportsNamespaces`. `false` drops the namespace segment from emitted `Models` member names and the `models` constant.
   */
  readonly supportsNamespaces?: boolean;
  /**
   * Hydrates the canonical JSON object back into a contract. The declarations
   * are always generated from that round-trip, never from the contract as
   * authored, so `contract.d.ts` orders every collection the way
   * `contract.json` does and a render from the JSON reproduces it exactly.
   */
  readonly deserializeContract: (json: Record<string, unknown>) => Contract;
}

export interface EmitResult {
  readonly contractJson: string;
  readonly contractDts: string;
  readonly storageHash: string;
  readonly executionHash?: string;
  readonly profileHash: string;
}
