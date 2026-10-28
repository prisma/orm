import type { ColumnDefault } from '@internal/contract/types';
import {
  type DataTypeSupport,
  printTaggedLiteral,
  writeTypedLiteral,
} from '@internal/framework-components/authoring';
import type { CodecDescriptor } from '@internal/framework-components/codec';
import { SQL_EXPRESSION_TAG } from '@internal/sql-contract/sql-expression';
import { ifDefined } from '@internal/utils/defined';

const DEFAULT_FUNCTION_ATTRIBUTES: Readonly<Record<string, string>> = {
  'autoincrement()': '@default(autoincrement())',
  'now()': '@default(now())',
};

export interface DefaultMappingOptions {
  readonly functionAttributes?: Readonly<Record<string, string>>;
  /** The stack's data types, whose casts say which other types' values each one takes, with the authoring entries that write them. */
  readonly dataTypes?: DataTypeSupport | undefined;
  /** The column's codec, whose data type a default is written in. */
  readonly columnCodec?: Pick<CodecDescriptor, 'dataType'> | undefined;
  /** The column's type parameters, under which a shorter literal can read back as the stored value, as `-0.5` does on `numeric(65,30)`. */
  readonly typeParams?: unknown;
  /**
   * Whether the column is a list, whose elements each carry the column's own data type. A written
   * list on a scalar column goes through that type's list cast instead.
   */
  readonly list?: boolean;
}

export type DefaultMappingResult = { readonly attribute: string };

/**
 * The attribute a stored default prints as: a named function, a literal the column takes, or any
 * other expression as a `sql` literal. `undefined` when a literal has no written form. An expression
 * prints even when the literal would read back as different text: default expressions are compared
 * with case and whitespace ignored (`SqlColumnDefaultIR.isEqualTo`), and canonicalization changes only
 * whitespace (ADR 129).
 */
export function mapDefault(
  columnDefault: ColumnDefault,
  options?: DefaultMappingOptions,
): DefaultMappingResult | undefined {
  switch (columnDefault.kind) {
    case 'literal': {
      const text = writeTypedLiteral(columnDefault.value, {
        dataTypes: options?.dataTypes,
        dataType: options?.columnCodec?.dataType,
        typeParams: options?.typeParams,
        ...ifDefined('list', options?.list),
      });
      return text === undefined ? undefined : { attribute: `@default(${text})` };
    }
    case 'function': {
      const attribute =
        options?.functionAttributes?.[columnDefault.expression] ??
        DEFAULT_FUNCTION_ATTRIBUTES[columnDefault.expression] ??
        `@default(${printTaggedLiteral(SQL_EXPRESSION_TAG, columnDefault.expression)})`;
      return { attribute };
    }
  }
}
