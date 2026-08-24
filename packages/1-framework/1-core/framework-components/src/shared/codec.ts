/**
 * Codec interface (consumer surface) and abstract `CodecImpl` base (codec-author surface).
 *
 * Consumers depend on the {@link Codec} interface — it describes the runtime instance returned by a descriptor's curried factory and is what the framework threads through emit, validate, and execute paths.
 *
 * Codec authors `extend` the {@link CodecImpl} abstract class to declare a typed runtime codec instance. The class carries a variance-erased descriptor reference (`CodecDescriptor<any>`); `id` proxies through the descriptor so one source of truth governs both metadata reads and aliasing semantics (alias subclasses inherit the descriptor's id automatically).
 *
 * Class generic shape: `Id`, `TTraits`, `TWire`, `TInput`. Method generics on the codec subclass's own surface (e.g. arktype-json's schema generic, pgvector's dimension generic) flow through the subclass's constructor and propagate via the descriptor's typed `factory(params)` return at *direct* call sites.
 */

import type { JsonValue } from '@internal/contract/types';
import type { CodecDescriptor } from './codec-descriptor';
import type { CodecCallContext, CodecTrait } from './codec-types';

/**
 * A codec is the contract between an application value and its driver-wire and JSON representations.
 *
 * The author's mental model is two JS-side types — `TInput` (the application JS type) and `TWire` (the database driver wire format) — plus a target-defined `JsonValue`. The codec translates `TInput` to `TWire` on writes and back on ordinary reads, and to/from the target's JSON representation for contract artifacts and database-produced JSON values.
 *
 * Three representations participate:
 * - **Input** (`TInput`): the JS type at the application boundary.
 * - **Wire** (`TWire`): the format exchanged with the database driver.
 * - **JSON** (`JsonValue`): the target-defined JSON-safe form used in contract artifacts. It uses the exact scalar shape the target produces inside JSON values, which can differ from the ordinary wire format.
 *
 * The runtime instance carries only its `id` (the descriptor's `codecId`, set by the factory) and the four conversion methods. Static metadata (`traits`, `targetTypes`) and the build-time `renderOutputType` renderer live on the {@link CodecDescriptor} keyed by `codecId` — the read-surface single source of truth. Consumers that need them resolve through `descriptorFor(codecId)`.
 *
 * Codec methods split into two groups:
 *
 * - **Query-time** methods (`encode`, `decode`) run per row/parameter at the IO boundary; they are required and Promise-returning. The per-family codec factory accepts sync or async author functions and lifts sync ones to Promise-shaped methods automatically.
 * - **JSON** methods (`encodeJson`, `decodeJson`) run when the contract is serialized or loaded. Runtimes may also use `decodeJson` for values embedded in database-produced JSON results. They stay synchronous so contract validation and client construction are synchronous.
 *
 * Target-family codec interfaces extend this base; family-specific concerns (e.g. the SQL `column?` per-call context) layer on through the `CodecCallContext` extension pattern.
 */
export interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
> {
  /** Unique codec identifier in `namespace/name@version` format (e.g. `pg/timestamptz-temporal@1`). The factory sets this to the descriptor's `codecId`; consumers use it as a back-reference for descriptor lookups and for decode-error diagnostics. */
  readonly id: Id;
  /** Phantom carrier for the `TTraits` generic; type-only, undefined at runtime. Runtime traits live on {@link CodecDescriptor.traits}. Implemented as a string-key phantom (`__codecTraits`) rather than `unique symbol` so bundlers that split `.d.ts` chunks do not strand symbol identity on chunk-private paths (the same `TS2742` family that the public re-export of `CodecTypes` works around). */
  readonly __codecTraits?: TTraits;
  /** Converts a JS value to the wire format expected by the database driver. Always Promise-returning at the boundary. The {@link CodecCallContext} is supplied by the runtime on every call (allocated once per runtime operation, including `query()`, `PreparedStatement.query()`, and `execute()`); family layers may narrow the ctx to extend it (e.g. SQL adds `column`). Author-side single-arg `(value) => …` functions remain legal via TypeScript's bivariance for trailing parameters. */
  encode(value: TInput, ctx: CodecCallContext): Promise<TWire>;
  /** Converts a wire value from the database driver into the JS application type. Always Promise-returning at the boundary. The {@link CodecCallContext} is supplied by the runtime on every call (allocated once per runtime operation, including `query()`, `PreparedStatement.query()`, and `execute()`); family layers may narrow the ctx to extend it (e.g. SQL adds `column`). Author-side single-arg `(wire) => …` functions remain legal via TypeScript's bivariance for trailing parameters. */
  decode(wire: TWire, ctx: CodecCallContext): Promise<TInput>;
  /** Converts a JS value to the target-defined JSON representation used for contract serialization. This must match the scalar shape produced by the target inside JSON values. Synchronous; called during contract emission. */
  encodeJson(value: TInput): JsonValue;
  /** Converts the target-defined JSON representation back to the JS input type. Synchronous; called during contract loading via `family.deserializeContract` and may be called by runtimes for embedded JSON values. */
  decodeJson(json: JsonValue): TInput;
}

/**
 * Abstract base class for concrete codec implementations.
 *
 * Codec authors extend this class with their typed `Id`, `TTraits`, `TWire`, `TInput` and override all four abstract conversion methods: `encode`, `decode`, `encodeJson`, and `decodeJson`. The runtime instance carries only its `id` (proxied through the descriptor so alias subclasses inherit the descriptor's id automatically) and the conversion methods — static metadata lives on the {@link CodecDescriptor}.
 */
export abstract class CodecImpl<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
> implements Codec<Id, TTraits, TWire, TInput>
{
  /**
   * Variance-erased descriptor reference. Concrete codec subclasses receive the typed descriptor in their own constructors and forward it via `super(descriptor)`; the variance erasure lives at this base because the abstract surface can't carry the concrete `TParams`.
   */
  // biome-ignore lint/suspicious/noExplicitAny: variance-erased descriptor reference; subclasses retain typed access via their own state
  constructor(public readonly descriptor: CodecDescriptor<any>) {}

  get id(): Id {
    return this.descriptor.codecId as Id;
  }

  abstract encode(value: TInput, ctx: CodecCallContext): Promise<TWire>;
  abstract decode(wire: TWire, ctx: CodecCallContext): Promise<TInput>;
  abstract encodeJson(value: TInput): JsonValue;
  abstract decodeJson(json: JsonValue): TInput;
}
