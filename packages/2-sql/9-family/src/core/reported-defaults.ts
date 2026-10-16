/**
 * Reading the literal defaults a database reports, during introspection (ADR 254): the target takes the literal's body out of the reported text, and the column's codec reads it with `fromWire`, then `toDataTypeValue`. The column's codec comes from the contract of the space that declares the column.
 */

import type { ColumnDefault, JsonValue } from '@internal/contract/types';
import type { Codec, CodecRef, DataTypeValue } from '@internal/framework-components/codec';
import { resolvedTypeParams } from '@internal/sql-contract/types';
import type { SqlDefaultValue } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { isInternalError } from '@internal/utils/internal-error';

/**
 * A reported literal default with the target's quoting, casts and escapes taken off: one body, or a list's element bodies with `null` for SQL NULL. A body is what the target's driver hands `fromWire` for a row of the column: text, a number where the driver returns one, or bytes.
 */
export type ReportedLiteralDefault =
  | { readonly kind: 'value'; readonly body: ReportedBody }
  | { readonly kind: 'list'; readonly elements: readonly (ReportedBody | null)[] };

/** One literal's body, as the driver would hand it over for a row: text, a number, or the bytes of a blob. */
export type ReportedBody = string | number | Uint8Array;

/** What the column's codec made of a reported literal default: the value, or the codec's reason it could not read it. */
export type ReadReportedDefault =
  | { readonly resolvedDefault: ColumnDefault; readonly defaultValue: SqlDefaultValue }
  | { readonly defaultUnreadable: string };

/** Reads a reported literal default with the column's codec. `raw` is the reported text, which a refusal quotes. */
export async function readReportedDefault(
  codec: Codec,
  literal: ReportedLiteralDefault,
  raw: string,
): Promise<ReadReportedDefault> {
  const unreadable = (error: unknown, element: string): ReadReportedDefault => {
    if (isInternalError(error)) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    return {
      defaultUnreadable: `The column codec ${codec.id} cannot read ${element}the default the database reports, ${raw}: ${reason}`,
    };
  };
  if (literal.kind === 'value') {
    try {
      const value = await readBody(codec, literal.body);
      return {
        resolvedDefault: { kind: 'literal', value: codec.dataType.toContract(value) },
        defaultValue: value,
      };
    } catch (error) {
      return unreadable(error, '');
    }
  }
  const values: (DataTypeValue | null)[] = [];
  for (const [index, body] of literal.elements.entries()) {
    try {
      values.push(body === null ? null : await readBody(codec, body));
    } catch (error) {
      return unreadable(error, `element ${index + 1} of `);
    }
  }
  return {
    resolvedDefault: {
      kind: 'literal',
      value: values.map((value) => (value === null ? null : codec.dataType.toContract(value))),
    },
    defaultValue: values,
  };
}

/** What introspection holds of a reported literal default: the codec's reading, and the value of the literal the contract's expression default writes, when it writes one the codec reads. */
export type ReadColumnDefault = ReadReportedDefault & {
  readonly defaultExpressionValue?: SqlDefaultValue;
};

/**
 * Reads a reported literal default with the column's codec, and, when the contract's default is an expression that writes a literal, that literal too, so the diff compares the two as values.
 */
export async function readColumnDefault(
  codec: Codec,
  reported: { readonly literal: ReportedLiteralDefault; readonly raw: string },
  written: { readonly literal: ReportedLiteralDefault; readonly expression: string } | undefined,
): Promise<ReadColumnDefault> {
  const read = await readReportedDefault(codec, reported.literal, reported.raw);
  if (written === undefined || !('defaultValue' in read)) return read;
  const writtenRead = await readReportedDefault(codec, written.literal, written.expression);
  return 'defaultValue' in writtenRead
    ? { ...read, defaultExpressionValue: writtenRead.defaultValue }
    : read;
}

async function readBody(codec: Codec, body: ReportedBody): Promise<DataTypeValue> {
  return codec.toDataTypeValue(await codec.fromWire(body, {}));
}

/** What introspection needs of a column the contract declares: its codec, and its default when that is an expression. */
export interface ContractColumn {
  readonly codecRef: CodecRef;
  readonly defaultExpression: string | undefined;
}

/** The columns a contract declares, for introspection to read each column's reported default with the column's codec. */
export interface ContractColumns {
  /** `table.column` in one of `namespaceIds`, or in any namespace when `undefined`. */
  columnOf(
    namespaceIds: readonly string[] | undefined,
    table: string,
    column: string,
  ): ContractColumn | undefined;
}

type Loose = Readonly<Record<string, unknown>>;

function isLoose(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null;
}

function child(value: unknown, key: string): Loose | undefined {
  if (!isLoose(value)) return undefined;
  const found = value[key];
  return isLoose(found) ? found : undefined;
}

/**
 * The columns `contract` declares. `contract` is a contract, or the namespaces of several contract spaces merged with each space's contract under `contracts`, as multi-space introspection receives them; a table's named types are then those of the space that declares it.
 */
export function contractColumns(contract: unknown): ContractColumns {
  const contracts =
    isLoose(contract) && Array.isArray(contract['contracts']) ? contract['contracts'] : [contract];
  return {
    columnOf(namespaceIds, table, column) {
      for (const space of contracts) {
        const storage = child(space, 'storage');
        const namespaces = child(storage, 'namespaces');
        if (namespaces === undefined) continue;
        for (const id of namespaceIds ?? Object.keys(namespaces)) {
          const declared = child(child(child(child(namespaces, id), 'entries'), 'table'), table);
          const found = child(child(declared, 'columns'), column);
          const codecId = found?.['codecId'];
          if (found === undefined || typeof codecId !== 'string') continue;
          const columnDefault = child(found, 'default');
          const expression = columnDefault?.['expression'];
          return {
            codecRef: columnCodecRef(codecId, found, child(storage, 'types')),
            defaultExpression:
              columnDefault?.['kind'] === 'function' && typeof expression === 'string'
                ? expression
                : undefined,
          };
        }
      }
      return undefined;
    },
  };
}

function columnCodecRef(codecId: string, column: Loose, namedTypes: Loose | undefined): CodecRef {
  const typeRef = column['typeRef'];
  const typeParams = column['typeParams'];
  const params = resolvedTypeParams(
    {
      typeParams: isLoose(typeParams) ? typeParams : undefined,
      typeRef: typeof typeRef === 'string' ? typeRef : undefined,
    },
    namedTypesOf(namedTypes),
  );
  const many = column['many'];
  return {
    codecId,
    ...ifDefined(
      'typeParams',
      params === undefined
        ? undefined
        : blindCast<JsonValue, 'type parameters in a contract are JSON'>(params),
    ),
    ...ifDefined('many', many !== undefined && many !== false ? true : undefined),
  };
}

function namedTypesOf(
  namedTypes: Loose | undefined,
): Readonly<Record<string, { readonly typeParams?: Record<string, unknown> }>> {
  const result: Record<string, { readonly typeParams?: Record<string, unknown> }> = {};
  for (const [name, entry] of Object.entries(namedTypes ?? {})) {
    const typeParams = child(entry, 'typeParams');
    result[name] = typeParams === undefined ? {} : { typeParams };
  }
  return result;
}
