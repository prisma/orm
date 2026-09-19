import type {
  Contract,
  ContractEnum,
  ContractModelBase,
  ContractValueObject,
} from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
import {
  type EmissionSpi,
  type GenerateContractTypesOptions,
  type ImportSpecifierResolver,
  keepInternalSpecifiers,
  type TypesImportSpec,
} from '@internal/framework-components/emission';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import {
  deduplicateImports,
  generateCodecTypeIntersection,
  generateFieldTypesMapsByNamespace,
  generateHashTypeAliases,
  generateImportLines,
  generateModelsType,
  generateRootsType,
  generateValueObjectsDescriptorType,
  generateValueObjectTypeAliases,
  serializeExecutionType,
  serializeObjectKey,
  serializeValue,
} from './domain-type-generation';
import { emitterError } from './emitter-errors';
import { generateModelTypesBlock } from './model-types-emission';

function generateEnumBlockType(enums: Record<string, ContractEnum>): string {
  const entries = Object.entries(enums).map(([name, entry]) => {
    const memberTupleItems = entry.members.map(
      (m) =>
        `{ readonly name: ${serializeValue(m.name)}; readonly value: ${serializeValue(m.value)} }`,
    );
    const membersType = `readonly [${memberTupleItems.join(', ')}]`;
    return `readonly ${serializeObjectKey(name)}: { readonly codecId: ${serializeValue(entry.codecId)}; readonly members: ${membersType} }`;
  });
  return `{ ${entries.join('; ')} }`;
}

