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
export { emptyCodecLookup } from '../shared/codec-types';
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
export { renderTsLiteral } from '../shared/render-ts-literal';
export {
  CONTRACT_CODEC_DESCRIPTOR_MISSING,
  materializeCodec,
  resolveCodecDescriptorOrThrow,
  validateCodecTypeParams,
} from '../shared/resolve-codec';
