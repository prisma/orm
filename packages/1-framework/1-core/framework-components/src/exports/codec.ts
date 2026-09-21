/**
 * Codec model: interfaces (consumer surface) plus abstract `Impl` classes (codec-author surface) plus the column packager.
 *
 * Consumers depend on the interfaces: {@link Codec}, {@link CodecDescriptor}, {@link AnyCodecDescriptor}, {@link ColumnSpec}, {@link ColumnTypeDescriptor}.
 *
 * Codec authors `extend` the abstract bases: {@link CodecImpl} and {@link CodecDescriptorImpl}. They write a per-codec column helper that calls `descriptor.factory(...)` directly and tie the helper to its descriptor with `satisfies ColumnHelperFor<D>` (or `ColumnHelperForStrict<D>`).
 */

export type { Codec } from '../shared/codec';
export { CodecImpl } from '../shared/codec';
export type {
  AnyCodecDescriptor,
  AnyCodecDescriptorTemplate,
  CodecDescriptor,
  CodecDescriptorTemplate,
} from '../shared/codec-descriptor';
export { CodecDescriptorImpl, CodecDescriptorTemplateImpl } from '../shared/codec-descriptor';
export type {
  CodecCallContext,
  CodecInstanceContext,
  CodecLookup,
  CodecRef,
  CodecRegistry,
  CodecTrait,
} from '../shared/codec-types';
export { emptyCodecLookup, voidParamsSchema } from '../shared/codec-types';
export type {
  ColumnHelperFor,
  ColumnHelperForStrict,
  ColumnSpec,
  ColumnTypeDescriptor,
} from '../shared/column-spec';
export { column } from '../shared/column-spec';
export type {
  Cast,
  DataType,
  DataTypeId,
  DataTypeLookup,
  DataTypeSpec,
  ListCast,
} from '../shared/data-type';
export {
  createDataTypeLookup,
  dataType,
  dataTypeId,
} from '../shared/data-type';
export { jsonDefaultLiteralTagEntry } from '../shared/json-default-literal-tag';
export type {
  Literal,
  LiteralRefusal,
  LiteralTypeDeclaration,
  LiteralTypeName,
  ReadLiteralResult,
  ScalarLiteral,
  WrittenLiteral,
} from '../shared/literal-types';
export {
  describeDeclarations,
  integerLiteralTypesUpTo,
  isCompatible,
  isNonFiniteText,
  isNumeralText,
  readLiteral,
} from '../shared/literal-types';
export type { WrittenLiteralText } from '../shared/literal-types-write';
export { escapePslString, numeralText, writeLiteral } from '../shared/literal-types-write';
export { renderTsLiteral } from '../shared/render-ts-literal';
export {
  CONTRACT_CODEC_DESCRIPTOR_MISSING,
  materializeCodec,
  resolveCodecDescriptorOrThrow,
  validateCodecTypeParams,
} from '../shared/resolve-codec';
