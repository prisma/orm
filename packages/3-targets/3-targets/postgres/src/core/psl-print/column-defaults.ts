import type { ContractEnum } from '@internal/contract/types';
import type { SqlPslPrintContext } from '@internal/family-sql/control';
import { mapDefault } from '@internal/family-sql/psl-ast';
import type { PslFieldAttribute } from '@internal/framework-components/psl-ast';
import type { StorageColumn } from '@internal/sql-contract/types';
import { PG_TEXT_CODEC_ID } from '../codec-ids';
import {
  buildAttribute,
  parseDefaultAttributeString,
  positionalArg,
} from '../psl-ast/psl-literals';
import { refuseDefaultOutsideEnum, refuseUnwritableLiteralDefault } from './refusals';

/**
 * The `@default(…)` attribute for a storage column, or `undefined` when the column carries no
 * default.
 *
 * A literal prints as the PSL literal the data type of the column's codec reads back, through the
 * stack's data types, with the mapping `contract infer` uses. An enum column's default is a member
 * name, which reads as text; a domain enum's literal prints as the member name that carries it.
 * `now()` and `autoincrement()` print by name; every other function default prints as a `sql`
 * tagged literal.
 *
 * A literal is refused when the column's codec has no data type in the stack, or when no PSL
 * literal of that data type reads back as the stored value.
 */
export function buildColumnDefault(input: {
  readonly column: StorageColumn;
  readonly pslTypeName: string;
  readonly isEnum: boolean;
  /** The domain enum the column is typed by, whose member names are the accepted default form. */
  readonly domainEnum: ContractEnum | undefined;
  readonly namespaceId: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly context: SqlPslPrintContext;
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
      refuseDefaultOutsideEnum({
        coordinate,
        value: columnDefault.value,
        pslTypeName: input.pslTypeName,
      });
    }
    return buildAttribute('field', 'default', [positionalArg(memberName)]);
  }

  const { context } = input;
  const result = mapDefault(columnDefault, {
    dataTypeEntries: context.authoringContributions.dataTypes,
    dataTypes: context.dataTypeLookup,
    columnDataType: context.codecLookup.descriptorFor?.(
      input.isEnum ? PG_TEXT_CODEC_ID : input.column.codecId,
    )?.dataType,
    list: input.column.many === true,
  });
  if (result === undefined) {
    refuseUnwritableLiteralDefault({
      coordinate,
      written:
        columnDefault.kind === 'literal'
          ? JSON.stringify(columnDefault.value)
          : columnDefault.expression,
      pslTypeName: input.pslTypeName,
    });
  }
  return parseDefaultAttributeString(result.attribute);
}
