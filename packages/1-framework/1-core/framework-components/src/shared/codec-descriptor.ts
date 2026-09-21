/**
 * Codec descriptor interface (consumer surface) and abstract `CodecDescriptorImpl` base (codec-author surface).
 *
 * Consumers depend on the {@link CodecDescriptor} interface — it is the codec-id-keyed source of truth for static metadata (`traits`, `targetTypes`) and registration concerns (`paramsSchema`; optional `renderOutputType`). The runtime `Codec` instance returned by `factory(params)(ctx)` carries only the conversion behavior.
 *
 * Codec authors `extend` the {@link CodecDescriptorImpl} abstract class to declare their codec id, traits, target types, params schema, the `factory(params)` that materializes a typed `Codec<...>`, and (optionally) a `renderOutputType(params)` for the emit path.
 *
 * The factory's method-level generic is the load-bearing piece for literal preservation: per-codec column helpers invoke `descriptor.factory(...)` *directly*, and the direct call binds the generic at its call site. Type extraction (`ReturnType<D['factory']>`, structural matching) widens method generics to their constraint — that's why the column-helper surface is per-codec, not polymorphic.
 */

import type { JsonValue } from '@internal/contract/types';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Codec } from './codec';
import { type CodecInstanceContext, type CodecTrait, voidParamsSchema } from './codec-types';
import type { DataTypeId } from './data-type';

/**
 * Unified codec descriptor. Every codec in the framework registers through this shape — non-parameterized codecs use `P = void` and a constant factory that returns the same shared codec instance for every column; parameterized codecs use a non-empty `P` and a curried higher-order factory that returns a per-instance codec.
 *
 * The descriptor is the codec-id-keyed source of truth for static metadata (`traits`, `targetTypes`) and registration concerns (`paramsSchema` for JSON-boundary validation; optional `renderOutputType` for the `contract.d.ts` emit path). The runtime `Codec` instance returned by `factory(params)(ctx)` carries only the conversion behavior.
 *
 * Whether a codec id "is parameterized" stops being a registration-time distinction — it's a property of `P` on the descriptor. The descriptor map indexes every descriptor by `codecId`; both `descriptorFor(codecId)` and `forColumn(table, column)` resolve through the same map without branching on parameterization.
 *
 * @template P - The shape of the params accepted by the factory (`void` for non-parameterized codecs; a record like `{ length: number }` for parameterized codecs).
 *
 * Codec-registry-unification project § Decision.
 */
export interface CodecDescriptorTemplate<P = void> {
  /** The codec ID this descriptor applies to (e.g. `pg/vector@1`, `pg/text@1`). */
  readonly codecId: string;
  /** Semantic traits for operator gating (e.g. equality, order, numeric). */
  readonly traits: readonly CodecTrait[];
  /** Database-native type names this codec handles (e.g. `['timestamptz']`). */
  readonly targetTypes: readonly string[];
  /** Standard Schema validator for the factory's params. Validates JSON-sourced params at the contract boundary (PSL → IR; `contract.json` → runtime). For non-parameterized codecs (`P = void`), the schema validates `void`/`undefined` — the framework supplies no params at the call boundary. */
  readonly paramsSchema: StandardSchemaV1<P>;
  /** Whether this descriptor is parameterized — i.e. its `paramsSchema` is something other than the singleton `voidParamsSchema`. Consumers that need to gate column-aware dispatch read this directly rather than threading a free-floating `(codecId) => boolean` callback. */
  readonly isParameterized: boolean;
  /** Emit-path string renderer for `contract.d.ts`. Returns the TypeScript output type expression for given params (e.g. `Vector<1536>`). Optional; absent renderers cause the emitter to fall back to the codec's base output type. Non-parameterized codecs typically omit it. */
  readonly renderOutputType?: (params: P) => string | undefined;
  /** Emit-path string renderer for the `contract.d.ts` *input* position (create/update values). Returns the TypeScript input type expression for given params. Optional; absent renderers fall back to the codec's base input type. A codec supplies this when its write type is narrower than the generic codec input — e.g. an enum whose input should be the literal member union, not `string`. */
  readonly renderInputType?: (params: P) => string | undefined;
  /**
   * Given one stored (codec-encoded) value, return the TypeScript literal type to print for it
   * (e.g. `'low'`, `1`), or `undefined` if this codec's output isn't literal-expressible (e.g. a
   * Date-output codec).
   *
   * `value` is the `encodeJson` form stored in the value set. `side` selects which type to print:
   * `output` = the read/SELECT type; `input` = the create/update type. Most codecs render the same
   * literal for both, but a codec whose read and write types differ can render per side. Called once
   * per permitted value; the caller joins the results with `|`.
   */
  readonly renderValueLiteral?: (value: JsonValue, side: 'output' | 'input') => string | undefined;
  /** The curried higher-order codec. For non-parameterized codecs, the factory is constant — every call returns the same shared codec instance. For parameterized codecs, the factory is called once per `storage.types` instance (or once per inline-`typeParams` column), with `ctx` carrying the column set the resulting codec serves. */
  readonly factory: (params: P) => (ctx: CodecInstanceContext) => Codec;
}

