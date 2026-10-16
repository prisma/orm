import type { DataTypeId } from '@internal/framework-components/codec';
import { dataTypeId } from '@internal/framework-components/codec';
import { structuredError } from '@internal/utils/structured-error';
import { type } from 'arktype';
import { type SqlDataType, sqlDataType } from './sql-data-type';

export const SQL_RAW_DATA_TYPE_ID: DataTypeId = dataTypeId('sql/raw');

export type SqlRawTypeParams = { readonly sql: string };

const WORD = '[A-Za-z0-9_]+';
const QUOTED_NAME = '"(?:[^"]|"")+"';
const NAME = `(?:${WORD}|${QUOTED_NAME})`;
const PARENTHESES = '\\((?:[A-Za-z0-9_, ]|-(?=[0-9]))*\\)';
const TOKEN = `${NAME}(?:${PARENTHESES})?`;

/**
 * The texts a raw type may be: words and double-quoted names, with each double quote inside doubled, separated by single spaces, the first
 * optionally after one schema name and a dot, each optionally followed by parentheses holding only
 * letters, digits, underscores, commas, spaces and a minus sign before a digit, then at most one
 * `[]`. Postgres prints a schema only for a type off the `search_path` that is not a base type.
 */
const RAW_TYPE_TEXT = new RegExp(`^(?:${NAME}\\.)?${TOKEN}(?: ${TOKEN})*(?:\\[\\])?$`);

/** Returns undefined when `text` may be written as a column's type, else the reason. */
export function checkRawTypeText(text: string): string | undefined {
  return RAW_TYPE_TEXT.test(text)
    ? undefined
    : 'A raw type is one type name as the database catalog prints it, such as tsvector, double precision, geometry(Point,4326), app.email or "MyType"[]: words of letters, digits and underscores separated by single spaces, or double-quoted names with each double quote inside doubled; the first optionally after one schema name and a dot; each optionally followed by parentheses holding only letters, digits, underscores, commas, spaces and a minus sign before a digit; and at most one trailing [].';
}

const sqlRawParams = type({ sql: 'string' }).narrow((params, ctx) => {
  const refused = checkRawTypeText(params.sql);
  return refused === undefined || ctx.reject({ path: ['sql'], message: refused });
});

/**
 * The refusal of a literal value of a raw column, which has none: Prisma does not interpret a raw
 * column's values. Every literal default reaches it through the data type's canonical form.
 */
function refuseLiteralValue(): never {
  throw structuredError(
    'CONTRACT.LITERAL_VALUES_ABSENT',
    'A raw column has no literal values, so its default cannot be a literal. Write the default as a SQL expression: sql`...`.',
    {
      why: 'Prisma does not interpret the values of a raw column, so it cannot write or compare a literal of its type.',
      fix: 'Write the default as a sql expression, such as @default(sql`...`) in a schema or .default(sql`...`) in TypeScript.',
    },
  );
}

/**
 * The data type of a column whose type no other data type claims. Its `sql` parameter is the type
 * exactly as the database catalog prints it, which migrations write and verify compares. It claims
 * no reported type, so introspection never reads a column as raw. It has no literal values: it
 * declares no casts, and its canonical form refuses every value. ADR 273.
 */
export const sqlRawDataType: SqlDataType<SqlRawTypeParams> = sqlDataType<SqlRawTypeParams>(
  SQL_RAW_DATA_TYPE_ID,
  {
    params: sqlRawParams,
    nameIsCatalogText: true,
    render: ({ sql }) => sql,
    toCanonicalForm: refuseLiteralValue,
  },
);
