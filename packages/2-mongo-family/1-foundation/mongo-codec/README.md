# @internal/mongo-codec

Codec interface and registry for MongoDB value serialization.

## Responsibilities

- **Codec interface**: `MongoCodec<Id, TTraits, TWire, TInput>` — declares how a JS value translates to and from the BSON-shaped wire format the Mongo driver exchanges, plus the JSON-safe form stored in contract artifacts. Same four generics as the framework `Codec` base; the codec instance carries only `id` plus the four conversion methods. Trait annotations (`equality`, `order`, `boolean`, `numeric`, `textual`, `vector`) for operator gating live on the unified `CodecDescriptor` (see [ADR 208](../../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md)).
- **Codec factory**: `mongoCodec()` — creates frozen codec instances from a config object. Both `encode` and `decode` are required so `TInput` and `TWire` are always covered by an explicit author function — the factory installs no identity fallback. `encode` and `decode` may be authored as sync or async functions and are lifted to Promise-returning query-time methods automatically. Build-time methods (`encodeJson`, `decodeJson`) are synchronous and default to identity when omitted.
- **Codec registry**: `MongoCodecRegistry` and `newMongoCodecRegistry()` — a map-based container that stores and retrieves codecs by ID, with duplicate-ID protection
- **Type-level helper**: `MongoCodecInput<T>` for extracting the JS application type from a codec type. Trait metadata lives on the unified `CodecDescriptor` (see [ADR 208](../../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md)).

## Examples

```ts
// Sync authoring:
const intCodec = mongoCodec({
  typeId: 'mongo/int@1',
  encode: (v: number) => v,
  decode: (w: number) => w,
  encodeJson: (v: number) => v,
  decodeJson: (j: number) => j,
});

// Async authoring (e.g. KMS-backed encryption): same factory, same shape.
const secretCodec = mongoCodec({
  typeId: 'mongo/secret@1',
  encode: async (v: string) => encrypt(v, await getKey()),
  decode: async (w: string) => decrypt(w, await getKey()),
  encodeJson: (v: string) => v,
  decodeJson: (j: string) => j,
});
```

### Codec call context (`ctx`)

Codecs receive a second `ctx` options argument; you may ignore it. The Mongo runtime allocates one `CodecCallContext` per `mongoRuntime.execute(plan, { signal })` call and threads the same reference to every codec dispatch site as a non-optional argument — when no `signal` is supplied the runtime still threads an empty `{}`, never `undefined`. Mongo uses the framework `CodecCallContext` directly (signal-only); column metadata is SQL-family-specific and isn't part of Mongo's per-call shape today. The internal `MongoCodec` interface declares the parameter as required (`encode(value, ctx: CodecCallContext)` / `decode(wire, ctx: CodecCallContext)`); single-arg author functions `(value) => …` continue to compile via TypeScript's bivariance for trailing parameters, so codec ergonomics are unchanged. The `signal` field on the ctx may be `undefined` when the caller didn't supply one.

```ts
// Forward ctx.signal to a network SDK so aborted queries stop the round-trip.
const kmsSecretCodec = mongoCodec({
  typeId: 'mongo/kms-secret@1',
  encode: async (v: string, ctx) =>
    kms.encrypt({ plaintext: v }, { signal: ctx?.signal }),
  decode: async (w: string, ctx) =>
    kms.decrypt({ ciphertext: w }, { signal: ctx?.signal }),
  encodeJson: (v: string) => v,
  decodeJson: (j: string) => j,
});
```

> **Note.** Mongo's read path doesn't go through `codec.decode` (per ADR 204 cross-family scope notes), so the `decode` signature above accepts `ctx` for parity with the codec interface but the runtime doesn't currently invoke `decode` on the Mongo read side. Encode-side `ctx.signal` is observed at every recursion level of `resolveValue` so a mid-encode abort surfaces as `RUNTIME.ABORTED { phase: 'encode' }`.

Codec bodies that ignore `ctx.signal` complete in the background (cooperative cancellation); aborts still surface to the caller as `RUNTIME.ABORTED`.

See [ADR 204 — Single-Path Async Codec Runtime](../../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) for the codec runtime's async boundary contract, and [ADR 207 — Codec call context: per-query `AbortSignal` and column metadata](../../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) for the per-call context shape.
