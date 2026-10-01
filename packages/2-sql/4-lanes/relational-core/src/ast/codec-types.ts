import type { JsonValue } from '@internal/contract/types';
import type {
  Codec as BaseCodec,
  CodecCallContext,
  CodecDescriptor,
  CodecDescriptorTemplate,
  CodecInstanceContext,
  CodecRef,
  CodecTrait,
} from '@internal/framework-components/codec';
import { ifDefined } from '@internal/utils/defined';

export type {
  CodecCallContext,
  CodecDescriptor,
  CodecRef,
  CodecTrait,
} from '@internal/framework-components/codec';

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function freezeJsonValue(value: JsonValue): void {
  if (value === null || typeof value !== 'object') {
    return;
  }

  if (isJsonArray(value)) {
    for (const item of value) {
      freezeJsonValue(item);
    }
  } else {
    for (const item of Object.values(value)) {
      freezeJsonValue(item);
    }
  }

  Object.freeze(value);
}

export function frozenCodecRef(codec: CodecRef): CodecRef {
  const typeParams = codec.typeParams === undefined ? undefined : structuredClone(codec.typeParams);
  if (typeParams !== undefined) {
    freezeJsonValue(typeParams);
  }

  return Object.freeze({
    codecId: codec.codecId,
    ...ifDefined('typeParams', typeParams),
    ...ifDefined('many', codec.many),
  });
}

/**
 * SQL-family addressing of a single column. The decode site populates a `SqlColumnRef` whenever it can resolve the cell to a single underlying `(table, column)` (the typical case for projected columns from a single-table source); cells the runtime cannot resolve (aggregate aliases, include aggregate fields, computed projections without a simple ref) get `column = undefined`.
 *
 * The shape is a structural projection of the runtime's `ColumnRef` so the SQL decode site can reuse the resolution it already performs for `RUNTIME.DECODE_FAILED` envelope construction without allocating twice per cell.
 */
export interface SqlColumnRef {
  readonly table: string;
  readonly name: string;
}

/**
 * SQL-family per-call context. Extends the framework {@link CodecCallContext} (which carries `signal` only) with `column?: SqlColumnRef`, populated on **decode** call sites that can resolve a single underlying column ref. Encode call sites currently leave `column` undefined (encode-time column context is the middleware's domain).
 *
 * SQL codec authors writing codec methods observe this type via {@link SqlCodec}. The framework codec dispatch surface (and Mongo) sees only the base `CodecCallContext`.
 */
export interface SqlCodecCallContext extends CodecCallContext {
  readonly column?: SqlColumnRef;
}

/**
 * SQL-family per-instance context. Extends the framework {@link CodecInstanceContext} (`name` only) with `usedAt`, the set of `(table, column)` pairs the resolved codec serves.
 *
 * - For `typeRef` columns sharing one named `storage.types` instance, the array lists every referencing column — a column-scoped stateful codec (e.g. encryption) can derive aggregated per-instance state across all the columns sharing the named instance.
 * - For inline-`typeParams` columns, the array has exactly one entry — the column that owns the inline params.
 * - For shared non-parameterized codecs, the array carries one representative entry (the column that triggered materialization); the codec is shared across every column with that codec id, so the `usedAt` is informational only.
 *
 * SQL extensions consuming `usedAt` (e.g. column-scoped state derivation) type their factory parameter as `SqlCodecInstanceContext`. Extensions that don't read `usedAt` type their factory parameter as the family-agnostic {@link CodecInstanceContext} — a `SqlCodecInstanceContext` is structurally assignable to the base.
 */
export interface SqlCodecInstanceContext extends CodecInstanceContext {
  readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
}

/**
 * SQL codec — extends the framework codec base by narrowing the per-call context to the SQL-family {@link SqlCodecCallContext} (adds `column?: SqlColumnRef`). TypeScript treats method-syntax declarations bivariantly, so the SQL narrowing is structurally compatible with the framework {@link BaseCodec} super-interface.
 *
 * Codec-id-keyed static metadata (`traits`, `targetTypes`, `paramsSchema`, `renderOutputType`) lives on the unified {@link import('@internal/framework-components/codec').CodecDescriptor} — the codec instance itself only carries `id` plus the four conversion methods.
 *
 * See `Codec` in `@internal/framework-components/codec` for the codec contract that this interface extends.
 */
export interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
> extends BaseCodec<Id, TTraits, TWire, TInput> {
  encode(value: TInput, ctx: SqlCodecCallContext): Promise<TWire>;
  decode(wire: TWire, ctx: SqlCodecCallContext): Promise<TInput>;
}

/**
 * Contract-bound codec registry.
 *
 * Built once at `ExecutionContext` construction time by walking the contract's `storage.tables[].columns[]` and resolving each column through its descriptor's factory. Runtime encode/decode dispatch resolves codecs via `forCodecRef(ref)` — the single dispatch shape for AST-bound codec resolution.
 *
 * `forColumn(namespace, table, column)` is retained for build-time helpers that need column-keyed lookup (e.g. projection stamping); runtime dispatch routes through `forCodecRef`.
 */
