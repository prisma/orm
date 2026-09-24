import type { ContractEnum } from '@internal/contract/types';
import { mapDefault } from '@internal/family-sql/psl-infer';
import type { PslFieldAttribute } from '@internal/framework-components/psl-ast';
import type { StorageColumn } from '@internal/sql-contract/types';
import { postgresError } from '../errors';
import { dataTypeForCodec } from '../psl-infer/infer-default-codec';
import { createPostgresDefaultMapping } from '../psl-infer/postgres-default-mapping';
import {
  buildAttribute,
  parseDefaultAttributeString,
  positionalArg,
} from '../psl-infer/psl-literals';

const defaultMapping = createPostgresDefaultMapping();

/**
 * The `@default(…)` attribute for a storage column, or `undefined` when the
 * column carries no default.
 *
 * A literal prints as the PSL literal the data type of the column's codec reads
 * back, the same mapping `contract infer` uses; a domain enum's literal prints
 * as the member name that carries it; `now()` and `autoincrement()` print by
 * name; every other function default prints as a `sql` tagged literal.
 *
 * A literal is refused when the column's codec has no Postgres data type, or
 * when no PSL literal of that data type reads back as the stored value.
 */
export function printColumnDefault(input: {
  readonly column: StorageColumn;
  readonly pslTypeName: string;
  readonly isEnum: boolean;
  /** The domain enum the column is typed by, whose member names are the accepted default form. */
  readonly domainEnum: ContractEnum | undefined;
  readonly namespaceId: string;
  readonly tableName: string;
  readonly columnName: string;
}): PslFieldAttribute | undefined {
  const columnDefault = input.column.default;
  if (columnDefault === undefined) {
    return undefined;
  }
  const coordinate = `"${input.namespaceId}"."${input.tableName}"."${input.columnName}"`;

  if (input.domainEnum !== undefined && columnDefault.kind === 'literal') {
    const memberName = input.domainEnum.members.find(
      (member) => member.value === columnDefault.value,
    )?.name;
    if (memberName === undefined) {
      throw postgresError(
        'CONTRACT.PRINT_UNSUPPORTED',
        `contract print: column ${coordinate} defaults to ${JSON.stringify(columnDefault.value)}, which is not a member of enum ${input.pslTypeName}.`,
        {
          why: 'A default on a domain enum column is written as the member name, and no member carries this value.',
          fix: 'Give the column a default that is one of the enum members, or drop it.',
          meta: { coordinate, pslTypeName: input.pslTypeName },
        },
      );
    }
    return buildAttribute('field', 'default', [positionalArg(memberName)]);
  }

  const result = mapDefault(columnDefault, {
    ...defaultMapping,
    columnDataType: dataTypeForCodec(input.column.codecId, input.isEnum),
    list: input.column.many === true,
  });
  if (result === undefined) {
    throw postgresError(
      'CONTRACT.PRINT_UNSUPPORTED',
      `contract print: column ${coordinate} has a default that cannot be written in Prisma 8 PSL: no data type the ${input.pslTypeName} type takes writes ${columnDefault.kind === 'literal' ? JSON.stringify(columnDefault.value) : columnDefault.expression}.`,
      {
        why: 'Writing the value in any other form would parse, but the PSL source would read it back as a different value.',
        fix: 'Replace the default with a database expression default, or drop the default before printing.',
        meta: { coordinate, pslTypeName: input.pslTypeName },
      },
    );
  }
  return parseDefaultAttributeString(result.attribute);
}
