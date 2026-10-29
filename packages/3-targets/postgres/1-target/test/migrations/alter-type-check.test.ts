import {
  isSqlDataType,
  renderSqlCatalogText,
  renderSqlTypeName,
  type SqlDataType,
} from '@internal/sql-contract/data-type';
import { describe, expect, it } from 'vitest';
import { postgresDataTypes } from '../../src/core/data-types';
import { alterTypeCheck } from '../../src/core/migrations/planner-sql-checks';
import { writtenTypeSamples } from './written-type-samples';

const where = 'alterColumnType({ table: "User", column: "age" })';

const catalogText = (text: string) => ({ kind: 'catalog-text', text });
const identity = (typeName: string, many = false) => ({ kind: 'identity', typeName, many });

describe('alterTypeCheck', () => {
  it('compares a type that claims no kind by the text format_type prints for it', () => {
    expect(
      ['int4', 'integer', 'varchar(20)', 'numeric(10)', 'timestamptz(3)', 'int4[]', 'TEXT'].map(
        (type) => alterTypeCheck(type, postgresDataTypes, where),
      ),
    ).toEqual([
      catalogText('integer'),
      catalogText('integer'),
      catalogText('character varying(20)'),
      catalogText('numeric(10,0)'),
      catalogText('timestamp(3) with time zone'),
      catalogText('integer[]'),
      catalogText('text'),
    ]);
  });

  it('compares a date or time type by the text format_type prints for its precision as written', () => {
    expect(
      ['timestamptz', 'timestamptz(6)', 'time', 'timetz(6)', 'interval'].map((type) =>
        alterTypeCheck(type, postgresDataTypes, where),
      ),
    ).toEqual([
      catalogText('timestamp with time zone'),
      catalogText('timestamp(6) with time zone'),
      catalogText('time without time zone'),
      catalogText('time(6) with time zone'),
      catalogText('interval'),
    ]);
  });

  it('compares an enum by identity, by the name its data type renders, whatever schema it is in', () => {
    expect(
      ['"Mood"', '"app"."status"', '"app"."Status"', '"public"."Mood"', '"Mood"[]'].map((type) =>
        alterTypeCheck(type, postgresDataTypes, where),
      ),
    ).toEqual([
      identity('"Mood"'),
      identity('"app"."status"'),
      identity('"app"."Status"'),
      identity('"Mood"'),
      identity('"Mood"', true),
    ]);
  });

  it('checks a raw type, which its text names, by that text as written, list included', () => {
    expect(
      ['circle', 'cidr[]', '"LTree"', 'character varying(3)'].map((type) =>
        alterTypeCheck(type, postgresDataTypes, where, true),
      ),
    ).toEqual([
      catalogText('circle'),
      catalogText('cidr[]'),
      catalogText('"LTree"'),
      catalogText('character varying(3)'),
    ]);
  });

  it('refuses a raw text that is not one type name, naming the call', () => {
    expect(() => alterTypeCheck('text DEFAULT $a$x$a$', postgresDataTypes, where, true)).toThrow(
      expect.objectContaining({ code: 'MIGRATION.COLUMN_TYPE_UNREADABLE' }),
    );
  });

  it('refuses a type no data type of the stack reads, naming the text and where it was written', () => {
    expect(() => alterTypeCheck('int9', postgresDataTypes, where)).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.COLUMN_TYPE_UNREADABLE',
        message: `${where}: no data type of the configured stack reads the type "int9"`,
        meta: { type: 'int9', where },
      }),
    );
    expect(() => alterTypeCheck('mood', postgresDataTypes, where)).toThrow(
      expect.objectContaining({ code: 'MIGRATION.COLUMN_TYPE_UNREADABLE' }),
    );
  });

  it('gives the catalog text of the parameters as written for every written text of every Postgres data type', () => {
    const sqlTypes = postgresDataTypes.filter(
      (type): type is SqlDataType => isSqlDataType(type) && type.sql.claimsKind === undefined,
    );
    const compared = new Set<string>();
    const disagreements = sqlTypes.flatMap((type) =>
      writtenTypeSamples(type).flatMap((params) => {
        const written = renderSqlTypeName(type, params);
        compared.add(type.id);
        const expected = renderSqlCatalogText(type, params);
        const derived = alterTypeCheck(written, postgresDataTypes, where);
        const derivedList = alterTypeCheck(`${written}[]`, postgresDataTypes, where);
        return JSON.stringify([derived, derivedList]) ===
          JSON.stringify([catalogText(expected), catalogText(`${expected}[]`)])
          ? []
          : [{ type: type.id, written, expected, derived, derivedList }];
      }),
    );
    expect(disagreements).toEqual([]);
    expect(compared.size).toBeGreaterThan(20);
  });
});
