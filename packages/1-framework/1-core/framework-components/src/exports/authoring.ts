export type {
  AuthoringTypeConstructorCall,
  AuthoringTypeConstructorOutput,
} from '../shared/authoring-type-constructor-call';
export {
  authoringTypeConstructorArguments,
  authoringTypeConstructors,
  findAuthoringTypeConstructorCall,
} from '../shared/authoring-type-constructor-call';
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
export {
  assembleFieldPresetsByCodecAndGenerator,
  type FieldPresetPhasePrintForm,
  type FieldPresetPrintForm,
  type FieldPresetsByCodecAndGenerator,
  fieldPresetPrintForm,
  type PrintableFieldPreset,
} from '../shared/field-preset-print-form';
export {
  fieldPresetSpellings,
  getAuthoringFieldPreset,
} from '../shared/field-preset-resolution';
export type {
  AuthoringArgRef,
  AuthoringArgumentDescriptor,
  AuthoringAttributeSpecContributions,
  AuthoringColumnDefaultTemplate,
  AuthoringContributions,
  AuthoringDiagnosticSink,
  AuthoringEntityContext,
  AuthoringEntityTypeDescriptor,
  AuthoringEntityTypeFactoryOutput,
  AuthoringEntityTypeNamespace,
  AuthoringEntityTypeTemplateOutput,
  AuthoringFieldNamespace,
  AuthoringFieldPresetDescriptor,
  AuthoringFieldPresetOutput,
  AuthoringModelAttributeContext,
  AuthoringModelAttributeDescriptor,
  AuthoringModelAttributeDescriptorNamespace,
  AuthoringModelAttributeEntityOutput,
  AuthoringModelAttributeIndexOutput,
  AuthoringModelAttributeLoweringOutput,
  AuthoringPslBlockDescriptor,
  AuthoringPslBlockDescriptorNamespace,
  AuthoringSelectRef,
  AuthoringStorageTypeTemplate,
  AuthoringTemplateValue,
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeConstructorEntityRef,
  AuthoringTypeNamespace,
  AuthoringWarning,
  AuthoringWarningSink,
  DataTypeAuthoringEntry,
  DataTypeWrittenForm,
  ScalarTypeConstructorOutput,
} from '../shared/framework-authoring';
export {
  assertNoCrossRegistryCollisions,
  assertResolvableTypeConstructorTemplates,
  authoringEntryType,
  classifyEnumMemberType,
  collectScalarTypeConstructors,
  flushAuthoringWarnings,
  getAuthoringTypeConstructor,
  instantiateAuthoringEntityType,
  instantiateAuthoringFieldPreset,
  instantiateAuthoringTypeConstructor,
  isAuthoringArgRef,
  isAuthoringEntityTypeDescriptor,
  isAuthoringFieldPresetDescriptor,
  isAuthoringModelAttributeDescriptor,
  isAuthoringPslBlockDescriptor,
  isAuthoringSelectRef,
  isAuthoringTypeConstructorDescriptor,
  isTagEntryKey,
  mergeAuthoringNamespaces,
  resolveAuthoringTemplateValue,
  resolveEnumCodecId,
  tagEntryKey,
  validateAuthoringHelperArguments,
  validateAuthoringTypeParams,
} from '../shared/framework-authoring';
export type { AuthoringOption } from '../shared/option-descriptor';
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
export type { PresetStorageTemplate } from '../shared/temporal-presets';
export {
  TEMPORAL_ON_CREATE_ARG,
  TEMPORAL_ON_UPDATE_ARG,
  TIMESTAMP_NOW_GENERATOR_ID,
  temporalAuthoringPresets,
  temporalCodecPreset,
  temporalPhaseTemplate,
  temporalPhaseTemplateWithParams,
} from '../shared/temporal-presets';
export type {
  CastRefusal,
  DataTypeSupport,
  ReadRefusal,
  RefusalDescription,
  RefusalGuidance,
  TypedValue,
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
  tagForm,
} from '../shared/written-value';
