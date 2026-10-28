export type {
  AuthoringTypeConstructorCall,
  AuthoringTypeConstructorOutput,
} from '../shared/authoring-type-constructor-call';
export {
  authoringTypeConstructorArguments,
  authoringTypeConstructors,
  findAuthoringTypeConstructorCall,
} from '../shared/authoring-type-constructor-call';
export type {
  AssembledDataTypeSupport,
  DataTypeComponent,
} from '../shared/data-type-support';
export {
  assembleAuthoringDataTypes,
  assembleDataTypeSupport,
} from '../shared/data-type-support';
export type {
  DiscriminatorDecision,
  DiscriminatorField,
  DiscriminatorFieldRefusal,
  DiscriminatorRefusal,
  DiscriminatorVariantRefusal,
} from '../shared/discriminator-rule';
export {
  applyDiscriminatorRule,
  describeDiscriminatorRefusal,
} from '../shared/discriminator-rule';
export {
  type EnumBlockDiagnostic,
  type EnumBlockMember,
  type EnumBlockSite,
  enumMemberProblemDiagnostic,
  readEnumBlockMembers,
} from '../shared/enum-block-members';
export {
  type DecodedEnum,
  type EncodedEnumMember,
  type EnumMemberProblem,
  encodeEnumMembers,
} from '../shared/enum-members';
export {
  type DuplicateStoredValue,
  duplicateStoredMembers,
  type StoredEnumMember,
} from '../shared/enum-stored-members';
export type {
  AuthoringArgRef,
  AuthoringArgumentDescriptor,
  AuthoringAttributeSpecContributions,
  AuthoringContributions,
  AuthoringDescriptorKinds,
  AuthoringDiagnosticSink,
  AuthoringEntityContext,
  AuthoringEntityTypeDescriptor,
  AuthoringEntityTypeFactoryOutput,
  AuthoringEntityTypeNamespace,
  AuthoringEntityTypeTemplateOutput,
  AuthoringModelAttributeContext,
  AuthoringModelAttributeDescriptor,
  AuthoringModelAttributeDescriptorNamespace,
  AuthoringModelAttributeEntityOutput,
  AuthoringModelAttributeIndexOutput,
  AuthoringModelAttributeLoweringOutput,
  AuthoringPslBlockDescriptor,
  AuthoringPslBlockDescriptorNamespace,
  AuthoringStorageTypeTemplate,
  AuthoringTemplateValue,
  AuthoringTypeAliasDescriptor,
  AuthoringTypeAliasOutput,
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeConstructorEntityRef,
  AuthoringTypeNamespace,
  AuthoringTypeParamsIssue,
  AuthoringWarning,
  AuthoringWarningSink,
  DataTypeAuthoringEntry,
  DataTypeWrittenForm,
  ScalarTypeConstructorOutput,
} from '../shared/framework-authoring';
export {
  AUTHORING_TYPE_DESCRIPTOR_KINDS,
  assertNoAuthoringFieldNamespace,
  assertNoCrossRegistryCollisions,
  assertResolvableTypeConstructorTemplates,
  assertTypeAliasesValid,
  classifyEnumMemberType,
  collectScalarTypeConstructors,
  flushAuthoringWarnings,
  getAuthoringTypeConstructor,
  instantiateAuthoringEntityType,
  instantiateAuthoringTypeAlias,
  instantiateAuthoringTypeConstructor,
  instantiateAuthoringTypeConstructorFromValues,
  isAuthoringArgRef,
  isAuthoringEntityTypeDescriptor,
  isAuthoringModelAttributeDescriptor,
  isAuthoringPslBlockDescriptor,
  isAuthoringTypeAliasDescriptor,
  isAuthoringTypeConstructorDescriptor,
  isAuthoringTypeDescriptor,
  mergeAuthoringNamespaces,
  resolveAuthoringTemplateValue,
  resolveEnumCodecId,
  resolveTypeAliasGenerators,
  validateAuthoringHelperArguments,
  validateAuthoringTypeParams,
} from '../shared/framework-authoring';
export type {
  ParsedPslExtensionBlock,
  PslExtensionBlock,
  PslExtensionBlockParsedAttribute,
  PslExtensionBlockPrintEntry,
} from '../shared/psl-extension-block';
export type { TaggedLiteralCanonicalization } from '../shared/tagged-literal';
export {
  canonicalizeTaggedLiteralBody,
  describeTaggedLiteralFailure,
  printedTaggedLiteralReadsBack,
  printTaggedLiteral,
  resolveTemplateTagEscapes,
  tsTaggedTemplateSource,
} from '../shared/tagged-literal';
export {
  TIMESTAMP_NOW_GENERATOR_ID,
  temporalTypeAliases,
} from '../shared/temporal-type-aliases';
export type {
  CastRefusal,
  DataTypeSupport,
  ReadRefusal,
  RefusalDescription,
  RefusalGuidance,
  WrittenForm,
  WrittenScalar,
  WrittenValue,
} from '../shared/written-value';
export {
  admittedForms,
  admittedTags,
  castTypedValue,
  describeAdmittedForms,
  describeExpected,
  describeRefusal,
  describeRefusedValueType,
  entryForPlain,
  entryForTag,
  exactRewrite,
  knownTags,
  readWrittenValue,
  readWrittenValueAs,
  readWrittenValueIntoCodec,
  tagForm,
} from '../shared/written-value';
