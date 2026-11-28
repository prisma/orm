import type { NormalizeStorage, SerializeContract } from '@internal/contract/hashing';
import type { Contract } from '@internal/contract/types';
import type { AnyCodecDescriptor, CodecLookup } from '@internal/framework-components/codec';
import type { AggregateDescriptor } from '@internal/framework-components/components';
import type { TypesImportSpec } from '@internal/framework-components/emission';

/**
 * The subset of ControlStack that emit() reads.
 * All fields are optional so tests can pass minimal objects.
 * A full ControlStack satisfies this via structural typing.
 */
export interface EmitStackInput {
  readonly codecTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly queryOperationTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly parameterizedOutputTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds?: ReadonlyArray<string>;
  readonly codecLookup?: CodecLookup;
  readonly codecDescriptors?: ReadonlyArray<AnyCodecDescriptor>;
  readonly aggregateDescriptors?: ReadonlyArray<AggregateDescriptor>;
}

export interface EmitOptions {
  readonly outputJsonPath?: string;
  /**
   * Per-target serializer that converts the in-memory contract into its canonical on-disk JsonObject shape before the framework's key-ordering runs. Threaded from the descriptor (`descriptor.contractSerializer.serializeContract`) at the CLI / control-API call site so target classes decide what appears in the JSON envelope rather than the framework guessing via property enumerability.
   */
  readonly serializeContract: SerializeContract;
  /** The family's normal form of `storage`: `descriptor.contractSerializer.normalizeStorage`. */
  readonly normalizeStorage: NormalizeStorage;
  /** The module the generated `contract.d.ts` imports the framework's and family's contract types from: the config's `contract.typesModule`. */
  readonly typesModule: string;
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
