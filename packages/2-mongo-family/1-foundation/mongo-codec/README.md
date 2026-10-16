# @internal/mongo-codec

Codec interface and registry for MongoDB value serialization.

## Responsibilities

- **Codec interface**: `MongoCodec<Id, TTraits, TWire, TInput>` — declares how a JS value translates to and from the BSON-shaped wire format the Mongo driver exchanges, plus the JSON-safe form stored in contract artifacts. Same four generics as the framework `Codec` base; the codec instance carries only `id` plus the four conversion methods. Trait annotations (`equality`, `order`, `boolean`, `numeric`, `textual`, `vector`) for operator gating live on the unified `CodecDescriptor` (see [ADR 208](../../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md)).
- **Codec factory**: `mongoCodec()` — creates frozen codec instances from a config object naming the codec's `typeId` and the `dataType` whose values it converts. Both `toWire` and `fromWire` are required so `TInput` and `TWire` are always covered by an explicit author function — the factory installs no identity fallback. They may be authored as sync or async functions and are lifted to Promise-returning query-time methods automatically. The value functions are synchronous and have the signatures they have on every codec: `toDataTypeValue` returns a value of the data type, built with `dataType.valueFrom(json, params)`, and `fromDataTypeValue` receives a value the data type has read and refuses a value of another type. Both may be left out when the application type is exactly `JsonValue`, `toDataTypeValue` may be left out for a narrower JSON type such as `string`, and a codec whose application type is not JSON supplies both.
- **Codec registry**: `MongoCodecRegistry` and `newMongoCodecRegistry()` — a map-based container that stores and retrieves codecs by ID, with duplicate-ID protection
- **Type-level helper**: `MongoCodecInput<T>` for extracting the JS application type from a codec type. Trait metadata lives on the unified `CodecDescriptor` (see [ADR 208](../../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md)).

## Examples

```ts
import type { DataTypeValue } from '@internal/framework-components/codec';
import { mongoInt32, mongoString } from '@internal/target-mongo/data-types';

// Sync authoring:
const intCodec = mongoCodec({
  typeId: 'mongo/int32@1',
  dataType: mongoInt32,
  toWire: (v: number) => v,
  fromWire: (w: number) => w,
  fromDataTypeValue: (value: DataTypeValue<number>) => value.value,
});

// Async authoring (e.g. KMS-backed encryption): same factory, same shape.
const secretCodec = mongoCodec({
  typeId: 'mongo/secret@1',
  dataType: mongoString,
  toWire: async (v: string) => encrypt(v, await getKey()),
  fromWire: async (w: string) => decrypt(w, await getKey()),
  fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
});
```

### Codec call context (`ctx`)

Codecs receive a second `ctx` options argument; you may ignore it. The Mongo runtime allocates one `CodecCallContext` per `mongoRuntime.execute(plan, { signal })` call and threads the same reference to every codec dispatch site as a non-optional argument — when no `signal` is supplied the runtime still threads an empty `{}`, never `undefined`. Mongo uses the framework `CodecCallContext` directly (signal-only); column metadata is SQL-family-specific and isn't part of Mongo's per-call shape today. The internal `MongoCodec` interface declares the parameter as required (`toWire(value, ctx: CodecCallContext)` / `fromWire(wire, ctx: CodecCallContext)`); single-arg author functions `(value) => …` continue to compile via TypeScript's bivariance for trailing parameters, so codec ergonomics are unchanged. The `signal` field on the ctx may be `undefined` when the caller didn't supply one.

```ts
// Forward ctx.signal to a network SDK so aborted queries stop the round-trip.
const kmsSecretCodec = mongoCodec({
  typeId: 'mongo/kms-secret@1',
  dataType: mongoString,
  toWire: async (v: string, ctx) =>
    kms.encrypt({ plaintext: v }, { signal: ctx?.signal }),
  fromWire: async (w: string, ctx) =>
    kms.decrypt({ ciphertext: w }, { signal: ctx?.signal }),
  fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
});
```

> **Note.** Mongo's read path doesn't go through `codec.fromWire` (per ADR 204 cross-family scope notes), so the `fromWire` signature above accepts `ctx` for parity with the codec interface but the runtime doesn't currently invoke `fromWire` on the Mongo read side. Encode-side `ctx.signal` is observed at every recursion level of `resolveValue` so a mid-encode abort surfaces as `RUNTIME.ABORTED { phase: 'encode' }`.

Codec bodies that ignore `ctx.signal` complete in the background (cooperative cancellation); aborts still surface to the caller as `RUNTIME.ABORTED`.

See [ADR 204 — Single-Path Async Codec Runtime](../../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) for the codec runtime's async boundary contract, and [ADR 207 — Codec call context: per-query `AbortSignal` and column metadata](../../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) for the per-call context shape.
