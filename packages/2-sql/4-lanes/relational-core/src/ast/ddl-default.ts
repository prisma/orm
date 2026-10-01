import type { ColumnDefaultLiteralInputValue, JsonValue } from '@internal/contract/types';
import type { Codec, CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { codecForRef } from '@internal/framework-components/codec';
import { ifDefined } from '@internal/utils/defined';
import { isInternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';
import type { CodecRef } from './codec-types';

/** What a literal default renders as in DDL: SQL NULL, or the wire value the column's codec encoded. */
export type EncodedLiteralDefault =
  | { readonly kind: 'sql-null' }
  | { readonly kind: 'wire'; readonly wire: unknown };

/** The column whose default is rendered, which a refusal names. */
export interface LiteralDefaultColumn {
  readonly table: string;
  readonly column: string;
}

/**
 * Reads a column's literal default with the column's codec, built with its type parameters, and encodes it for the DDL renderer to inline. `undefined` when no codec descriptor has the column's codec id, so the renderer inlines the value as written.
 *
 * A `Date` is the one authored value JSON has no notation for, so it is encoded as it is. A `null` the codec refuses is SQL NULL, because SQL NULL has no stored form of its own; a codec that reads `null` (a JSON codec) makes it the JSON value null. Any other value the codec refuses is a `CONTRACT.DEFAULT_INVALID` naming the column.
 */
export async function encodeLiteralDefault(
  codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'>,
  codecRef: CodecRef,
  value: ColumnDefaultLiteralInputValue,
  where: LiteralDefaultColumn,
): Promise<EncodedLiteralDefault | undefined> {
  const codec = codecForRef(codecLookup, codecRef);
  if (codec === undefined) return undefined;
  if (value instanceof Date) return { kind: 'wire', wire: await codec.encode(value, {}) };
  return encodeWithCodec(codec, value, (cause) =>
    refusedDefault(where, codecRef.codecId, value, undefined, cause),
  );
}

/**
 * Reads and encodes each element of a list column's literal default with the column's codec, as {@link encodeLiteralDefault} does a single value, so a `null` element the codec refuses is SQL NULL. `undefined` when no codec descriptor has the column's codec id. An element the codec refuses is a `CONTRACT.DEFAULT_INVALID` naming the column and the element's 1-based position.
 */
export async function encodeListLiteralDefault(
  codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'>,
  codecRef: CodecRef,
  elements: readonly JsonValue[],
  where: LiteralDefaultColumn,
): Promise<readonly EncodedLiteralDefault[] | undefined> {
  const codec = codecForRef(codecLookup, codecRef);
  if (codec === undefined) return undefined;
  return Promise.all(
    elements.map((element, index) =>
      encodeWithCodec(codec, element, (cause) =>
        refusedDefault(where, codecRef.codecId, element, index + 1, cause),
      ),
    ),
  );
}

async function encodeWithCodec(
  codec: Codec,
  value: JsonValue,
  refused: (cause: unknown) => Error,
): Promise<EncodedLiteralDefault> {
  let decoded: unknown;
  try {
    decoded = codec.decodeJson(value);
  } catch (error) {
    if (isInternalError(error)) throw error;
    if (value === null) return { kind: 'sql-null' };
    throw refused(error);
  }
  return { kind: 'wire', wire: await codec.encode(decoded, {}) };
}

function refusedDefault(
  where: LiteralDefaultColumn,
  codecId: string,
  value: JsonValue,
  elementPosition: number | undefined,
  cause: unknown,
): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const subject =
    elementPosition === undefined ? 'default' : `default (element ${elementPosition})`;
  return structuredError(
    'CONTRACT.DEFAULT_INVALID',
    `Column "${where.table}"."${where.column}" has a ${subject} its codec ${codecId} refuses: ${reason}`,
    {
      why: "A contract.json that an earlier version emitted, or a migration.ts it planned, can hold a default that this version's codec refuses, and so can either file after a hand edit.",
      fix: 'If contract.json holds the default, emit the contract again with this version, and correct the default in the contract source if emit refuses it. If a migration.ts sets it, correct it in that file.',
      cause,
      meta: {
        table: where.table,
        column: where.column,
        codecId,
        value,
        ...ifDefined('elementPosition', elementPosition),
        reason: 'codec-refused-default',
      },
    },
  );
}
