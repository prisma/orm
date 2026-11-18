/**
 * Aggregate descriptor vocabulary: the declarative mapping from `(aggregate operation, optional input codec)` to the identity of the aggregate's result, whether it can be null, and — where it cannot — the value it answers with over no result row.
 *
 * Result identity is operation- and target-specific, so it lives beside codec descriptors rather than on them: one input codec produces different results under different operations, and one operation produces different results on different targets.
 *
 * Components contribute descriptors through `types.aggregateDescriptors`. This module owns the declarative half of the protocol — the half emission reads and the half ownership validation keys on. Families extend {@link AggregateDescriptor} with their own lowering hook; because such a hook returns an expression and never a codec, a descriptor's declared `output` is the only source of result identity.
 */

import type { JsonValue } from '@internal/contract/types';
import type { CodecRef, CodecTrait } from './codec-types';
import { isCodecTrait } from './codec-types';

/**
 * How a descriptor matches the value an aggregate consumes.
 *
 * - `none` — the operation consumes no value (counting entries).
 * - `codec` — the value's codec id matches exactly.
 * - `trait` — the value's codec advertises the trait.
 * - `any` — the operation's result does not depend on its input, so the descriptor answers calls with and without one (counting entries or non-null values).
 *
 * Resolution consults exact codec matches first, then traits, then input-agnostic matches; a `none` match answers only a call that carries no input.
 */
export type AggregateInputMatch =
  | { readonly kind: 'none' }
  | { readonly kind: 'codec'; readonly codecId: string }
  | { readonly kind: 'trait'; readonly trait: CodecTrait }
  | { readonly kind: 'any' };

/**
 * Result identity that names its codec outright. The optional `typeParams` resolver derives the result's type parameters from the input reference; it cannot change which codec id the result carries.
 *
 * The resolved parameters refine which codec instance decodes the result. The emitted aggregate rows select the result's application type from the codec id alone — the same granularity every emitted codec type has — so the parameters never widen or narrow the static result type.
 */
export interface NamedAggregateOutput {
  readonly kind: 'codec';
  readonly codecId: string;
  readonly typeParams?: (input: CodecRef | undefined) => JsonValue | undefined;
}

/** Result identity that reuses the matched input codec, type parameters included. */
export interface SelfAggregateOutput {
  readonly kind: 'self';
}

/** Declarative identity of the codec an aggregate's result carries. */
export type AggregateOutputCodec = SelfAggregateOutput | NamedAggregateOutput;

/**
 * Whether the result can be null — declared, never inferred from the input's nullability — and, where it cannot, the value the operation answers with.
 *
 * A database answers an empty input set itself, so the declared value is read only where no result row reached the caller at all: an absent aggregate alias, or a nested envelope that never arrived. It is stated as a wire value of the result codec, the value the database would have returned, and read with the codec's `fromWire`, so the application value's shape stays the codec's to define while the answer stays the operation's to declare — `count` over nothing is a zero whatever type the codec reads a zero as, and an operation whose identity element is not zero declares that instead.
 */
export type AggregateResultNullability =
  | { readonly nullable: true }
  | { readonly nullable: false; readonly emptyResultWire: unknown };

type AggregateDescriptorBase = AggregateResultNullability & {
  /** The aggregate operation this descriptor resolves (e.g. `count`, `sum`). */
  readonly operation: string;
};

/** Overload of an operation that consumes no value. Its result names a codec outright, there being no input codec to reuse. */
export type NoInputAggregateDescriptor = AggregateDescriptorBase & {
  readonly input: { readonly kind: 'none' };
  readonly output: NamedAggregateOutput;
};

/** Overload of an operation whose result does not depend on its input. It answers calls with and without an input, so — like a no-input overload — it names its result codec outright. */
export type AnyInputAggregateDescriptor = AggregateDescriptorBase & {
  readonly input: { readonly kind: 'any' };
  readonly output: NamedAggregateOutput;
};

/** Overload of an operation over values whose codec matches by id or by trait. */
export type ValueInputAggregateDescriptor = AggregateDescriptorBase & {
  readonly input:
    | { readonly kind: 'codec'; readonly codecId: string }
    | { readonly kind: 'trait'; readonly trait: CodecTrait };
  readonly output: AggregateOutputCodec;
};

/**
 * One `(operation, input)` overload of an aggregate operation.
 *
 * Each pair has exactly one contributor across a composed stack, so `count` over entries, `sum` over a numeric trait, and `sum` over one exact codec id are three independent descriptors that may come from three different components.
 */
export type AggregateDescriptor =
  | NoInputAggregateDescriptor
  | AnyInputAggregateDescriptor
  | ValueInputAggregateDescriptor;

/**
 * Ownership key of an `(operation, input)` pair. Two descriptors sharing a key are two contributors claiming one overload, which is a composition error.
 */
export function aggregateDescriptorKey(descriptor: AggregateDescriptor): string {
  switch (descriptor.input.kind) {
    case 'none':
      return `${descriptor.operation}:none`;
    case 'any':
      return `${descriptor.operation}:any`;
    case 'codec':
      return `${descriptor.operation}:codec:${descriptor.input.codecId}`;
    case 'trait':
      return `${descriptor.operation}:trait:${descriptor.input.trait}`;
  }
}

/** Whether `descriptor` is the overload of an operation that consumes no value — the case whose result always names a codec outright. */
export function isNoInputAggregateDescriptor(
  descriptor: AggregateDescriptor,
): descriptor is NoInputAggregateDescriptor {
  return descriptor.input.kind === 'none';
}

/** Whether `descriptor` answers regardless of input — the fallback rung of resolution. */
export function isAnyInputAggregateDescriptor(
  descriptor: AggregateDescriptor,
): descriptor is AnyInputAggregateDescriptor {
  return descriptor.input.kind === 'any';
}

function isObjectLike(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isAggregateInputMatch(value: unknown): value is AggregateInputMatch {
  if (!isObjectLike(value) || !('kind' in value)) return false;
  switch (value.kind) {
    case 'none':
    case 'any':
      return true;
    case 'codec':
      return 'codecId' in value && isNonEmptyString(value.codecId);
    case 'trait':
      return 'trait' in value && isCodecTrait(value.trait);
    default:
      return false;
  }
}

function isAggregateOutputCodec(value: unknown): value is AggregateOutputCodec {
  if (!isObjectLike(value) || !('kind' in value)) return false;
  switch (value.kind) {
    case 'self':
      return true;
    case 'codec':
      return (
        'codecId' in value &&
        isNonEmptyString(value.codecId) &&
        (!('typeParams' in value) ||
          value.typeParams === undefined ||
          typeof value.typeParams === 'function')
      );
    default:
      return false;
  }
}

/**
 * Structural validation of a contributed descriptor. Components assembled from JavaScript reach the contribution slot unchecked, so composition validates the shape once and every later read is a plain lookup.
 */
export function isAggregateDescriptor(value: unknown): value is AggregateDescriptor {
  if (!isObjectLike(value)) return false;
  if (!('operation' in value) || !isNonEmptyString(value.operation)) return false;
  if (!('nullable' in value) || typeof value.nullable !== 'boolean') return false;
  if (
    value.nullable === false &&
    (!('emptyResultWire' in value) || value.emptyResultWire === undefined)
  ) {
    return false;
  }
  if (!('input' in value) || !isAggregateInputMatch(value.input)) return false;
  if (!('output' in value) || !isAggregateOutputCodec(value.output)) return false;
  const reusesAnInput = value.input.kind === 'codec' || value.input.kind === 'trait';
  return reusesAnInput || value.output.kind === 'codec';
}
