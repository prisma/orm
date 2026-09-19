import { blindCast } from '@internal/utils/casts';
import type { Codec } from './codec';
import type { AnyCodecDescriptor } from './codec-descriptor';
import type { CodecInstanceContext, CodecRef } from './codec-types';
import { runtimeError } from './runtime-error';

export const CONTRACT_CODEC_DESCRIPTOR_MISSING = 'CONTRACT.CODEC_DESCRIPTOR_MISSING' as const;

/**
 * Look up a descriptor for `ref.codecId` using `descriptorFor`; throw
 * `code` if none is found. Each plane names its own error path: the control
 * plane resolves contract-stack descriptors (`CONTRACT.*`), the execution
 * plane resolves at query time (`RUNTIME.*`).
 */
export function resolveCodecDescriptorOrThrow(
  descriptorFor: (codecId: string) => AnyCodecDescriptor | undefined,
  ref: CodecRef,
  code: 'CONTRACT.CODEC_DESCRIPTOR_MISSING' | 'RUNTIME.CODEC_DESCRIPTOR_MISSING',
): AnyCodecDescriptor {
  const descriptor = descriptorFor(ref.codecId);
  if (!descriptor) {
    throw runtimeError(code, `No codec descriptor registered for codecId '${ref.codecId}'.`, {
      codecId: ref.codecId,
    });
  }
  return descriptor;
}

/**
 * Validates `ref.typeParams` against `descriptor.paramsSchema`.
 *
 * Parameterized codecs that omit `typeParams` have it normalized to `{}` before
 * validation (mirrors `ast-codec-resolver.ts` semantics). Throws
 * `RUNTIME.TYPE_PARAMS_INVALID` when the validator returns a `Promise` or
 * reports issues.
 */
export function validateCodecTypeParams(descriptor: AnyCodecDescriptor, ref: CodecRef): unknown {
  const normalized =
    descriptor.isParameterized && ref.typeParams === undefined ? { ...ref, typeParams: {} } : ref;

  const result = blindCast<
    { value: unknown } | { issues: ReadonlyArray<{ message: string }> } | Promise<unknown>,
    'Standard Schema validate returns unknown; the spec guarantees this union shape'
  >(descriptor.paramsSchema['~standard'].validate(normalized.typeParams));

  if (result instanceof Promise) {
    throw runtimeError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `paramsSchema for codec '${ref.codecId}' returned a Promise; runtime validation requires a synchronous Standard Schema validator.`,
      { codecId: ref.codecId, typeParams: ref.typeParams },
    );
  }

  if ('issues' in result && result.issues) {
    const messages = result.issues.map((issue) => issue.message).join('; ');
    throw runtimeError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `Invalid typeParams for codec '${ref.codecId}': ${messages}`,
      { codecId: ref.codecId, typeParams: ref.typeParams },
    );
  }

  return blindCast<{ value: unknown }, 'issues guard above rules out the issues branch'>(result)
    .value;
}

/**
 * Resolves a `Codec` instance: validates `ref.typeParams` via
 * {@link validateCodecTypeParams} then calls `descriptor.factory(validated)(ctx)`
 * as a method on `descriptor`, preserving `this` for factories that build
 * their returned codec from the descriptor instance (e.g. `new XCodec(this)`).
 */
export function materializeCodec(
  descriptor: AnyCodecDescriptor,
  ref: CodecRef,
  ctx: CodecInstanceContext,
): Codec {
  const validated = validateCodecTypeParams(descriptor, ref);
  return descriptor.factory(validated)(ctx);
}
