import { type DataType, dataType } from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';
import {
  SQL_EXPRESSION_DATA_TYPE_ID,
  sqlExpressionDataType,
} from '@internal/sql-contract/sql-expression';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { enforceSqlDataTypeInvariants } from '../src/core/assembly';
import { createSqlFamilyInstance } from '../src/core/control-instance';

const int4 = sqlDataType('pg/int4', {
  read: (json) => json,
  texts: [{ text: 'int4', written: true }, { text: 'integer', catalog: true }, { text: 'int' }],
});
const numeric = sqlDataType('pg/numeric', {
  read: (json) => json,
  params: type({ 'precision?': 'number.integer >= 1' }),
  texts: [
    { text: 'numeric', written: true, catalog: true },
    { text: 'numeric({precision})', written: true, catalog: true },
  ],
});
const enumType = sqlDataType('pg/enum', {
  read: (json) => json,
  params: type({ typeName: 'string > 0' }),
  claimsKind: 'enum',
  render: ({ typeName }) => `"${typeName}"`,
});

const declaredWith = (extensionTypes: readonly DataType[]) => [
  { type: sqlExpressionDataType, contributedBy: 'sql' },
  ...[int4, numeric, enumType].map((type) => ({ type, contributedBy: 'postgres' })),
  ...extensionTypes.map((type) => ({ type, contributedBy: 'ext' })),
];

const codecsOf = (...types: readonly DataType[]) =>
  types.map((type) => ({ codecId: `${type.id}@1`, dataType: type.id }));

describe('enforceSqlDataTypeInvariants', () => {
  describe('claims', () => {
    it('passes data types whose claiming texts are distinct', () => {
      const other = sqlDataType('ext/int', {
        read: (json) => json,
        texts: [{ text: 'int16', written: true, catalog: true }],
      });
      expect(() => enforceSqlDataTypeInvariants(declaredWith([other]), [])).not.toThrow();
    });

    it('refuses two data types whose claiming texts are equal, naming both contributors and ids', () => {
      const other = sqlDataType('ext/integer', {
        read: (json) => json,
        texts: [{ text: 'integer', catalog: true }],
      });
      expect(() => enforceSqlDataTypeInvariants(declaredWith([other]), [])).toThrow(InternalError);
      expect(() => enforceSqlDataTypeInvariants(declaredWith([other]), [])).toThrow(
        /pg\/int4.*postgres.*ext\/integer.*ext|ext\/integer.*ext.*pg\/int4.*postgres/s,
      );
    });

    it('refuses a claiming text whose pattern matches another type’s text with its placeholders as 1', () => {
      const other = sqlDataType('ext/numeric-one', {
        read: (json) => json,
        texts: [{ text: 'numeric(1)' }],
      });
      expect(() => enforceSqlDataTypeInvariants(declaredWith([other]), [])).toThrow(
        /pg\/numeric.*ext\/numeric-one|ext\/numeric-one.*pg\/numeric/s,
      );
    });

    it('ignores texts that are only written', () => {
      const other = sqlDataType('ext/int4', {
        read: (json) => json,
        texts: [{ text: 'int4', written: true }],
      });
      expect(() => enforceSqlDataTypeInvariants(declaredWith([other]), [])).not.toThrow();
    });

    it('refuses two data types claiming one kind, naming both contributors and ids', () => {
      const other = sqlDataType('ext/enum', {
        read: (json) => json,
        params: type({ typeName: 'string > 0' }),
        claimsKind: 'enum',
        render: ({ typeName }) => typeName,
      });
      expect(() => enforceSqlDataTypeInvariants(declaredWith([other]), [])).toThrow(
        /pg\/enum.*postgres.*ext\/enum.*ext|ext\/enum.*ext.*pg\/enum.*postgres/s,
      );
    });

    it("ignores data types that are not SQL data types, such as the family's sql/expression", () => {
      expect(() =>
        enforceSqlDataTypeInvariants(
          declaredWith([dataType('ext/plain', { read: (json) => json })]),
          [],
        ),
      ).not.toThrow();
    });
  });

  describe('casts from sql/expression', () => {
    it('refuses a data type that casts from sql/expression, naming it and its contributor', () => {
      const geometry = dataType('ext/geometry', {
        read: (json) => json,
        casts: { [SQL_EXPRESSION_DATA_TYPE_ID]: (value) => value },
      });
      expect(() => enforceSqlDataTypeInvariants(declaredWith([geometry]), [])).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION',
          details: { dataType: 'ext/geometry', contributedBy: 'ext' },
        }),
      );
    });
  });

  describe('codecs', () => {
    it('accepts codecs that represent SQL data types', () => {
      expect(() =>
        enforceSqlDataTypeInvariants(declaredWith([]), codecsOf(int4, numeric, enumType)),
      ).not.toThrow();
    });

    it.each([
      ['the family’s sql/expression', sqlExpressionDataType, 'sql'],
      ['a plain data type', dataType('ext/plain', { read: (json) => json }), 'ext'],
    ])(
      'refuses a codec of %s, which no column can have, naming the codec, the data type and its contributor',
      (_, represented, contributedBy) => {
        expect(() =>
          enforceSqlDataTypeInvariants(
            declaredWith([dataType('ext/plain', { read: (json) => json })]),
            codecsOf(represented),
          ),
        ).toThrow(
          new InternalError(
            `Codec "${represented.id}@1" represents data type "${represented.id}" contributed by "${contributedBy}", which is not a SQL data type. In a SQL stack a codec represents a column's type, so its data type is declared with sqlDataType.`,
          ),
        );
      },
    );
  });
});

describe('createSqlFamilyInstance', () => {
  const stackWith = (input: {
    readonly declaredDataTypes: ReturnType<typeof declaredWith>;
    readonly codecDescriptors: ReturnType<typeof codecsOf>;
  }) =>
    blindCast<Parameters<typeof createSqlFamilyInstance>[0], 'only the data type slots are read'>(
      input,
    );

  it('refuses a stack whose SQL data types collide, before building anything', () => {
    const other = sqlDataType('ext/integer', {
      read: (json) => json,
      texts: [{ text: 'integer', catalog: true }],
    });
    expect(() =>
      createSqlFamilyInstance(
        stackWith({ declaredDataTypes: declaredWith([other]), codecDescriptors: [] }),
      ),
    ).toThrow(/pg\/int4.*ext\/integer|ext\/integer.*pg\/int4/s);
  });

  it('refuses a stack with a codec of sql/expression, before building anything', () => {
    expect(() =>
      createSqlFamilyInstance(
        stackWith({
          declaredDataTypes: declaredWith([]),
          codecDescriptors: codecsOf(sqlExpressionDataType),
        }),
      ),
    ).toThrow(/Codec "sql\/expression@1" represents data type "sql\/expression"/);
  });
});