export interface ContractCodecRegistry {
  /**
   * Resolve the codec for `(namespace, table, column)`. Returns the per-instance parameterized codec for parameterized columns, the shared codec for non-parameterized columns, or `undefined` if the column is unknown or the codec isn't registered.
   *
   * The `namespaceId` coordinate leads and is always supplied — the column is resolved strictly within that namespace, so two same-bare-named tables across namespaces resolve to their own per-namespace codecs.
   */
  forColumn(namespaceId: string, table: string, column: string): Codec | undefined;

  /**
   * Resolve a codec by {@link CodecRef}. The single dispatch shape for AST-bound codec resolution — every codec-bearing AST node carries a `CodecRef` that resolves through this method via the per-`ExecutionContext` `AstCodecResolver`. Two refs with the same `codecId` and structurally equal `typeParams` (regardless of object key order) return the same memoised codec instance. Throws `RUNTIME.CODEC_DESCRIPTOR_MISSING` for unknown `codecId`s and `RUNTIME.TYPE_PARAMS_INVALID` on `paramsSchema` rejection.
   *
   * Pre-populated from the contract walk at registry construction time (so contract-declared codecs hit on first call); grows lazily for AST-supplied refs not seen at contract-load time (deserialised migration ops, refs-less raw SQL with an explicit codec).
   */
  forCodecRef(ref: CodecRef): Codec;
}

/**
 * Variance-erased descriptor type used for heterogeneous storage in collection containers and on the unified contributor `codecs:` slot. The descriptor's `factory` and `renderOutputType` are contravariant in `P`, so descriptors with different params shapes are not in a subtype relationship; collecting them into one container needs an explicit variance erasure rather than `CodecDescriptor<unknown>` (which is the
 * narrowest, not the widest, of the family).
 */
// biome-ignore lint/suspicious/noExplicitAny: descriptor variance erasure — `P` is contravariant on the factory and renderOutputType slots, so heterogeneous descriptor storage cannot use `unknown`.
export type AnyCodecDescriptor = CodecDescriptor<any>;

/** Variance-erased {@link CodecDescriptorTemplate}: a descriptor whose data type the adapting target names. */
// biome-ignore lint/suspicious/noExplicitAny: variance erasure, as for AnyCodecDescriptor
export type AnyCodecDescriptorTemplate = CodecDescriptorTemplate<any>;

type DescriptorResolvedCodec<D> =
  D extends CodecDescriptor<infer _P> ? ReturnType<ReturnType<D['factory']>> : never;

export type DescriptorCodecId<D> = D extends AnyCodecDescriptor ? D['codecId'] : never;

export type DescriptorCodecInput<D> =
  DescriptorResolvedCodec<D> extends BaseCodec<string, readonly CodecTrait[], unknown, infer In>
    ? In
    : never;

/**
 * Resolve the JSON type for a descriptor `D` — what the codec's `encodeJson`
 * produces, and therefore what a `contract.json` holds for a value of this
 * codec.
 *
 * This is a distinct channel from {@link DescriptorCodecInput} because the two
 * diverge wherever a codec's canonical JSON is not the value it hands the
 * application — a wide integer carried as a decimal string, say. Reading the
 * application type where the JSON type is meant produces a contract type that
 * describes a value the file cannot contain.
 *
 * The type is read off the codec's declared `encodeJson` return, so a codec that
 * narrows that return (`encodeJson(value: bigint): string`) publishes its JSON
 * type without a new type parameter, and one that does not stays at the
 * `JsonValue` the base signature promises.
 */
export type DescriptorCodecJson<D> =
  DescriptorResolvedCodec<D> extends BaseCodec<string, readonly CodecTrait[], unknown, unknown>
    ? ReturnType<DescriptorResolvedCodec<D>['encodeJson']>
    : never;

/**
 * Resolve the trait union for a descriptor `D`.
 *
 * Reads `traits` directly off the descriptor — concrete descriptor classes declare `override readonly traits = [...] as const`, which preserves the literal trait tuple at the descriptor type. Reading from the resolved codec instance (`CodecImpl<…, TTraits, …>`) would lose the literal because `Codec` carries `TTraits` only on its optional phantom slot (`readonly __codecTraits?: TTraits`); codecs extending `CodecImpl`
 * have no required structural site that pins `TTraits`, so a descriptor-keyed extractor reading from the codec instance would widen to the broad `CodecTrait` union.
 */
export type DescriptorCodecTraits<D> = D extends {
  readonly traits: infer TTraits extends readonly CodecTrait[];
}
  ? TTraits[number] & CodecTrait
  : never;

/**
 * Project a record of {@link AnyCodecDescriptor}s keyed by scalar name onto the codec-id-keyed `CodecTypes` shape consumed by emit and no-emit type pipelines (`{ readonly [codecId]: { input; output; traits } }`).
 *
 * Canonical extractor for the descriptor-keyed type pipeline; the legacy instance-keyed extractor and its `mkCodec`-bound builder retired alongside the carrier deletion.
 */
export type ExtractCodecTypes<
  ScalarNames extends {
    readonly [K in keyof ScalarNames]: AnyCodecDescriptor;
  } = Record<never, never>,
> = {
  readonly [K in keyof ScalarNames as DescriptorCodecId<ScalarNames[K]>]: {
    readonly input: DescriptorCodecInput<ScalarNames[K]>;
    readonly output: DescriptorCodecInput<ScalarNames[K]>;
    readonly json: DescriptorCodecJson<ScalarNames[K]>;
    readonly traits: DescriptorCodecTraits<ScalarNames[K]>;
  };
};