export function generateContractDts(
  contract: Contract,
  emitter: EmissionSpi,
  codecTypeImports: ReadonlyArray<TypesImportSpec>,
  hashes: {
    readonly storageHash: string;
    readonly executionHash?: string;
    readonly profileHash: string;
  },
  options?: GenerateContractTypesOptions,
  codecLookup?: CodecLookup,
  resolveImportSpecifier: ImportSpecifierResolver = keepInternalSpecifiers,
): string {
  const allImports: TypesImportSpec[] = [...codecTypeImports];
  if (options?.queryOperationTypeImports) {
    allImports.push(...options.queryOperationTypeImports);
  }
  const uniqueImports = deduplicateImports(allImports);
  const importLines = generateImportLines(uniqueImports, resolveImportSpecifier);

  const familyImportLines = emitter.getFamilyImports(resolveImportSpecifier);

  const hashAliases = generateHashTypeAliases(hashes);

  const codecTypes = generateCodecTypeIntersection(codecTypeImports, 'CodecTypes');

  const familyTypeAliases = emitter.getFamilyTypeAliases(options);

  const typeMapsExpr = emitter.getTypeMapsExpression();

  const storageType = emitter.generateStorageType(contract, 'StorageHash');

  const namespaceEntries = Object.entries(contract.domain.namespaces);
  if (namespaceEntries.length === 0) {
    throw emitterError('CONTRACT.NAMESPACE_INVALID', 'domain has no namespaces', {
      meta: { reason: 'no-domain-namespaces' },
    });
  }

  // Validate all namespace entries are present.
  for (const [nsId, ns] of namespaceEntries) {
    if (ns === undefined) {
      throw new InternalError(`domain namespace "${nsId}" is not present on the contract`);
    }
  }

  const rootsType = generateRootsType(contract.roots);

  // Flatten value objects across all namespaces — first-name-wins on collision.
  const flatValueObjects: Record<string, ContractValueObject> = {};
  for (const [, ns] of namespaceEntries) {
    for (const [voName, vo] of Object.entries(
      blindCast<
        Record<string, ContractValueObject>,
        'ns.valueObjects is a ContractValueObject record in the emitted IR (default to {} when absent)'
      >(ns.valueObjects ?? {}),
    )) {
      if (!(voName in flatValueObjects)) {
        flatValueObjects[voName] = vo;
      }
    }
  }
  const valueObjects = Object.keys(flatValueObjects).length > 0 ? flatValueObjects : undefined;
  const valueObjectTypeAliases = generateValueObjectTypeAliases(valueObjects, codecLookup);
  const valueObjectsDescriptor = generateValueObjectsDescriptorType(valueObjects);

  // Per-namespace models, value objects, and enum types for the domain.namespaces section.
  const perNamespaceTypes: Array<
    readonly [string, string, string | undefined, string | undefined]
  > = namespaceEntries.map(([nsId, ns]) => {
    const nsModels = ns.models;
    const nsModelsType = generateModelsType(nsModels, (name, model) =>
      emitter.generateModelStorageType(name, model),
    );
    const nsValueObjects = blindCast<
      Record<string, ContractValueObject> | undefined,
      'ns.valueObjects is an optional ContractValueObject record in the emitted IR'
    >(ns.valueObjects);
    const nsValueObjectsDescriptor =
      nsValueObjects !== undefined && Object.keys(nsValueObjects).length > 0
        ? generateValueObjectsDescriptorType(nsValueObjects)
        : undefined;
    const nsEnums = blindCast<
      Record<string, ContractEnum> | undefined,
      'ns.enum is an optional ContractEnum record in the emitted IR'
    >(ns.enum);
    const nsEnumBlock =
      nsEnums !== undefined && Object.keys(nsEnums).length > 0
        ? generateEnumBlockType(nsEnums)
        : undefined;
    return [nsId, nsModelsType, nsValueObjectsDescriptor, nsEnumBlock] as const;
  });

  const domainNamespacesType = perNamespaceTypes
    .map(([nsId, nsModelsType, nsValueObjectsDescriptor, nsEnumBlock]) => {
      const voLine =
        nsValueObjectsDescriptor !== undefined
          ? `\n        readonly valueObjects: ${nsValueObjectsDescriptor};`
          : '';
      const enumLine = nsEnumBlock !== undefined ? `\n        readonly enum: ${nsEnumBlock};` : '';
      return `      readonly ${serializeObjectKey(nsId)}: {\n        readonly models: ${nsModelsType};${voLine}${enumLine}\n      }`;
    })
    .join(';\n');

  const executionClause =
    contract.execution !== undefined
      ? `\n  readonly execution: ${serializeExecutionType(contract.execution)};`
      : '';

  const resolveFieldTypeParams = emitter.resolveFieldTypeParams
    ? (modelName: string, fieldName: string, model: ContractModelBase) =>
        emitter.resolveFieldTypeParams?.(modelName, fieldName, model, contract)
    : undefined;

  const resolveFieldValueSet = emitter.resolveFieldValueSet
    ? (modelName: string, fieldName: string, model: ContractModelBase) =>
        emitter.resolveFieldValueSet?.(modelName, fieldName, model, contract)
    : undefined;

  const namespaceModelsForFieldTypes = namespaceEntries.map(
    ([nsId, ns]) => [nsId, ns.models] as const,
  );

  const fieldTypesMaps = generateFieldTypesMapsByNamespace(
    namespaceModelsForFieldTypes,
    codecLookup,
    resolveFieldTypeParams,
    resolveFieldValueSet,
  );

  const extraTypeExports = emitter.getStorageTypeExports?.(contract, codecLookup);

  const contractWrapper = emitter.getContractWrapper('ContractBase', 'TypeMaps');

  const modelTypesBlock = generateModelTypesBlock(
    contract,
    { codecLookup, resolveFieldTypeParams, resolveFieldValueSet },
    options?.supportsNamespaces ?? true,
  );

  return `// ⚠️  GENERATED FILE - DO NOT EDIT
// This file is automatically generated by 'prisma contract emit'.
// To regenerate, run: prisma contract emit
${importLines.join('\n')}

${familyImportLines.join('\n')}
import type {
  Contract as ContractType,
  ExecutionHashBase,
  NamespaceId,
  ProfileHashBase,
  StorageHashBase,
} from '${resolveImportSpecifier('@internal/contract/types')}';

${hashAliases}

export type CodecTypes = ${codecTypes};
${familyTypeAliases}
${valueObjectTypeAliases}
export type FieldOutputTypes = ${fieldTypesMaps.output};
export type FieldInputTypes = ${fieldTypesMaps.input};
${extraTypeExports ? `${extraTypeExports}\n` : ''}
${modelTypesBlock}

export type TypeMaps = ${typeMapsExpr};

type ContractBase = Omit<
  ContractType<${storageType}>,
  'roots' | 'domain'
> & {
  readonly target: ${serializeValue(contract.target)};
  readonly targetFamily: ${serializeValue(contract.targetFamily)};
  readonly roots: ${rootsType};
  readonly domain: {
    readonly namespaces: {
${domainNamespacesType};
    };
  };
  readonly capabilities: ${serializeValue(contract.capabilities)};
  readonly extensions: ${serializeValue(contract.extensions)};${executionClause}
  readonly meta: ${serializeValue(contract.meta)};
  ${valueObjects ? `readonly valueObjects: ${valueObjectsDescriptor};` : ''}
  readonly profileHash: ProfileHash;
};

${contractWrapper}
`;
}
