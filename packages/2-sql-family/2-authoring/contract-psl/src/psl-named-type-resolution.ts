import type { ExecutionMutationDefaultPhases } from '@internal/contract/types';
import {
  type AuthoringTypeNamespace,
  type DataTypeSupport,
  instantiateAuthoringTypeAlias,
  instantiateAuthoringTypeConstructor,
  resolveTypeAliasGenerators,
} from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import type { GeneratorFunctionRegistry } from '@internal/framework-components/components';
import type { ControlMutationDefaultRegistry } from '@internal/framework-components/control';
import type {
  Binder,
  BlockSymbol,
  ContributedTypeAlias,
  NamedTypeSymbol,
  PslDiagnosticCollector,
  Resolution,
  ResolvedAttribute,
  SymbolTable,
  TypeAlias,
} from '@internal/psl-parser';
import {
  contributedTypeAliasOf,
  diagnosticSource,
  resolveTypeAliases,
  typeAliasSpecContext,
} from '@internal/psl-parser';
import { instantiatePslTypeChoice } from '@internal/psl-parser/interpret';
import type { FieldAttributeAst, PslSources } from '@internal/psl-parser/syntax';
import { sqlCodecColumnLength } from '@internal/sql-contract/data-type';
import type {
  AuthoredColumnDefault,
  EnumTypeHandle,
} from '@internal/sql-contract-ts/contract-builder';
import { formatDbAttributeMigrationMessage } from './psl-attribute-parsing';
import {
  type ColumnDescriptor,
  instantiatePslTypeConstructor,
  lowerEnumDefault,
  lowerTypeDefault,
  lowerTypeGenerators,
  type TypeAttributeOwner,
} from './psl-column-resolution';

/** A type alias resolved once: the column it gives each field typed by it, and the default and generators that column takes. */
export interface ResolvedTypeAlias {
  readonly alias: TypeAlias | ContributedTypeAlias;
  /** As a field writes it, such as `Slug` or `temporal.CreatedAt`. */
  readonly name: string;
  /** The attributes written on a `types {}` alias; none for a contributed one. */
  readonly attributes: readonly ResolvedAttribute<FieldAttributeAst>[];
  readonly descriptor: ColumnDescriptor;
  readonly enumHandle: EnumTypeHandle | undefined;
  readonly defaultValue: AuthoredColumnDefault | undefined;
  readonly executionDefaults: ExecutionMutationDefaultPhases | undefined;
}

/** The type aliases of a document: those its `types {}` block declares, and those the stack contributes. */
export interface ResolvedTypeAliases {
  get(symbol: NamedTypeSymbol): ResolvedTypeAlias | undefined;
  /** The alias a type reference resolves to, if it resolves to one. */
  ofResolution(resolution: Resolution | undefined): ResolvedTypeAlias | undefined;
}

export interface ResolveNamedTypeDeclarationsInput {
  readonly declarations: readonly NamedTypeSymbol[];
  readonly sources: PslSources;
  readonly symbolTable: SymbolTable;
  readonly binder: Binder;
  readonly enumTypeDescriptors: ReadonlyMap<BlockSymbol, ColumnDescriptor>;
  readonly enumHandles: ReadonlyMap<BlockSymbol, EnumTypeHandle>;
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly dataTypes: DataTypeSupport;
  readonly diagnostics: PslDiagnosticCollector;
  readonly authoringTypes: AuthoringTypeNamespace | undefined;
}

function describeUnsupportedSqlAliasAttribute(
  attribute: ResolvedAttribute<FieldAttributeAst>,
): string | undefined {
  return attribute.name.startsWith('db.')
    ? formatDbAttributeMigrationMessage(attribute)
    : undefined;
}

function aliasDescriptor(
  alias: TypeAlias,
  input: ResolveNamedTypeDeclarationsInput,
): ColumnDescriptor | undefined {
  const { base, symbol } = alias;
  const source = diagnosticSource(input.sources, symbol.node.syntax);
  if (base.kind === 'typeChoice') {
    return instantiatePslTypeChoice({
      symbol: base.symbol,
      call: base.call,
      span: symbol.span,
      codecLookup: input.codecLookup,
      diagnostics: input.diagnostics,
      source,
      entityLabel: `Type alias "${symbol.name}"`,
      dataTypes: input.dataTypes,
    });
  }
  if (base.kind === 'typeConstructor') {
    if (base.call === undefined) return instantiateAuthoringTypeConstructor(base.descriptor, []);
    return instantiatePslTypeConstructor({
      call: base.call,
      descriptor: base.descriptor,
      codecLookup: input.codecLookup,
      diagnostics: input.diagnostics,
      source,
      entityLabel: `Type alias "${symbol.name}"`,
      dataTypes: input.dataTypes,
    });
  }
  const descriptor = input.enumTypeDescriptors.get(base.symbol);
  if (descriptor === undefined) {
    input.diagnostics.push({
      code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
      message: `Type alias "${symbol.name}" references unsupported base type "${alias.baseName}"`,
      ...source.at(symbol.span),
    });
  }
  return descriptor;
}

