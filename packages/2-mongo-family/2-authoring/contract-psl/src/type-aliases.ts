import type {
  ContractField,
  ExecutionMutationDefaultPhases,
  ExecutionMutationDefaultValue,
  ValueSetRef,
} from '@internal/contract/types';
import {
  type AuthoringTypeConstructorDescriptor,
  type AuthoringTypeNamespace,
  type DataTypeSupport,
  instantiateAuthoringTypeAlias,
  instantiateAuthoringTypeConstructor,
  resolveTypeAliasGenerators,
} from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import type { GeneratorFunctionRegistry } from '@internal/framework-components/components';
import type { ControlMutationDefaultRegistry } from '@internal/framework-components/control';
import {
  type Binder,
  type ContributedTypeAlias,
  contributedTypeAliasOf,
  diagnosticSource,
  interpretAttribute,
  type NamedTypeSymbol,
  type PslDiagnosticCollector,
  type Resolution,
  type ResolvedAttribute,
  type ResolvedTypeConstructorCall,
  resolveTypeAliases,
  type SymbolTable,
  type TypeAlias,
  type TypeAttributeSpecContext,
  typeAliasSpecContext,
  typeAttributeSubjectLabel,
  typeGeneratorAttributeSpec,
} from '@internal/psl-parser';
import { instantiatePslTypeChoice } from '@internal/psl-parser/interpret';
import type { FieldAttributeAst, PslSources } from '@internal/psl-parser/syntax';
import { ifDefined } from '@internal/utils/defined';
import { unloweredAttributeHint } from './mongo-attribute-specs';

type ScalarFieldType = Extract<ContractField['type'], { readonly kind: 'scalar' }>;

/** The field type a use of a type choice gives: the column of the constructor its call chooses, read and refused as a SQL column's is. `undefined`, with a diagnostic pushed, when the call is refused. */
export function scalarTypeOfChoice(
  input: Parameters<typeof instantiatePslTypeChoice>[0],
): ScalarFieldType | undefined {
  const output = instantiatePslTypeChoice(input);
  return output === undefined
    ? undefined
    : { kind: 'scalar', codecId: output.codecId, ...ifDefined('typeParams', output.typeParams) };
}

/** The field type a type constructor gives, keeping a bare constructor's fixed type params. */
export function scalarTypeOfConstructor(
  descriptor: AuthoringTypeConstructorDescriptor,
  call: ResolvedTypeConstructorCall | undefined,
): ScalarFieldType {
  if (call !== undefined) return { kind: 'scalar', codecId: descriptor.output.codecId };
  const { codecId, typeParams } = instantiateAuthoringTypeConstructor(descriptor, []);
  return { kind: 'scalar', codecId, ...ifDefined('typeParams', typeParams) };
}

/** A type alias resolved once: the field type it gives each field typed by it, and the values it generates for them. */
export interface ResolvedTypeAlias {
  readonly alias: TypeAlias | ContributedTypeAlias;
  /** As a field writes it, such as `Stamp` or `temporal.UpdatedAt`. */
  readonly name: string;
  readonly type: ScalarFieldType;
  readonly valueSet: ValueSetRef | undefined;
  readonly executionDefaults: ExecutionMutationDefaultPhases | undefined;
}

/** The type aliases of a document: those its `types {}` block declares, and those the stack contributes. */
export interface ResolvedTypeAliases {
  /** The alias a field's type resolves to, if it resolves to one that resolved without error. */
  ofResolution(resolution: Resolution | undefined): ResolvedTypeAlias | undefined;
}

interface ResolveMongoTypeAliasesInput {
  readonly declarations: readonly NamedTypeSymbol[];
  readonly symbols: SymbolTable;
  readonly binder: Binder;
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
  readonly codecIdByEnumName: ReadonlyMap<string, string>;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly dataTypes: DataTypeSupport;
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly authoringTypes: AuthoringTypeNamespace | undefined;
}

const GENERATOR_PHASES = ['onCreate', 'onUpdate'] as const;

const MONGO_TYPE_ALIAS_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set(GENERATOR_PHASES);

function describeUnsupportedMongoAliasAttribute(
  attribute: ResolvedAttribute<FieldAttributeAst>,
  declaration: NamedTypeSymbol,
): string | undefined {
  if (attribute.name !== 'default') return undefined;
  const base = `Type alias "${declaration.name}" uses unsupported attribute "@default"`;
  const hint = unloweredAttributeHint(attribute);
  return hint === undefined ? base : `${base}. ${hint}`;
}

/**
 * The generator a field's or type alias's `@onCreate(fn())` or `@onUpdate(fn())` resolves to for its type, or `undefined` once the attribute is diagnosed.
 */
export function lowerGeneratorAttribute(input: {
  readonly phase: (typeof GENERATOR_PHASES)[number];
  readonly attribute: ResolvedAttribute<FieldAttributeAst>;
  readonly specContext: TypeAttributeSpecContext;
  readonly type: ContractField['type'];
  readonly symbols: SymbolTable;
  readonly binder: Binder;
  readonly sources: PslSources;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly diagnostics: PslDiagnosticCollector;
}): ExecutionMutationDefaultValue | undefined {
  const interpreted = interpretAttribute(
    input.attribute.node,
    typeGeneratorAttributeSpec(input.phase, input.specContext),
    { sources: input.sources, symbols: input.symbols, binder: input.binder },
  );
  if (!interpreted.ok) {
    input.diagnostics.push(...interpreted.failure);
    return undefined;
  }
  const call = interpreted.value.value;
  const { type } = input;
  const resolution =
    type.kind === 'scalar'
      ? input.generatorFunctions.resolve(
          { name: call.fn, args: call.args },
          { codecId: type.codecId, typeParams: type.typeParams, length: undefined },
        )
      : undefined;
  if (resolution?.ok === true) return resolution.generator;
  const label = typeAttributeSubjectLabel(input.specContext.subject);
  input.diagnostics.push({
    code: 'PSL_GENERATOR_NOT_APPLICABLE',
    message:
      resolution?.reason === 'refused'
        ? `${label}: ${resolution.message}`
        : `${label}: ${call.fn}() does not apply to this field's type.`,
    ...diagnosticSource(input.sources, input.attribute.node.syntax).at(call.span),
  });
  return undefined;
}