/**
 * A codec descriptor: a {@link CodecDescriptorTemplate} that names the data type it represents.
 *
 * Several codecs may represent one type, differing in the value they produce in memory; all of them
 * read and write that type's canonical form. A descriptor whose data type is not registered in the
 * assembled stack is an assembly error. ADR 254.
 */
export interface CodecDescriptor<P = void> extends CodecDescriptorTemplate<P> {
  /** The data type this codec is one representation of. */
  readonly dataType: DataTypeId;
}

/**
 * Variance-erased {@link CodecDescriptorTemplate} alias, for the same reason as
 * {@link AnyCodecDescriptor}.
 */
// biome-ignore lint/suspicious/noExplicitAny: variance erasure for heterogeneous descriptor collections
export type AnyCodecDescriptorTemplate = CodecDescriptorTemplate<any>;

/**
 * Variance-erased {@link CodecDescriptor} alias. `CodecDescriptor<P>` is invariant in `P` (the `factory` and `renderOutputType` slots use `P` contravariantly), so `CodecDescriptor<P>` does not extend `CodecDescriptor<unknown>` for specific `P`. Heterogeneous descriptor collections — e.g. `SqlStaticContributions.codecs:` returning a list that mixes parameterized and non-parameterized descriptors — type against this alias and narrow per codec id at the consumer.
 *
 * Codec-registry-unification spec § Decision: every codec resolves through one descriptor map; reads are non-branching.
 */
// biome-ignore lint/suspicious/noExplicitAny: variance erasure for heterogeneous descriptor collections
export type AnyCodecDescriptor = CodecDescriptor<any>;

/**
 * Abstract base class for concrete codec descriptors.
 *
 * Codec authors extend this class with their typed `TParams` and declare `codecId`, `traits`, `targetTypes`, `paramsSchema`, the curried `factory(params)`, and (optionally) `renderOutputType`.
 *
 * Implements the {@link CodecDescriptor} interface so a concrete subclass instance is directly usable wherever the framework expects a `CodecDescriptor<P>`.
 */
export abstract class CodecDescriptorTemplateImpl<TParams = void>
  implements CodecDescriptorTemplate<TParams>
{
  abstract readonly codecId: string;
  abstract readonly traits: readonly CodecTrait[];
  abstract readonly targetTypes: readonly string[];

  abstract readonly paramsSchema: StandardSchemaV1<TParams>;

  /** Boolean derived from `paramsSchema`: `true` whenever the schema is not the singleton `voidParamsSchema`. */
  get isParameterized(): boolean {
    return this.paramsSchema !== voidParamsSchema;
  }

  /** Optional emit-path string renderer for `contract.d.ts`. Returns the TypeScript output type expression for the given params (e.g. `Vector<1536>`). Non-parameterized codecs typically omit it. */
  renderOutputType?(params: TParams): string | undefined;

  /** Optional emit-path string renderer for the `contract.d.ts` input position. Returns the TypeScript input type expression for the given params; supplied when the write type is narrower than the generic codec input (e.g. an enum's literal member union). */
  renderInputType?(params: TParams): string | undefined;

  /** Optional emit-path renderer for a single stored value. See {@link CodecDescriptor.renderValueLiteral}. */
  renderValueLiteral?(value: JsonValue, side: 'output' | 'input'): string | undefined;

  /**
   * Materialize a curried codec factory for the given params. Concrete subclasses override with a typed return type (e.g. `factory<N>(params: { length: N }): (ctx) => VectorCodec<N>`); per-codec helpers read the typed return at the *direct* call site, which is what preserves method-level generics. Type extraction (e.g. `ReturnType<D['factory']>`) widens method generics to their constraint — that's why the column-helper surface is per-codec, not polymorphic.
   */
  abstract factory(
    params: TParams,
  ): (ctx: CodecInstanceContext) => Codec<string, readonly CodecTrait[], unknown, unknown>;
}

/**
 * Abstract base for a concrete codec descriptor: a {@link CodecDescriptorTemplateImpl} that also
 * names the data type its codec represents.
 *
 * A codec whose data type depends on the target that adopts it extends
 * {@link CodecDescriptorTemplateImpl} instead, and the target names the type when it adapts the
 * template.
 */
export abstract class CodecDescriptorImpl<TParams = void>
  extends CodecDescriptorTemplateImpl<TParams>
  implements CodecDescriptor<TParams>
{
  abstract readonly dataType: DataTypeId;
}