/**
 * Resolves each `types {}` alias once: its column type, with the params inline, and its `@default`, `@onCreate` and `@onUpdate`, lowered for that column. A diagnostic about the alias is reported here, once, not at each field typed by it.
 */
export function resolveNamedTypeDeclarations(
  input: ResolveNamedTypeDeclarationsInput,
): ResolvedTypeAliases {
  const declared = resolveDeclaredTypeAliases(input);
  const contributed = new Map<ContributedTypeAlias['descriptor'], ResolvedTypeAlias>();
  const resolveContributed = (alias: ContributedTypeAlias): ResolvedTypeAlias => {
    const existing = contributed.get(alias.descriptor);
    if (existing !== undefined) return existing;
    const resolved = resolveContributedTypeAlias(alias, input);
    contributed.set(alias.descriptor, resolved);
    return resolved;
  };
  return {
    get: (symbol) => declared.get(symbol),
    ofResolution(resolution) {
      if (resolution?.kind === 'namedType') return declared.get(resolution.symbol);
      const alias = contributedTypeAliasOf(resolution);
      return alias === undefined ? undefined : resolveContributed(alias);
    },
  };
}

function resolveContributedTypeAlias(
  alias: ContributedTypeAlias,
  input: ResolveNamedTypeDeclarationsInput,
): ResolvedTypeAlias {
  const { type: descriptor } = instantiateAuthoringTypeAlias(alias.descriptor);
  const executionDefaults = resolveTypeAliasGenerators({
    path: alias.name,
    descriptor: alias.descriptor,
    generatorFunctions: input.generatorFunctions,
    length: sqlCodecColumnLength(input.dataTypes, descriptor.codecId, descriptor.typeParams),
  });
  return {
    alias,
    name: alias.name,
    attributes: [],
    descriptor,
    enumHandle: undefined,
    defaultValue: undefined,
    executionDefaults,
  };
}

function resolveDeclaredTypeAliases(
  input: ResolveNamedTypeDeclarationsInput,
): Map<NamedTypeSymbol, ResolvedTypeAlias> {
  const aliases = resolveTypeAliases({
    declarations: input.declarations,
    binder: input.binder,
    sources: input.sources,
    diagnostics: input.diagnostics,
    authoringTypes: input.authoringTypes,
    describeUnsupportedAttribute: describeUnsupportedSqlAliasAttribute,
  });
  const resolved = new Map<NamedTypeSymbol, ResolvedTypeAlias>();
  for (const alias of aliases.values()) {
    const descriptor = aliasDescriptor(alias, input);
    if (descriptor === undefined) continue;
    const owner: TypeAttributeOwner = {
      attributes: alias.attributes,
      optional: false,
      list: false,
      elementOptional: false,
      specContext: typeAliasSpecContext(alias, { ...input, symbols: input.symbolTable }),
      loweringNames: { modelName: 'types', fieldName: alias.symbol.name },
    };
    const enumHandle =
      alias.base.kind === 'block' ? input.enumHandles.get(alias.base.symbol) : undefined;
    const lowering = { ...input, owner };
    const { defaultValue } =
      enumHandle === undefined
        ? lowerTypeDefault({
            ...lowering,
            columnDescriptor: descriptor,
            columnTypeParams: descriptor.typeParams,
            isListColumn: false,
            valueObjectDefault: undefined,
          })
        : lowerEnumDefault({ ...lowering, enumHandle });
    const executionDefaults = lowerTypeGenerators({
      ...lowering,
      columnDescriptor: descriptor,
      columnTypeParams: descriptor.typeParams,
    });
    resolved.set(alias.symbol, {
      alias,
      name: alias.symbol.name,
      attributes: alias.attributes,
      descriptor,
      enumHandle,
      defaultValue,
      executionDefaults,
    });
  }
  return resolved;
}
