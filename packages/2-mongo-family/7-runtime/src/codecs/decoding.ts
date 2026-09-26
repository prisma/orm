import type { CodecCallContext } from '@internal/framework-components/codec';
import { runtimeError } from '@internal/framework-components/runtime';
import type { MongoFieldShape, MongoResultShape } from '@internal/mongo-query-ast/execution';
import { blindCast } from '@internal/utils/casts';
import { isStructuredError } from '@internal/utils/structured-error';
import type { MongoCodecLookup } from '../mongo-execution-stack';

const WIRE_PREVIEW_LIMIT = 100;

function previewWireValue(wireValue: unknown): string {
  if (typeof wireValue === 'string') {
    return wireValue.length > WIRE_PREVIEW_LIMIT
      ? `${wireValue.substring(0, WIRE_PREVIEW_LIMIT)}...`
      : wireValue;
  }
  return String(wireValue).substring(0, WIRE_PREVIEW_LIMIT);
}

/**
 * Every decode failure names the collection and field. A codec's own `RUNTIME.DECODE_FAILED` keeps its code and details, with the location added; any other structured envelope (a dotted `code`, per `isStructuredError`) passes through unchanged; everything else is wrapped in a `RUNTIME.DECODE_FAILED` envelope. The original error is the `cause`.
 */
function wrapDecodeFailure(
  error: unknown,
  collection: string,
  path: string,
  codecId: string,
  wireValue: unknown,
): never {
  const codecDetails = isStructuredError(error) ? error.meta : undefined;
  if (isStructuredError(error) && error.code !== 'RUNTIME.DECODE_FAILED') {
    throw error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = runtimeError(
    'RUNTIME.DECODE_FAILED',
    `Failed to decode field ${path} in collection '${collection}' with codec '${codecId}': ${message}`,
    {
      ...codecDetails,
      collection,
      path,
      codec: codecId,
      wirePreview: previewWireValue(wireValue),
    },
  );
  wrapped.cause = error;
  throw wrapped;
}

export async function decodeMongoRow(
  row: unknown,
  shape: MongoResultShape,
  registry: MongoCodecLookup,
  collection: string,
  ctx: CodecCallContext = {},
): Promise<unknown> {
  if (shape.kind === 'unknown') {
    return row;
  }
  if (typeof row !== 'object' || row === null) {
    return row;
  }
  const rowObj = blindCast<Record<string, unknown>, 'a non-null object row is a document'>(row);
  const out: Record<string, unknown> = {};
  const tasks: Array<Promise<void>> = [];

  function scheduleLeaf(
    path: string,
    codecId: string,
    wire: unknown,
    assign: (v: unknown) => void,
  ): void {
    const codec = registry.get(codecId);
    if (!codec) {
      assign(wire);
      return;
    }
    tasks.push(
      (async () => {
        try {
          assign(await codec.decode(wire, ctx));
        } catch (error) {
          wrapDecodeFailure(error, collection, path, codecId, wire);
        }
      })(),
    );
  }

  function walkField(
    value: unknown,
    fieldShape: MongoFieldShape,
    path: string,
    assign: (v: unknown) => void,
  ): void {
    // Exhaustive over `MongoFieldShape['kind']` by construction:
    // adding a new variant must add a corresponding arm or the
    // `satisfies never` below would error at type-check time.
    switch (fieldShape.kind) {
      case 'unknown':
        assign(value);
        return;
      case 'leaf':
        if (value === null || value === undefined) {
          assign(value);
          return;
        }
        scheduleLeaf(path, fieldShape.codecId, value, assign);
        return;
      case 'document': {
        if (value === null || value === undefined) {
          assign(value);
          return;
        }
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          assign(value);
          return;
        }
        const vObj = blindCast<
          Record<string, unknown>,
          'a non-null, non-array object value is a subdocument'
        >(value);
        // Pre-seed with a shallow copy so unshaped subdocument keys
        // round-trip verbatim. Subsequent walkField assignments overwrite
        // shaped keys with their decoded values. Mirrors the top-level
        // pass-through invariant — the decode path is structurally
        // additive at every nesting depth, not just the root.
        const nested: Record<string, unknown> = { ...vObj };
        assign(nested);
        for (const [fk, fShape] of Object.entries(fieldShape.fields)) {
          walkField(vObj[fk], fShape, `${path}.${fk}`, (v) => {
            nested[fk] = v;
          });
        }
        return;
      }
      case 'array': {
        if (value === null || value === undefined) {
          assign(value);
          return;
        }
        if (!Array.isArray(value)) {
          assign(value);
          return;
        }
        const arr: unknown[] = [];
        assign(arr);
        for (let i = 0; i < value.length; i++) {
          const el = value[i];
          walkField(el, fieldShape.element, `${path}.${i}`, (v) => {
            arr[i] = v;
          });
        }
        return;
      }
    }
    // The switch above is exhaustive over `MongoFieldShape['kind']`. The
    // `satisfies never` below is a compile-time guard that fails if a new
    // variant is added without a corresponding arm.
    /* v8 ignore start */
    fieldShape satisfies never;
    /* v8 ignore stop */
  }

  for (const [k, fShape] of Object.entries(shape.fields)) {
    walkField(rowObj[k], fShape, k, (v) => {
      out[k] = v;
    });
  }

  // Pass through any row fields the shape does not describe. The shape is a
  // partial, lane-vouched description of what the runtime knows how to decode;
  // fields outside that description (e.g. polymorphic variant fields the base
  // model's shape doesn't enumerate, sidecar fields a future schema migration
  // adds) round-trip verbatim. Drop semantics belongs to explicit projection
  // (`select` / `$project`), not to the structural decode path.
  for (const k of Object.keys(rowObj)) {
    if (!Object.hasOwn(shape.fields, k)) {
      out[k] = rowObj[k];
    }
  }

  await Promise.all(tasks);
  return out;
}
