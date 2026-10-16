import type { SqlPslBuildContext } from '@internal/family-sql/control';
import type { PslDocumentAst } from '@internal/framework-components/psl-ast';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID } from '../../src/core/codec-ids';
import { postgresNowGeneratorIds } from '../../src/core/now-generators';
import { testBuildContext } from './build-context';
import { fieldText } from './print-support';
import { INT_FIELD, printingWidget, refusal, TEXT_FIELD } from './refusal-support';

const SHORT_TEXT = {
  kind: 'codec-instance',
  codecId: 'pg/text@1',
  dataType: 'pg/text',
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
            dataType: 'pg/text',
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
    dataType: 'pg/numeric',
    typeParams: { precision: 10, scale: 2 },
  };
  const moneyColumn = {
    dataType: 'pg/numeric',
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

  describe('with generators a field preset writes', () => {
    const generator = postgresNowGeneratorIds[PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID];
    const stampedWidget = (context?: SqlPslBuildContext): (() => readonly string[] | undefined) => {
      const print = printingWidget(
        {
          storageTypes: {
            Stamp: {
              kind: 'codec-instance',
              codecId: PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
              dataType: 'pg/timestamptz',
              typeParams: {},
            },
          },
          columns: {
            label: {
              dataType: 'pg/timestamptz',
              codecId: PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
              nullable: false,
              typeRef: 'Stamp',
            },
          },
          fields: {
            label: {
              nullable: false,
              type: { kind: 'scalar', codecId: PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID },
            },
          },
          contract: {
            execution: {
              mutations: {
                defaults: [
                  {
                    ref: { namespace: 'public', entry: 'Widget', field: 'label' },
                    onCreate: { kind: 'generator', id: generator },
                  },
                ],
              },
            },
          },
        },
        context,
      );
      return () => {
        const document = blindCast<PslDocumentAst, 'printing returns the document'>(print());
        return document.namespaces
          .flatMap((namespace) => namespace.models)
          .flatMap((model) => model.fields)
          .filter((field) => field.name === 'label')
          .map(fieldText);
      };
    };

    it('refuses the column when no default function writes the generator, since a preset call writes no named type', () => {
      expect(stampedWidget()).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.PRINT_UNSUPPORTED',
          message:
            'contract print: column "public"."Widget"."label" cannot be written with field preset temporal.timestamptz: its type Stamp is a named type, which the preset call would replace.',
          meta: {
            coordinate: COORDINATE,
            preset: 'temporal.timestamptz',
            reason: { kind: 'columnType', columnType: 'namedType', typeName: 'Stamp' },
          },
        }),
      );
    });

    it('writes the generator as the call of its default function, which keeps the named type', () => {
      const context = testBuildContext({
        defaultFunctionPrinters: new Map([
          [generator, { functionName: 'instantNow', printArguments: () => '' }],
        ]),
      });
      expect(stampedWidget(context)()).toEqual(['label Stamp @default(instantNow())']);
    });
  });

  it('refuses a column whose native type and codec are not those of its named type', () => {
    expect(
      printingWidget({
        storageTypes: { ShortText: SHORT_TEXT },
        columns: {
          label: {
            dataType: 'pg/int4',
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
            dataType: 'pg/text',
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