function aliasType(
  alias: TypeAlias,
  input: ResolveMongoTypeAliasesInput,
): Pick<ResolvedTypeAlias, 'type' | 'valueSet'> | undefined {
  const { base, symbol } = alias;
  if (base.kind === 'typeConstructor') {
    return { type: scalarTypeOfConstructor(base.descriptor, base.call), valueSet: undefined };
  }
  if (base.kind === 'typeChoice') {
    const type = scalarTypeOfChoice({
      symbol: base.symbol,
      call: base.call,
      span: symbol.span,
      codecLookup: input.codecLookup,
      diagnostics: input.diagnostics,
      source: diagnosticSource(input.sources, symbol.node.syntax),
      entityLabel: `Type alias "${symbol.name}"`,
      dataTypes: input.dataTypes,
    });
    return type === undefined ? undefined : { type, valueSet: undefined };
  }
  if (base.symbol.keyword !== 'enum') {
    input.diagnostics.push({
      code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
      message: `Type alias "${symbol.name}" references unsupported base type "${alias.baseName}"`,
      ...diagnosticSource(input.sources, symbol.node.syntax).at(symbol.span),
    });
    return undefined;
  }
  const codecId = input.codecIdByEnumName.get(base.symbol.name);
  if (codecId === undefined || alias.baseResolution.kind !== 'block') return undefined;
  return {
    type: { kind: 'scalar', codecId },
    valueSet: {
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: alias.baseResolution.namespace.id,
      entityName: base.symbol.name,
    },
  };
}

function lowerAliasGenerators(
  alias: TypeAlias,
  type: ScalarFieldType,
  input: ResolveMongoTypeAliasesInput,
): ExecutionMutationDefaultPhases | undefined {
  const specContext = typeAliasSpecContext(alias, input);
  const phases: {
    onCreate?: ExecutionMutationDefaultValue;
    onUpdate?: ExecutionMutationDefaultValue;
  } = {};
  for (const phase of GENERATOR_PHASES) {
    const [attribute, duplicate] = alias.attributes.filter(({ name }) => name === phase);
    if (attribute === undefined) continue;
    if (duplicate !== undefined) {
      input.diagnostics.push({
        code: 'PSL_DUPLICATE_ATTRIBUTE',
        message: `\`@${phase}\` declared more than once on type alias "${alias.symbol.name}".`,
        ...diagnosticSource(input.sources, duplicate.node.syntax).at(duplicate.span),
      });
      continue;
    }
    const generator = lowerGeneratorAttribute({ ...input, phase, attribute, specContext, type });
    if (generator !== undefined) phases[phase] = generator;
  }
  return phases.onCreate === undefined && phases.onUpdate === undefined ? undefined : phases;
}

function resolveContributedTypeAlias(
  alias: ContributedTypeAlias,
  generatorFunctions: GeneratorFunctionRegistry,
): ResolvedTypeAlias {
  const { type } = instantiateAuthoringTypeAlias(alias.descriptor);
  return {
    alias,
    name: alias.name,
    type: { kind: 'scalar', codecId: type.codecId, ...ifDefined('typeParams', type.typeParams) },
    valueSet: undefined,
    executionDefaults: resolveTypeAliasGenerators({
      path: alias.name,
      descriptor: alias.descriptor,
      generatorFunctions,
      length: undefined,
    }),
  };
}

/**
 * Resolves each `types {}` alias once: its field type and the values its `@onCreate` and `@onUpdate` generate. MongoDB has no database defaults, so an alias's `@default` is refused here, once, not at each field typed by it.
 */
export function resolveMongoTypeAliases(input: ResolveMongoTypeAliasesInput): ResolvedTypeAliases {
  const declared = new Map<NamedTypeSymbol, ResolvedTypeAlias>();
  const aliases = resolveTypeAliases({
    declarations: input.declarations,
    binder: input.binder,
    sources: input.sources,
    diagnostics: input.diagnostics,
    authoringTypes: input.authoringTypes,
    acceptedAttributes: MONGO_TYPE_ALIAS_ATTRIBUTE_NAMES,
    describeUnsupportedAttribute: describeUnsupportedMongoAliasAttribute,
  });
  for (const alias of aliases.values()) {
    const resolved = aliasType(alias, input);
    if (resolved === undefined) continue;
    declared.set(alias.symbol, {
      alias,
      name: alias.symbol.name,
      ...resolved,
      executionDefaults: lowerAliasGenerators(alias, resolved.type, input),
    });
  }
  const contributed = new Map<ContributedTypeAlias['descriptor'], ResolvedTypeAlias>();
  return {
    ofResolution(resolution) {
      if (resolution?.kind === 'namedType') return declared.get(resolution.symbol);
      const alias = contributedTypeAliasOf(resolution);
      if (alias === undefined) return undefined;
      const existing = contributed.get(alias.descriptor);
      if (existing !== undefined) return existing;
      const resolved = resolveContributedTypeAlias(alias, input.generatorFunctions);
      contributed.set(alias.descriptor, resolved);
      return resolved;
    },
  };
}
