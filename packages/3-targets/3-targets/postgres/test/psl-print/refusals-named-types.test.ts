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
