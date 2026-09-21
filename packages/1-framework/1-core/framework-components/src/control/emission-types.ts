import type { Contract, ContractModelBase, JsonValue } from '@internal/contract/types';
import type { AggregateDescriptor } from '../shared/aggregate-descriptor';
import type { AnyCodecDescriptor } from '../shared/codec-descriptor';
import type { CodecLookup } from '../shared/codec-types';
import type { ImportSpecifierResolver } from '../shared/import-specifier-resolver';
import type { TypesImportSpec } from '../shared/types-import-spec';

export interface GenerateContractTypesOptions {
  readonly queryOperationTypeImports?: ReadonlyArray<TypesImportSpec>;
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

export interface ValidationContext {
  readonly codecTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds?: ReadonlyArray<string>;
}

export interface EmissionSpi {
  readonly id: string;

  generateStorageType(contract: Contract, storageHashTypeName: string): string;

  generateModelStorageType(modelName: string, model: ContractModelBase): string;

  /**
   * The import lines the family's own contract surface needs, with every
   * specifier passed through `resolveImportSpecifier` so the emitted file
   * names packages the consuming application actually depends on.
   */
  getFamilyImports(resolveImportSpecifier: ImportSpecifierResolver): string[];

  getFamilyTypeAliases(options?: GenerateContractTypesOptions): string;

  getTypeMapsExpression(): string;

  getContractWrapper(contractBaseName: string, typeMapsName: string): string;

  resolveFieldTypeParams?(
    modelName: string,
    fieldName: string,
    model: ContractModelBase,
    contract: Contract,
  ): Record<string, unknown> | undefined;

  /**
   * Resolves a field's permitted values (codec-encoded) plus the codec that types them, or
   * `undefined` for a field with no restricted value set. The framework renders the values into a TS
   * literal union through the codec seam. Each family decides where the values live — a value set in
   * its own storage plane, or another family-owned source.
   */
  resolveFieldValueSet?(
    modelName: string,
    fieldName: string,
    model: ContractModelBase,
    contract: Contract,
  ): { readonly encodedValues: readonly JsonValue[]; readonly codecId: string } | undefined;

  getStorageTypeExports?(contract: Contract, codecLookup?: CodecLookup): string | undefined;
}
