import { dataTypeParams } from '@internal/framework-components/codec';
import {
  isSqlDataType,
  renderSqlTypeName,
  type SqlDataType,
} from '@internal/sql-contract/data-type';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../../src/core/codecs';
import { postgresDataTypes } from '../../src/core/data-types';
import {
  alterTypeCheckText,
  buildExpectedFormatType,
} from '../../src/core/migrations/planner-sql-checks';
import { postgresTypeLookups } from '../postgres-type-lookups';
import { writtenTypeSamples } from './written-type-samples';

const where = 'alterColumnType({ table: "User", column: "age" })';

describe('alterTypeCheckText', () => {
  it('gives the text format_type prints for a type as a migration writes it', () => {
    expect(
      ['int4', 'integer', 'varchar(20)', 'numeric(10)', 'timestamptz(3)', 'int4[]', 'TEXT'].map(
        (type) => alterTypeCheckText(type, postgresDataTypes, where),
      ),
    ).toEqual([
      'integer',
      'integer',
      'character varying(20)',
      'numeric(10,0)',
      'timestamp(3) with time zone',
      'integer[]',
      'text',
    ]);
  });

  it('names an enum by its quoted name, quoted where Postgres quotes it, and without public', () => {
    expect(
      ['"Mood"', '"app"."status"', '"app"."Status"', '"public"."Mood"', '"public"."mood"'].map(
        (type) => alterTypeCheckText(type, postgresDataTypes, where),
      ),
    ).toEqual(['"Mood"', 'app.status', 'app."Status"', '"Mood"', 'mood']);
  });

  it('refuses a type no data type of the stack reads, naming the text and where it was written', () => {
    expect(() => alterTypeCheckText('int9', postgresDataTypes, where)).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.COLUMN_TYPE_UNREADABLE',
        message: `${where}: no data type of the configured stack reads the type "int9"`,
        meta: { type: 'int9', where },
      }),
    );
    expect(() => alterTypeCheckText('mood', postgresDataTypes, where)).toThrow(
      expect.objectContaining({ code: 'MIGRATION.COLUMN_TYPE_UNREADABLE' }),
    );
  });

  it('agrees with the planner check for every written text of every Postgres data type', () => {
    const sqlTypes = postgresDataTypes.filter(isSqlDataType);
    const compared = new Set<string>();
    const disagreements = sqlTypes.flatMap((type: SqlDataType) =>
      writtenTypeSamples(type).flatMap((params) => {
        const written = renderSqlTypeName(type, params);
        const codecId = codecOf(type);
        if (codecId === undefined) return [];
        compared.add(type.id);
        const expected = buildExpectedFormatType(
          { codecId, typeParams: dataTypeParams(type, params) },
          postgresTypeLookups,
        );
        const derived = alterTypeCheckText(written, postgresDataTypes, where);
        const derivedArray = alterTypeCheckText(`${written}[]`, postgresDataTypes, where);
        return derived === expected && derivedArray === `${expected}[]`
          ? []
          : [{ type: type.id, written, expected, derived, derivedArray }];
      }),
    );
    expect(disagreements).toEqual([]);
    const withCodec = sqlTypes.filter(
      (type) => codecOf(type) !== undefined && writtenTypeSamples(type).length > 0,
    );
    expect([...compared].sort()).toEqual(withCodec.map(({ id }) => id).sort());
    expect(compared.size).toBeGreaterThan(20);
  });
});

function codecOf(type: SqlDataType): string | undefined {
  return codecDescriptors.find((descriptor) => descriptor.dataType === type.id)?.codecId;
}
