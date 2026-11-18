import { describe, expect, it } from 'vitest';
import { type CatalogColumnType, introspectedTypeText } from '../src/core/native-type-normalizer';

const column = (overrides: Partial<CatalogColumnType>): CatalogColumnType => ({
  formattedType: null,
  informationSchemaType: 'USER-DEFINED',
  udtName: '',
  characterMaximumLength: null,
  numericPrecision: null,
  numericScale: null,
  ...overrides,
});

describe('introspectedTypeText', () => {
  describe('from the type format_type reports', () => {
    it.each([
      {
        formattedType: 'integer',
        informationSchemaType: 'integer',
        udtName: 'int4',
      },
      {
        formattedType: 'bigint',
        informationSchemaType: 'bigint',
        udtName: 'int8',
      },
      {
        formattedType: 'boolean',
        informationSchemaType: 'boolean',
        udtName: 'bool',
      },
      {
        formattedType: 'double precision',
        informationSchemaType: 'double precision',
        udtName: 'float8',
      },
      {
        formattedType: 'character varying(10)',
        informationSchemaType: 'character varying',
        udtName: 'varchar',
      },
      {
        formattedType: 'numeric(10,2)',
        informationSchemaType: 'numeric',
        udtName: 'numeric',
      },
      {
        formattedType: 'timestamp(3) without time zone',
        informationSchemaType: 'timestamp without time zone',
        udtName: 'timestamp',
      },
      {
        formattedType: 'timestamp with time zone',
        informationSchemaType: 'timestamp with time zone',
        udtName: 'timestamptz',
      },
      {
        formattedType: 'audit."AuditAction"',
        informationSchemaType: 'USER-DEFINED',
        udtName: 'AuditAction',
      },
    ])('reads $formattedType as it is reported', (type) => {
      expect(introspectedTypeText(column(type))).toEqual({
        typeText: type.formattedType,
        many: undefined,
      });
    });

    it.each([
      { formattedType: 'integer[]', udtName: '_int4', typeText: 'integer' },
      { formattedType: 'character(3)[]', udtName: '_bpchar', typeText: 'character(3)' },
      { formattedType: '"Role"[]', udtName: '_Role', typeText: '"Role"' },
    ])(
      'reads the array $formattedType as a list of $typeText',
      ({ formattedType, udtName, typeText }) => {
        expect(
          introspectedTypeText(column({ formattedType, informationSchemaType: 'ARRAY', udtName })),
        ).toEqual({ typeText, many: true });
      },
    );
  });

  describe('of an enum column', () => {
    it.each([
      { formattedType: 'mood', schema: 'public', name: 'mood', typeText: 'mood', many: undefined },
      {
        formattedType: '"Order Status"[]',
        schema: 'public',
        name: 'Order Status',
        typeText: 'Order Status',
        many: true,
      },
      {
        formattedType: 'audit."AuditAction"',
        schema: 'audit',
        name: 'AuditAction',
        typeText: 'audit.AuditAction',
        many: undefined,
      },
    ])(
      'names the enum $formattedType as a contract does, bare in public and with its schema elsewhere',
      ({ formattedType, schema, name, typeText, many }) => {
        expect(
          introspectedTypeText(
            column({
              formattedType,
              informationSchemaType: many ? 'ARRAY' : 'USER-DEFINED',
              enumType: { schema, name },
            }),
          ),
        ).toEqual({ typeText, many });
      },
    );
  });

  describe('without a type from format_type', () => {
    it('adds the length to a character type', () => {
      expect(
        introspectedTypeText(
          column({
            informationSchemaType: 'character varying',
            udtName: 'varchar',
            characterMaximumLength: 10,
          }),
        ),
      ).toEqual({
        typeText: 'character varying(10)',
        many: undefined,
      });
    });

    it('adds the precision and scale to a numeric type', () => {
      expect(
        introspectedTypeText(
          column({
            informationSchemaType: 'numeric',
            udtName: 'numeric',
            numericPrecision: 10,
            numericScale: 2,
          }),
        ),
      ).toEqual({
        typeText: 'numeric(10,2)',
        many: undefined,
      });
    });

    it('falls back to the udt name', () => {
      expect(
        introspectedTypeText(column({ informationSchemaType: 'text', udtName: 'text' })),
      ).toEqual({
        typeText: 'text',
        many: undefined,
      });
    });
  });
});
