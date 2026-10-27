import { generatedIdColumnAliases } from '@internal/sql-contract/generated-id-column-aliases';
import { describe, expect, it } from 'vitest';
import sqlFamilyPack, { sqlTargetTypeConstructors } from '../src/exports/pack';

describe('sql family pack authoring contributions', () => {
  it('contributes Raw, whose argument is a sql expression, and the generated id column aliases in sql', () => {
    expect(sqlFamilyPack.authoring.type).toEqual({
      Raw: {
        kind: 'typeConstructor',
        documentation:
          'A column of a type no other column type covers, written exactly as the database catalog prints it, such as Raw(sql`tsvector`). Its values are typed unknown, and its default is a sql expression.',
        args: [{ kind: 'value', dataType: 'sql/expression', name: 'sql' }],
        output: { codecId: 'sql/raw@1', typeParams: { sql: { kind: 'arg', index: 0 } } },
      },
      sql: generatedIdColumnAliases,
    });
  });

  it('registers sql/expression with its authoring entry, so the TypeScript builder reads sql values', () => {
    expect({
      dataTypes: sqlFamilyPack.dataTypes.map((type) => type.id),
      entries: Object.keys(sqlFamilyPack.authoring.dataTypes),
    }).toEqual({ dataTypes: ['sql/expression'], entries: ['sql/expression'] });
  });

  it('builds sql.String and sql.Char for a target, whose length is a value of the target’s size type', () => {
    expect(sqlTargetTypeConstructors({ sizeType: 'pg/int4' })).toEqual({
      sql: {
        String: {
          kind: 'typeConstructor',
          documentation: 'Variable-length text with a required maximum character length.',
          args: [{ kind: 'value', dataType: 'pg/int4', name: 'length' }],
          output: { codecId: 'sql/varchar@1', typeParams: { length: { kind: 'arg', index: 0 } } },
        },
        Char: {
          kind: 'typeConstructor',
          documentation: 'Fixed-length text with a required character length.',
          args: [{ kind: 'value', dataType: 'pg/int4', name: 'length' }],
          output: { codecId: 'sql/char@1', typeParams: { length: { kind: 'arg', index: 0 } } },
        },
      },
    });
  });
});
