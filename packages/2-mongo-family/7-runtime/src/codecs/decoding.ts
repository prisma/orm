import type { CodecCallContext } from '@internal/framework-components/codec';
import { runtimeError } from '@internal/framework-components/runtime';
import type { MongoFieldShape, MongoResultShape } from '@internal/mongo-query-ast/execution';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { isInternalError } from '@internal/utils/internal-error';
import { isStructuredError } from '@internal/utils/structured-error';
import type { MongoCodecLookup } from '../mongo-execution-stack';

const WIRE_PREVIEW_LIMIT = 100;

function truncate(text: string): string {
  return text.length > WIRE_PREVIEW_LIMIT ? `${text.substring(0, WIRE_PREVIEW_LIMIT)}...` : text;
}

/**
 * JSON text of the wire value, using each BSON class's own JSON form (an `ObjectId` as its hex string, a `Date` as ISO text), or `String(value)` when it has none.
 */
function previewWireValue(wireValue: unknown): string {
  if (typeof wireValue === 'string') return truncate(wireValue);
  try {
    const json = JSON.stringify(wireValue, (_key, value: unknown) =>
      typeof value === 'bigint' ? `${value}n` : value,
    );
    return truncate(json ?? String(wireValue));
  } catch {
    return truncate(String(wireValue));
  }
}

function hasHexString(value: object): value is { toHexString(): string } {
  return 'toHexString' in value && typeof value.toHexString === 'function';
}

function describeDocumentId(id: unknown): string | undefined {
  if (id === undefined) return undefined;
  if (typeof id === 'string') return JSON.stringify(id);
  if (typeof id === 'object' && id !== null && hasHexString(id)) return id.toHexString();
  return previewWireValue(id);
}

/**
 * Every decode failure names the collection and field, and the `_id` of the document when the row carries one; inside a document shape marked `row`, that document's `_id` and the field's path from it. A codec's own `RUNTIME.DECODE_FAILED` keeps its code and details, with the location added; any other structured envelope (a dotted `code`, per `isStructuredError`) and an `InternalError` pass through unchanged; everything else is wrapped in a `RUNTIME.DECODE_FAILED` envelope. The original error is the `cause`.
 */
function wrapDecodeFailure(
  error: unknown,
  location: {
    readonly collection: string;
    readonly path: string;
    readonly documentId: string | undefined;
  },
  codecId: string,
  wireValue: unknown,
): never {
  if (isInternalError(error)) throw error;
  const codecDetails = isStructuredError(error) ? error.meta : undefined;
  if (isStructuredError(error) && error.code !== 'RUNTIME.DECODE_FAILED') {
    throw error;
  }
  const { collection, path, documentId } = location;
  const message = error instanceof Error ? error.message : String(error);
  const document = documentId === undefined ? '' : ` of the document with _id ${documentId}`;
  const wrapped = runtimeError(
    'RUNTIME.DECODE_FAILED',
    `Failed to decode field ${path}${document} in collection '${collection}' with codec '${codecId}': ${message}`,
    {
      ...codecDetails,
      collection,
      path,
      ...ifDefined('documentId', documentId),
      codec: codecId,
      wirePreview: previewWireValue(wireValue),
    },
  );
  wrapped.cause = error;
  throw wrapped;
}

/**
 * A document may leave out a nullable field entirely (Prisma 6 and the driver both omit it); the field's type says `null`, so an absent value reads as `null`.
 */
function absentAsNull(value: null | undefined, nullable: boolean): null | undefined {
  return value === undefined && nullable ? null : value;
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
    documentId: string | undefined,
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
          wrapDecodeFailure(error, { collection, path, documentId }, codecId, wire);
        }
      })(),
    );
  }

  function walkField(
    value: unknown,
    fieldShape: MongoFieldShape,
    path: string,
    documentId: string | undefined,
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
          assign(absentAsNull(value, fieldShape.nullable));
          return;
        }
        scheduleLeaf(path, documentId, fieldShape.codecId, value, assign);
        return;
      case 'document': {
        if (value === null || value === undefined) {
          assign(absentAsNull(value, fieldShape.nullable));
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
          walkField(
            vObj[fk],
            fShape,
            fieldShape.row ? fk : `${path}.${fk}`,
            fieldShape.row ? describeDocumentId(vObj['_id']) : documentId,
            (v) => {
              nested[fk] = v;
            },
          );
        }
        return;
      }
      case 'array': {
        if (value === null || value === undefined) {
          assign(absentAsNull(value, fieldShape.nullable));
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
          walkField(el, fieldShape.element, `${path}.${i}`, documentId, (v) => {
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

  const documentId = describeDocumentId(rowObj['_id']);
  for (const [k, fShape] of Object.entries(shape.fields)) {
    walkField(rowObj[k], fShape, k, documentId, (v) => {
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
