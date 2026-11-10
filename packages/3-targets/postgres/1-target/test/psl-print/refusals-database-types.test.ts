import type { PslDocumentAst } from '@internal/framework-components/psl-ast';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { fieldText } from './print-support';
import { printingWidget } from './refusal-support';

const MONEY_PARAMS = { precision: 10, scale: 2 };

describe('a column with type parameters', () => {
  it('prints as its type constructor, with no types block', () => {
    const document = blindCast<PslDocumentAst, 'printing returns the document'>(
      printingWidget({
        columns: {
          price: {
            dataType: 'pg/numeric',
            codecId: 'pg/numeric@1',
            nullable: false,
            typeParams: MONEY_PARAMS,
          },
        },
        fields: {
          price: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/numeric@1', typeParams: MONEY_PARAMS },
          },
        },
      })(),
    );

    expect({
      types: document.types,
      price: document.namespaces
        .flatMap((namespace) => namespace.models)
        .flatMap((model) => model.fields)
        .filter((field) => field.name === 'price')
        .map(fieldText),
    }).toEqual({ types: undefined, price: ['price Decimal(precision: 10, scale: 2)'] });
  });
});

describe('a contract that registers database types', () => {
  it('is refused, naming the types', () => {
    const registered = (codecId: string, dataType: string) => ({
      kind: 'codec-instance',
      codecId,
      dataType,
      typeParams: {},
    });
    expect(
      printingWidget({
        storageTypes: {
          vector: registered('pg/vector@1', 'pgvector/vector'),
          geometry: registered('postgis/geometry@1', 'postgis/geometry'),
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        message:
          "contract print: This contract registers the database types geometry, vector, which PSL cannot declare. It is an extension's contract space, written in TypeScript.",
        meta: { types: ['geometry', 'vector'] },
      }),
    );
  });
});
