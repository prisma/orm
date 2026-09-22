export type {
  ParsedPslExtensionBlock,
  PslAttribute,
  PslAttributeArgument,
  PslAttributeNamedArgument,
  PslAttributePositionalArgument,
  PslAttributeTarget,
  PslCompositeType,
  PslDefaultFunctionValue,
  PslDefaultLiteralValue,
  PslDefaultValue,
  PslDiagnosticCode,
  PslDocumentAst,
  PslExtensionBlock,
  PslExtensionBlockAttribute,
  PslExtensionBlockAttributeArg,
  PslExtensionBlockParsedAttribute,
  PslExtensionBlockSourceEntry,
  PslField,
  PslFieldAttribute,
  PslModel,
  PslModelAttribute,
  PslNamedTypeDeclaration,
  PslNamespace,
  PslPosition,
  PslSpan,
  PslTypeConstructorCall,
  PslTypesBlock,
} from '@internal/framework-components/psl-ast';
export {
  flatPslModels,
  namespacePslExtensionBlocks,
} from '@internal/framework-components/psl-ast';
export { getPositionalArgument, parseQuotedStringLiteral } from '../attribute-helpers';
export type { AssembledAttributeSpecs } from '../attribute-spec/assemble';
export { assembleAttributeSpecs } from '../attribute-spec/assemble';
export { blockAttribute } from '../attribute-spec/block-attribute';
export { bool } from '../attribute-spec/combinators/bool';
export { leafDiagnostic } from '../attribute-spec/combinators/diagnostic';
export { entityRef } from '../attribute-spec/combinators/entity-ref';
export { fieldRef, referencedFieldRef } from '../attribute-spec/combinators/field-ref';
export { funcCall } from '../attribute-spec/combinators/func-call';
export { identifier } from '../attribute-spec/combinators/identifier';
export { int } from '../attribute-spec/combinators/int';
export { json } from '../attribute-spec/combinators/json';
export { jsonValue } from '../attribute-spec/combinators/json-value';
export type { ListOptions } from '../attribute-spec/combinators/list';
export { list } from '../attribute-spec/combinators/list';
export { num } from '../attribute-spec/combinators/num';
export { numLiteral } from '../attribute-spec/combinators/num-literal';
export { oneOf } from '../attribute-spec/combinators/one-of';
export { record } from '../attribute-spec/combinators/record';
export { str } from '../attribute-spec/combinators/str';
export { taggedLiteral } from '../attribute-spec/combinators/tagged-literal';
export { fieldAttribute } from '../attribute-spec/field-attribute';
export type { ArgBindingSpec } from '../attribute-spec/interpret';
export { interpretArgs, interpretAttribute } from '../attribute-spec/interpret';
export { modelAttribute } from '../attribute-spec/model-attribute';
export { optional } from '../attribute-spec/optional';
export type {
  AttributeSpecContext,
  AttributeSpecNamespace,
  BlockAttributeSpecFactory,
  FieldAttributeSpecContext,
  FieldAttributeSpecFactory,
  ModelAttributeSpecFactory,
} from '../attribute-spec/spec-context';
export type {
  ArgType,
  ArgTypeKind,
  AttributeCtx,
  AttributeLevel,
  AttributeOut,
  AttributeSpec,
  EntityRefArgType,
  FieldAttributeCtx,
  FixedIdentifierArgType,
  FuncCallSig,
  IdentifierArgType,
  InferAttr,
  InspectableArgType,
  JsonValueArgType,
  ModelAttributeCtx,
  NamedOut,
  NumLiteral,
  OptionalArgType,
  OutOf,
  Param,
  ParsedTaggedLiteral,
  PositionalParam,
  PosOut,
  RejectingArgType,
  TaggedLiteralArgType,
  TypedFuncCall,
  UnrestrictedIdentifierArgType,
} from '../attribute-spec/types';
export type {
  AttributeSymbol,
  Binder,
  BinderResult,
  BoundSpec,
  CreateBinderOptions,
  DescribeUnsupportedAttribute,
  PslSymbol,
  Resolution,
  UnsupportedAttribute,
} from '../binder';
export {
  createBinder,
  PSL_UNRESOLVED_REFERENCE,
} from '../binder';
export { entriesBlock, fixedBlock } from '../block-spec/binders';
export { deriveParsedBlocks } from '../block-spec/derive';
export type { PslBlockSpecDescriptor } from '../block-spec/descriptor';
export { blockSpecFactoryOf } from '../block-spec/descriptor';
export type {
  InterpretExtensionBlockAttributesInput,
  InterpretExtensionBlockInput,
} from '../block-spec/interpret';
export {
  interpretExtensionBlock,
  interpretExtensionBlockAttributes,
} from '../block-spec/interpret';
export type {
  BlockEntryValueSpec,
  BlockSpec,
  BlockSpecContext,
  BlockSpecFactory,
  EntriesBlockSpec,
  FixedBlockSpec,
  InferBlock,
} from '../block-spec/types';
export type {
  ContributedMember,
  ContributedNamespaceSymbol,
  ContributedTypeScope,
  ContributedTypeSymbol,
} from '../contributed-type-scope';
export type { DiagnosticSource, PslDiagnostic, PslDiagnosticCollector } from '../diagnostic';
export {
  createPslDiagnosticCollector,
  diagnosticFromSpan,
  diagnosticSource,
  mapPslDiagnostics,
} from '../diagnostic';
export type {
  DeclarationFor,
  EntityDeclaration,
  EntitySelector,
  ResolvedEntityReference,
} from '../entity-reference';
export { findBlockDescriptor } from '../extension-block';
export {
  keywordPslSpan,
  nodePslSpan,
  readResolvedAttribute,
  readResolvedAttributes,
  readResolvedConstructorCall,
} from '../resolve';
export { isPrismaNextSchema, renameLegacyDirective } from '../schema-directive';
export type { Scope, ScopeResolution } from '../scope';
export type {
  BlockSymbol,
  BuildSymbolTableOptions,
  CompositeTypeSymbol,
  FieldSymbol,
  ModelSymbol,
  NamedTypeSymbol,
  NamespaceSymbol,
  ResolvedAttribute,
  ResolvedAttributeArg,
  ResolvedNamedTypeBinding,
  ResolvedTypeConstructorCall,
  SymbolTable,
  SymbolTableResult,
  TopLevelScope,
} from '../symbol-table';
export { buildSymbolTable } from '../symbol-table';
