import {
  type Contract,
  type ContractEnum,
  type ContractModelBase,
  valueObjectsWithCoordinates,
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
  fieldTypesMapExpression,
  generateCodecTypeIntersection,
  generateFieldTypeOverridesMap,
  generateHashTypeAliases,
  generateImportLines,
  generateModelsType,
  generateRootsType,
  generateValueObjectTypeAliases,
  parameterizedOutputTypeFunctionsAlias,
  renderValueLiteralType,
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

/**
 * Types each enum member as the value a query returns for it: the literal its codec renders for the stored form, or the codec's output type when the codec renders none.
 */
function generateEnumMemberTypesBlock(
  enums: Record<string, ContractEnum>,
  codecLookup: CodecLookup | undefined,
): string {
  const entries = Object.entries(enums).map(([name, entry]) => {
    const memberTupleItems = entry.members.map((m) => {
      const valueType =
        renderValueLiteralType(m.value, entry.codecId, 'output', codecLookup) ??
        `CodecTypes[${serializeValue(entry.codecId)}]["output"]`;
      return `{ readonly name: ${serializeValue(m.name)}; readonly value: ${valueType} }`;
    });
    return `readonly ${serializeObjectKey(name)}: readonly [${memberTupleItems.join(', ')}]`;
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
  if (options?.parameterizedOutputTypeImports) {
    allImports.push(...options.parameterizedOutputTypeImports);
  }
  const uniqueImports = deduplicateImports(allImports);

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

  const firstNamespaceOfValueObject = new Map<string, string>();
  for (const {
    coordinate: { namespaceId, entityName: name },
  } of valueObjectsWithCoordinates(contract.storage)) {
    if (!firstNamespaceOfValueObject.has(name)) firstNamespaceOfValueObject.set(name, namespaceId);
  }
  const valueObjectNamespaces = [...firstNamespaceOfValueObject];
  const hasValueObjects = valueObjectNamespaces.length > 0;
  const valueObjectTypeAliases = generateValueObjectTypeAliases(valueObjectNamespaces);

  // Per-namespace models and enum types for the domain.namespaces section.
  const perNamespaceTypes: Array<
    readonly [string, string, string | undefined, string | undefined]
  > = namespaceEntries.map(([nsId, ns]) => {
    const nsModels = ns.models;
    const nsModelsType = generateModelsType(nsModels, (name, model) =>
      emitter.generateModelStorageType(name, model),
    );
    const nsEnums = blindCast<
      Record<string, ContractEnum> | undefined,
      'ns.enum is an optional ContractEnum record in the emitted IR'
    >(ns.enum);
    const hasEnums = nsEnums !== undefined && Object.keys(nsEnums).length > 0;
    const nsEnumBlock = hasEnums ? generateEnumBlockType(nsEnums) : undefined;
    const nsEnumMemberTypesBlock = hasEnums
      ? generateEnumMemberTypesBlock(nsEnums, codecLookup)
      : undefined;
    return [nsId, nsModelsType, nsEnumBlock, nsEnumMemberTypesBlock] as const;
  });

  const domainNamespacesType = perNamespaceTypes
    .map(([nsId, nsModelsType, nsEnumBlock, nsEnumMemberTypesBlock]) => {
      const enumLine = nsEnumBlock !== undefined ? `\n        readonly enum: ${nsEnumBlock};` : '';
      const enumMemberTypesLine =
        nsEnumMemberTypesBlock !== undefined
          ? `\n        readonly enumMemberTypes?: ${nsEnumMemberTypesBlock};`
          : '';
      return `      readonly ${serializeObjectKey(nsId)}: {\n        readonly models: ${nsModelsType};${enumLine}${enumMemberTypesLine}\n      }`;
    })
    .join(';\n');

  const executionClause =
    contract.execution !== undefined
      ? `\n  readonly execution: ${serializeExecutionType(contract.execution)};`
      : '';

  const resolveStorageValueSet = emitter.resolveStorageValueSet
    ? (modelName: string, fieldName: string, model: ContractModelBase) =>
        emitter.resolveStorageValueSet?.(modelName, fieldName, model, contract)
    : undefined;

  const fieldTypeOverrides = generateFieldTypeOverridesMap(
    contract,
    codecLookup,
    resolveStorageValueSet,
  );

  const extraTypeExports = emitter.getStorageTypeExports?.(contract, codecLookup);

  const contractWrapper = emitter.getContractWrapper('ContractBase', 'TypeMaps');

  const modelTypesBlock = generateModelTypesBlock(contract, options?.supportsNamespaces ?? true);

  const parameterizedOutputTypesDeclaration = parameterizedOutputTypeFunctionsAlias(
    options?.parameterizedOutputTypeImports ?? [],
  );

  const body = `${hashAliases}

export type CodecTypes = ${codecTypes};
${familyTypeAliases}
${parameterizedOutputTypesDeclaration}
${valueObjectTypeAliases}
type FieldTypeOverrides = ${fieldTypeOverrides};
export type FieldOutputTypes = ${fieldTypesMapExpression('output')};
export type FieldInputTypes = ${fieldTypesMapExpression('input')};
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
  readonly profileHash: ProfileHash;
};

${contractWrapper}
`;

  const importLines = generateImportLines(
    uniqueImports.filter((spec) => mentions(body, spec.alias)),
    resolveImportSpecifier,
  );

  return `// ⚠️  GENERATED FILE - DO NOT EDIT
// This file is automatically generated by 'prisma contract emit'.
// To regenerate, run: prisma contract emit
${importLines.join('\n')}

${familyImportLines.join('\n')}
import type {
  Contract as ContractType,
  ExecutionHashBase,
  FieldTypesFromDomain,
  NamespaceId,
  ProfileHashBase,
  StorageHashBase,${hasValueObjects ? '\n  ValueObjectTypesFromStorage,' : ''}
} from '${resolveImportSpecifier('@internal/contract/types')}';

${body}`;
}

/** Whether `text` uses `identifier` as a whole identifier, not as part of a longer one. */
function mentions(text: string, identifier: string): boolean {
  const escaped = identifier.replace(/[$]/g, '\\$');
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(text);
}
