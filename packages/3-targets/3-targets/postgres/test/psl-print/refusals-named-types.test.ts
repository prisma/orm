import { describe, expect, it } from 'vitest';
import { INT_FIELD, printingWidget, refusal, TEXT_FIELD } from './refusal-support';

const SHORT_TEXT = {
  kind: 'codec-instance',
  codecId: 'pg/text@1',
  nativeType: 'text',
  typeParams: {},
};
const COORDINATE = '"public"."Widget"."label"';

describe('a column typed by a named type', () => {
  it('prints a column with the native type and codec of its named type', () => {
    expect(
      printingWidget({
        storageTypes: { ShortText: SHORT_TEXT },
        columns: {
          label: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            typeRef: 'ShortText',
          },
        },
        fields: { label: TEXT_FIELD },
      }),
    ).not.toThrow();
  });

  const MONEY = {
    kind: 'codec-instance',
    codecId: 'pg/numeric@1',
    nativeType: 'numeric',
    typeParams: { precision: 10, scale: 2 },
  };
  const moneyColumn = {
    nativeType: 'numeric',
    codecId: 'pg/numeric@1',
    nullable: false,
    typeRef: 'Money',
  };

  it("prints a field whose domain type carries the type parameters of its column's named type", () => {
    expect(
      printingWidget({
        storageTypes: { Money: MONEY },
        columns: { label: moneyColumn },
        fields: {
          label: {
            nullable: false,
            type: {
              kind: 'scalar',
              codecId: 'pg/numeric@1',
              typeParams: { precision: 10, scale: 2 },
            },
          },
        },
      }),
    ).not.toThrow();
  });

  it("refuses a field whose domain type lacks the type parameters of its column's named type, and says a contract an earlier release emitted is emitted again", () => {
    expect(
      printingWidget({
        storageTypes: { Money: MONEY },
        columns: { label: moneyColumn },
        fields: { label: { nullable: false, type: { kind: 'scalar', codecId: 'pg/numeric@1' } } },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        fix: 'If an earlier release emitted this contract, emit it again. Make the field and its column agree, or keep authoring this contract in its current source.',
        meta: { coordinate: COORDINATE },
      }),
    );
  });

  it('refuses a column whose native type and codec are not those of its named type', () => {
    expect(
      printingWidget({
        storageTypes: { ShortText: SHORT_TEXT },
        columns: {
          label: {
            nativeType: 'int4',
            codecId: 'pg/int4@1',
            nullable: false,
            typeRef: 'ShortText',
          },
        },
        fields: { label: INT_FIELD },
      }),
    ).toThrow(refusal({ coordinate: COORDINATE, typeRef: 'ShortText' }));
  });

  it('refuses a column typed by a named type the contract does not declare', () => {
    expect(
      printingWidget({
        columns: {
          label: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            typeRef: 'ShortText',
          },
        },
        fields: { label: TEXT_FIELD },
      }),
    ).toThrow(refusal({ coordinate: COORDINATE, typeRef: 'ShortText' }));
  });
});
