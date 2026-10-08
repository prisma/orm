/**
 * Codec model: interfaces (consumer surface) plus abstract `Impl` classes (codec-author surface) plus the column packager.
 *
 * Consumers depend on the interfaces: {@link Codec}, {@link CodecDescriptor}, {@link AnyCodecDescriptor}, {@link ColumnSpec}, {@link ColumnTypeDescriptor}.
 *
 * Codec authors `extend` the abstract bases: {@link CodecImpl} and {@link CodecDescriptorImpl}. They write a per-codec column helper that calls `descriptor.factory(...)` directly and tie the helper to its descriptor with `satisfies ColumnHelperFor<D>` (or `ColumnHelperForStrict<D>`).
 */

export type { Codec } from '../shared/codec';
export { CodecImpl, readContractValue } from '../shared/codec';
export type {
  AnyCodecDescriptor,
  AnyCodecDescriptorTemplate,
  CodecDescriptor,
  CodecDescriptorTemplate,
} from '../shared/codec-descriptor';
export {
  CodecDescriptorImpl,
  CodecDescriptorTemplateImpl,
  canonicalFormOf,
  enumRefusalOf,
} from '../shared/codec-descriptor';
export type {
  CodecCallContext,
  CodecInstanceContext,
  CodecLookup,
  CodecLookupWithDescriptors,
  CodecRef,
  CodecRegistry,
  CodecTrait,
} from '../shared/codec-types';
export { emptyCodecLookup } from '../shared/codec-types';
export type {
  CodecDescriptorRef,
  ColumnHelperFor,
  ColumnHelperForStrict,
  ColumnSpec,
  ColumnTypeDescriptor,
  ScalarFieldDeclaration,
  ScalarFieldDeclarationBuilder,
} from '../shared/column-spec';
export { column } from '../shared/column-spec';
export type {
  Cast,
  DataType,
  DataTypeId,
  DataTypeLookup,
  DataTypeParams,
  DataTypeReader,
  DataTypeSpec,
  DataTypeSpelling,
  DataTypeValue,
  ListCast,
  ToCanonicalForm,
} from '../shared/data-type';
export {
  assembleDataTypes,
  createDataTypeLookup,
  DATA_TYPE_ID_PATTERN,
  dataType,
  dataTypeId,
  dataTypeParamsOf,
  dataTypeValueFor,
  dataTypeValuesEqual,
  objectSchemaKeys,
  requiredParamKeys,
  requiredSchemaKeys,
} from '../shared/data-type';
export type { BigIntRange, IntegerRange } from '../shared/json-readers';
export {
  floatToJson,
  INT32_RANGE,
  INT64_RANGE,
  isIntegerIn,
  isNonFiniteText,
  readJsonBoolean,
  readJsonFloat,
  readJsonInteger,
  readJsonIntegerText,
  readJsonMatching,
  readJsonString,
  refuseJsonValue,
  SAFE_INTEGER_BIGINT_RANGE,
  SAFE_INTEGER_RANGE,
} from '../shared/json-readers';
export { renderTsLiteral } from '../shared/render-ts-literal';
export {
  CONTRACT_CODEC_DESCRIPTOR_MISSING,
  codecForRef,
  materializeCodec,
  resolveCodecDescriptorOrThrow,
  validateCodecTypeParams,
} from '../shared/resolve-codec';
