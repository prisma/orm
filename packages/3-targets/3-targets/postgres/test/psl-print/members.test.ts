import { describe, expect, it } from 'vitest';
import { buildPostgresPslContract } from '../../src/core/psl-print/psl-contract';
import { extensionCodec, testBuildContext } from './build-context';
import { addressContract, countryValueSet, withCountryMembers } from './member-support';
import { fieldText } from './print-support';
import { deserialize, TEXT_FIELD, widgetContract } from './refusal-support';

describe('value-object members are written as the type their domain type reads back as', () => {
  it('writes a value-object member typed by a codec only the stack knows, as the type constructor that produces it', () => {
    const context = testBuildContext({
      codecs: [extensionCodec],
      types: {
        ext: {
          Citext: {
            kind: 'typeConstructor',
            output: { codecId: extensionCodec.codecId, nativeType: 'citext' },
          },
        },
      },
    });
    const document = buildPostgresPslContract(
      addressContract({
        nullable: false,
        type: { kind: 'scalar', codecId: extensionCodec.codecId },
      }),
      context,
    );

    expect(
      document.namespaces.flatMap((namespace) =>
        namespace.compositeTypes.flatMap((compositeType) =>
          compositeType.fields.map((field) => field.typeName),
        ),
      ),
    ).toEqual(['ext.Citext']);
  });

  it('writes a value-object member whose type carries type parameters, as the type constructor called with them', () => {
    const numeric = {
      kind: 'scalar',
      codecId: 'pg/numeric@1',
      typeParams: { precision: 65, scale: 30 },
    } as const;
    const document = buildPostgresPslContract(
      deserialize(
        widgetContract({
          columns: { price: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false } },
          fields: { price: { nullable: false, type: { kind: 'valueObject', name: 'Price' } } },
          domain: {
            valueObjects: {
              Price: {
                fields: {
                  amount: { nullable: false, type: numeric },
                  history: { nullable: false, many: { elementNullable: false }, type: numeric },
                },
              },
            },
          },
        }),
      ),
      testBuildContext(),
    );

    expect(
      document.namespaces.flatMap((namespace) =>
        namespace.compositeTypes.flatMap((compositeType) => compositeType.fields.map(fieldText)),
      ),
    ).toEqual(['amount Numeric(65, 30)', 'history Numeric(65, 30)[]']);
  });

  it('writes a value-object member typed by a domain enum as the enum name, single and list', () => {
    const document = buildPostgresPslContract(
      withCountryMembers({
        country: { ...TEXT_FIELD, valueSet: countryValueSet },
        countries: { ...TEXT_FIELD, many: { elementNullable: false }, valueSet: countryValueSet },
      }),
      testBuildContext(),
    );

    expect(
      document.namespaces.flatMap((namespace) =>
        namespace.compositeTypes.flatMap((compositeType) => compositeType.fields.map(fieldText)),
      ),
    ).toEqual(['country Country', 'countries Country[]']);
  });
});
