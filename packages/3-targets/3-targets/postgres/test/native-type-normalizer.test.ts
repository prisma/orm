import { describe, expect, it } from 'vitest';
import { type CatalogColumnType, introspectedNativeType } from '../src/core/native-type-normalizer';

const column = (overrides: Partial<CatalogColumnType>): CatalogColumnType => ({
  formattedType: null,
  dataType: 'USER-DEFINED',
  udtName: '',
  characterMaximumLength: null,
  numericPrecision: null,
  numericScale: null,
  ...overrides,
});

describe('introspectedNativeType', () => {
  describe('from the type format_type reports', () => {
    it.each([
      { formattedType: 'integer', dataType: 'integer', udtName: 'int4', nativeType: 'int4' },
      { formattedType: 'bigint', dataType: 'bigint', udtName: 'int8', nativeType: 'int8' },
      { formattedType: 'boolean', dataType: 'boolean', udtName: 'bool', nativeType: 'bool' },
      {
        formattedType: 'double precision',
        dataType: 'double precision',
        udtName: 'float8',
        nativeType: 'float8',
      },
      {
        formattedType: 'character varying(10)',
        dataType: 'character varying',
        udtName: 'varchar',
        nativeType: 'character varying(10)',
      },
      {
        formattedType: 'numeric(10,2)',
        dataType: 'numeric',
        udtName: 'numeric',
        nativeType: 'numeric(10,2)',
      },
      {
        formattedType: 'timestamp(3) without time zone',
        dataType: 'timestamp without time zone',
        udtName: 'timestamp',
        nativeType: 'timestamp(3)',
      },
      {
        formattedType: 'timestamp with time zone',
        dataType: 'timestamp with time zone',
        udtName: 'timestamptz',
        nativeType: 'timestamptz',
      },
      {
        formattedType: 'audit."AuditAction"',
        dataType: 'USER-DEFINED',
        udtName: 'AuditAction',
        nativeType: 'audit.AuditAction',
      },
    ])('reads $formattedType as $nativeType', ({ nativeType, ...type }) => {
      expect(introspectedNativeType(column(type))).toEqual({
        nativeType,
        many: undefined,
        resolvedNativeType: nativeType,
      });
    });

    it.each([
      { formattedType: 'integer[]', udtName: '_int4', nativeType: 'int4' },
      { formattedType: 'character(3)[]', udtName: '_bpchar', nativeType: 'character(3)' },
      { formattedType: '"Role"[]', udtName: '_Role', nativeType: 'Role' },
    ])(
      'reads the array $formattedType as a list of $nativeType',
      ({ formattedType, udtName, nativeType }) => {
        expect(
          introspectedNativeType(column({ formattedType, dataType: 'ARRAY', udtName })),
        ).toEqual({ nativeType, many: true, resolvedNativeType: `${nativeType}[]` });
      },
    );
  });

  describe('without a type from format_type', () => {
    it('adds the length to a character type', () => {
      expect(
        introspectedNativeType(
          column({
            dataType: 'character varying',
            udtName: 'varchar',
            characterMaximumLength: 10,
          }),
        ),
      ).toEqual({
        nativeType: 'character varying(10)',
        many: undefined,
        resolvedNativeType: 'character varying(10)',
      });
    });

    it('adds the precision and scale to a numeric type', () => {
      expect(
        introspectedNativeType(
          column({
            dataType: 'numeric',
            udtName: 'numeric',
            numericPrecision: 10,
            numericScale: 2,
          }),
        ),
      ).toEqual({
        nativeType: 'numeric(10,2)',
        many: undefined,
        resolvedNativeType: 'numeric(10,2)',
      });
    });

    it('falls back to the udt name', () => {
      expect(introspectedNativeType(column({ dataType: 'text', udtName: 'text' }))).toEqual({
        nativeType: 'text',
        many: undefined,
        resolvedNativeType: 'text',
      });
    });
  });
});
