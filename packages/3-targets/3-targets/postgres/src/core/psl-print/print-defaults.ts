import type { ColumnDefault, ExecutionMutationDefaultValue } from '@internal/contract/types';
import { mapDefault } from '@internal/family-sql/psl-infer';
import type { PslFieldAttribute } from '@internal/framework-components/psl-ast';
import type { StorageColumn } from '@internal/sql-contract/types';
import { InternalError } from '@internal/utils/internal-error';
import { createPostgresDefaultMapping } from '../psl-infer/postgres-default-mapping';
import {
  buildAttribute,
  escapePslString,
  parseDefaultAttributeString,
  positionalArg,
} from '../psl-infer/psl-literals';

/**
 * The Postgres codecs whose literal default the PSL interpreter reads in a
 * form other than the token's: the inverse of `literalDefaultForm` in
 * `packages/2-sql/2-authoring/contract-psl/src/literal-default-forms.ts`,
 * which this package can only reach in tests (`print-defaults.test.ts`
 * asserts the two agree).
 */
export const BIGINT_LITERAL_CODEC_IDS: ReadonlySet<string> = new Set([
  'pg/int8@1',
  'pg/unboundedint@1',
]);
export const JSON_LITERAL_CODEC_IDS: ReadonlySet<string> = new Set(['pg/json@1', 'pg/jsonb@1']);

/**
 * The `@default(...)` attribute for a storage default. Function defaults go
 * through the same Postgres default mapping `contract infer` uses, so a raw
 * expression prints as `dbgenerated("…")` from one table. Literals print in
 * the form the PSL interpreter reads back into the same contract value: a
 * bigint codec's decimal text as a bare integer token, a JSON codec's value
 * as JSON text in a string literal, everything else as its own literal.
 */
export function printStorageDefault(
  columnDefault: ColumnDefault,
  column: StorageColumn,
  label: string,
): PslFieldAttribute {
  if (columnDefault.kind === 'function') {
    const mapped = mapDefault(columnDefault, createPostgresDefaultMapping());
    if (!('attribute' in mapped)) {
      throw new InternalError(
        `${label}: default expression "${columnDefault.expression}" has no Prisma 8 PSL spelling`,
      );
    }
    return parseDefaultAttributeString(mapped.attribute);
  }
  const { value } = columnDefault;
  if (column.many === true) {
    if (!Array.isArray(value)) {
      throw new InternalError(`${label}: list column default is not a list`);
    }
    const elements = value.map((element) => printLiteral(element, column.codecId, label));
    return buildAttribute('field', 'default', [positionalArg(`[${elements.join(', ')}]`)]);
  }
  return buildAttribute('field', 'default', [
    positionalArg(printLiteral(value, column.codecId, label)),
  ]);
}

function printLiteral(value: unknown, codecId: string, label: string): string {
  if (BIGINT_LITERAL_CODEC_IDS.has(codecId)) {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
    if (text === undefined || !/^-?\d+$/.test(text)) {
      throw new InternalError(
        `${label}: bigint default ${JSON.stringify(value)} is not an integer`,
      );
    }
    return text;
  }
  if (JSON_LITERAL_CODEC_IDS.has(codecId)) {
    return `"${escapePslString(JSON.stringify(value))}"`;
  }
  if (typeof value === 'string') return `"${escapePslString(value)}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new InternalError(
    `${label}: literal default ${JSON.stringify(value)} has no Prisma 8 PSL spelling`,
  );
}

/** The `@default(<generator>)` attribute for an on-create execution generator. */
export function printGeneratorDefault(
  generator: ExecutionMutationDefaultValue,
  label: string,
): PslFieldAttribute {
  const call = generatorCall(generator);
  if (call === undefined) {
    throw new InternalError(
      `${label}: execution generator "${generator.id}" has no Prisma 8 PSL spelling`,
    );
  }
  return buildAttribute('field', 'default', [positionalArg(call)]);
}

function generatorCall(generator: ExecutionMutationDefaultValue): string | undefined {
  switch (generator.id) {
    case 'uuidv4':
      return 'uuid(4)';
    case 'uuidv7':
      return 'uuid(7)';
    case 'cuid2':
      return 'cuid(2)';
    case 'ulid':
      return 'ulid()';
    case 'nanoid': {
      const size = generator.params?.['size'];
      return typeof size === 'number' ? `nanoid(${size})` : 'nanoid()';
    }
    default:
      return undefined;
  }
}
