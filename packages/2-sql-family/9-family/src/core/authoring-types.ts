import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { generatedIdColumnAliases } from '@internal/sql-contract/generated-id-column-aliases';

export const sqlFamilyAuthoringTypes = {
  Raw: {
    kind: 'typeConstructor',
    documentation:
      'A column of a type no other column type covers, written exactly as the database catalog prints it, such as Raw(sql`tsvector`). Its values are typed unknown, and its default is a sql expression.',
    args: [{ kind: 'value', dataType: 'sql/expression', name: 'sql' }],
    output: {
      codecId: 'sql/raw@1',
      typeParams: { sql: { kind: 'arg', index: 0 } },
    },
  },
  sql: generatedIdColumnAliases,
} as const satisfies AuthoringTypeNamespace;

/**
 * The type constructors every SQL target contributes itself, because their arguments are sizes, such as a length, and only the target names the data type a size is a value of: `sizeType`, such as `pg/int4`.
 */
export function sqlTargetTypeConstructors<const SizeType extends string>(input: {
  readonly sizeType: SizeType;
}) {
  return {
    sql: {
      String: {
        kind: 'typeConstructor',
        documentation: 'Variable-length text with a required maximum character length.',
        args: [{ kind: 'value', dataType: input.sizeType, name: 'length' }],
        output: {
          codecId: 'sql/varchar@1',
          typeParams: {
            length: { kind: 'arg', index: 0 },
          },
        },
      },
      Char: {
        kind: 'typeConstructor',
        documentation: 'Fixed-length text with a required character length.',
        args: [{ kind: 'value', dataType: input.sizeType, name: 'length' }],
        output: {
          codecId: 'sql/char@1',
          typeParams: {
            length: { kind: 'arg', index: 0 },
          },
        },
      },
    },
  } as const satisfies AuthoringTypeNamespace;
}
