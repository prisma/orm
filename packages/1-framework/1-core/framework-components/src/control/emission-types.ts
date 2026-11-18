import type { Contract, ContractModelBase, JsonValue } from '@internal/contract/types';
import type { ImportRequirement } from '@internal/ts-render';
import type { AggregateDescriptor } from '../shared/aggregate-descriptor';
import type { AnyCodecDescriptor } from '../shared/codec-descriptor';
import type { CodecLookup } from '../shared/codec-types';
import type { TypesImportSpec } from '../shared/types-import-spec';

export interface GenerateContractTypesOptions {
  readonly queryOperationTypeImports?: ReadonlyArray<TypesImportSpec>;
  /** The type functions that give the output types of the stack's codecs for a column's type parameters (`types.codecTypes.parameterizedOutputTypes`). */
  readonly parameterizedOutputTypeImports?: ReadonlyArray<TypesImportSpec>;
  /**
   * The aggregate overloads the composed stack contributes, and the codec descriptors they are settled against. A family emits result types from these — the same declarations its runtime registry resolves against, so emitted types and decoded results cannot disagree.
   */
  readonly aggregateDescriptors?: ReadonlyArray<AggregateDescriptor>;
  readonly codecDescriptors?: ReadonlyArray<AnyCodecDescriptor>;
  /**
   * The target's namespace declaration. `false` drops the namespace segment from emitted `Models` member names and from the `models` constant; absent means `true`.
   */
  readonly supportsNamespaces?: boolean;
}

export interface EmissionSpi {
  readonly id: string;

  generateStorageType(contract: Contract, storageHashTypeName: string): string;

  generateModelStorageType(modelName: string, model: ContractModelBase): string;

  /** The family's own contract types a generated file imports, each from `typesModule`, the config's `contract.typesModule`. */
  getFamilyImports(typesModule: string): ReadonlyArray<ImportRequirement>;

  getFamilyTypeAliases(options?: GenerateContractTypesOptions): string;

  getTypeMapsExpression(): string;

  getContractWrapper(contractBaseName: string, typeMapsName: string): string;

  /**
   * Resolves a model field's permitted values (codec-encoded) plus the codec that types them, or
   * `undefined` for a field with no restricted value set. The framework renders the values into a TS
   * literal union through the codec seam. The framework resolves a field's reference to a domain
   * enum itself and calls this only for other fields, whose values live in the family's storage.
   */
  resolveStorageValueSet?(
    modelName: string,
    fieldName: string,
    model: ContractModelBase,
    contract: Contract,
  ): { readonly encodedValues: readonly JsonValue[]; readonly codecId: string } | undefined;

  getStorageTypeExports?(contract: Contract, codecLookup?: CodecLookup): string | undefined;
}
