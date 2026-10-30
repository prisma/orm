import type { ContractValueObjectField } from '@internal/contract/types';
import {
  createDataTypeLookup,
  dataType,
  type TypeLookups,
} from '@internal/framework-components/codec';
import type {
  ResolvedValueObjectFieldBackfillStatement,
  ResolvedValueObjectFieldRenameStatement,
} from '@internal/framework-components/control';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { UnfilledValue } from '../src/core/migrations/unfilled-value';
import {
  planValueObjectFieldFills,
  type UnnamedFieldFill,
} from '../src/core/migrations/value-object-field-fills';
import { TEXT_CODEC_ID, testCodecLookup, textType as textDataType } from './enum-entity-fixtures';
import {
  allTables,
  type ColumnSpec,
  contractWith,
  field,
  textType,
  type ValueObjectFieldSpec,
  valueObjectRef,
} from './value-object-contract-fixtures';

const DATE_CODEC_ID = 'test/date@1';
const dateDataType = dataType('test/date', {
  read: (json) => {
    if (typeof json === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(json)) return json;
    throw structuredError('RUNTIME.DECODE_FAILED', 'test/date JSON value must be a date');
  },
});
const textDescriptor = testCodecLookup.descriptorFor(TEXT_CODEC_ID);
const types: TypeLookups = {
  codecLookup: {
    ...testCodecLookup,
    descriptorFor: (id: string) => {
      if (textDescriptor === undefined) return undefined;
      if (id === textType.codecId) return { ...textDescriptor, codecId: id, jsonType: 'string' };
      if (id === DATE_CODEC_ID) {
        return { ...textDescriptor, codecId: id, dataType: dateDataType.id, jsonType: 'string' };
      }
      return undefined;
    },
  },
  dataTypeLookup: createDataTypeLookup([textDataType, dateDataType]),
};

function backfill(valueObject: string, name: string): ResolvedValueObjectFieldBackfillStatement {
  return { kind: 'backfill', entity: 'valueObjectField', field: field(valueObject, name) };
}

function fieldWith(overrides: Partial<ContractValueObjectField>): ValueObjectFieldSpec {
  return { field: { nullable: false, type: textType, ...overrides } };
}

const place: ColumnSpec = {
  model: 'Place',
  table: 'place',
  field: 'location',
  valueObject: 'GeoPoint',
};
const history: ColumnSpec = {
  model: 'Place',
  table: 'place',
  field: 'history',
  valueObject: 'GeoPoint',
  many: true,
};
const trip: ColumnSpec = { model: 'Trip', table: 'trip', field: 'route', valueObject: 'Route' };

const GEO = { lat: 'scalar' } as const;
const GEO_WITH_COUNTRY = { lat: 'scalar', country: 'scalar' } as const;
const GEO_OPTIONAL_COUNTRY = { lat: 'scalar', country: fieldWith({ nullable: true }) } as const;

function plan(options: {
  readonly from: Readonly<Record<string, Readonly<Record<string, ValueObjectFieldSpec>>>>;
  readonly to: Readonly<Record<string, Readonly<Record<string, ValueObjectFieldSpec>>>>;
  readonly columns?: readonly ColumnSpec[];
  readonly statements?: readonly (
    | ResolvedValueObjectFieldBackfillStatement
    | ResolvedValueObjectFieldRenameStatement
  )[];
  readonly unnamed?: UnnamedFieldFill;
}) {
  const columns = options.columns ?? [place];
  return planValueObjectFieldFills({
    statements: options.statements ?? [],
    fromContract: contractWith({ valueObjects: options.from, columns }),
    contract: contractWith({ valueObjects: options.to, columns }),
    tables: allTables(),
    types,
    unnamed: options.unnamed ?? 'refuse',
  });
}

function fills(result: ReturnType<typeof planValueObjectFieldFills>) {
  if (!result.ok) throw new Error(`expected fills, got: ${result.failure.summary}`);
  return result.value;
}

function refusal(result: ReturnType<typeof planValueObjectFieldFills>) {
  if (result.ok) throw new Error('expected a refusal');
  return result.failure;
}

const country = field('GeoPoint', 'country');

describe('planValueObjectFieldFills', () => {
  it('fills a new required field a backfill statement names with a value the user writes', () => {
    const statement = backfill('GeoPoint', 'country');

    expect(
      fills(
        plan({
          from: { GeoPoint: GEO },
          to: { GeoPoint: GEO_WITH_COUNTRY },
          statements: [statement],
        }),
      ),
    ).toEqual([
      {
        valueObjectField: country,
        namespaceId: 'app',
        table: 'place',
        column: 'location',
        path: '$.country',
        value: new UnfilledValue('GeoPoint.country:value'),
        field: 'GeoPoint.country',
        statement,
      },
    ]);
  });

  it('fills an optional field made required', () => {
    const statement = backfill('GeoPoint', 'country');

    expect(
      fills(
        plan({
          from: { GeoPoint: GEO_OPTIONAL_COUNTRY },
          to: { GeoPoint: GEO_WITH_COUNTRY },
          statements: [statement],
        }),
      ).map(({ path, statement: carried }) => ({ path, carried })),
    ).toEqual([{ path: '$.country', carried: statement }]);
  });

  it('fills at every path to the value object: in lists, and nested inside other value objects', () => {
    const route = {
      start: { valueObject: 'GeoPoint' },
      stops: { valueObject: 'GeoPoint', many: true },
    } as const;

    expect(
      fills(
        plan({
          from: { GeoPoint: GEO, Route: route },
          to: { GeoPoint: GEO_WITH_COUNTRY, Route: route },
          columns: [place, history, trip],
          statements: [backfill('GeoPoint', 'country')],
        }),
      ).map(({ table, column, path }) => `${table}.${column} ${path}`),
    ).toEqual([
      'place.location $.country',
      'place.history $[*].country',
      'trip.route $.start.country',
      'trip.route $.stops[*].country',
    ]);
  });

  it('fills nothing for a field the origin already requires, a renamed field, or a value object no column holds', () => {
    const rename: ResolvedValueObjectFieldRenameStatement = {
      kind: 'rename',
      entity: 'valueObjectField',
      from: field('GeoPoint', 'lat'),
      to: field('GeoPoint', 'latitude'),
    };

    expect(fills(plan({ from: { GeoPoint: GEO }, to: { GeoPoint: GEO } }))).toEqual([]);
    expect(
      fills(
        plan({
          from: { GeoPoint: GEO },
          to: { GeoPoint: { latitude: 'scalar' } },
          statements: [rename],
        }),
      ),
    ).toEqual([]);
    expect(
      fills(
        plan({
          from: { GeoPoint: GEO, Label: GEO },
          to: { GeoPoint: GEO_WITH_COUNTRY, Label: GEO },
          columns: [{ model: 'Tag', table: 'tag', field: 'label', valueObject: 'Label' }],
        }),
      ),
    ).toEqual([]);
  });

  it('fills nothing with no origin contract', () => {
    expect(
      fills(
        planValueObjectFieldFills({
          statements: [],
          fromContract: null,
          contract: contractWith({
            valueObjects: { GeoPoint: GEO_WITH_COUNTRY },
            columns: [place],
          }),
          tables: allTables(),
          types,
          unnamed: 'refuse',
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a required field no backfill statement names, naming the statement', () => {
    expect(refusal(plan({ from: { GeoPoint: GEO }, to: { GeoPoint: GEO_WITH_COUNTRY } }))).toEqual({
      kind: 'nullabilityConflict',
      summary:
        'Value object field "GeoPoint.country" is required, and existing objects may have no value for it, at:\n- path "$" in column "location" of "place"',
      why: 'Add --backfill GeoPoint.country to write the value the plan fills them with.',
      location: {
        namespaceId: 'app',
        entityKind: 'table',
        entityName: 'place',
        column: 'location',
      },
      meta: { valueObjectField: country },
    });
  });

  it('fills a placeholder when the value object lost a field, so the question about that field is asked first', () => {
    expect(
      fills(plan({ from: { GeoPoint: GEO }, to: { GeoPoint: { country: 'scalar' } } })).map(
        ({ path, value }) => ({ path, value }),
      ),
    ).toEqual([{ path: '$.country', value: new UnfilledValue('GeoPoint.country:value') }]);
  });

  it('names every column and path in the refusal', () => {
    expect(
      refusal(
        plan({
          from: { GeoPoint: GEO },
          to: { GeoPoint: GEO_WITH_COUNTRY },
          columns: [place, history],
        }),
      ).summary,
    ).toBe(
      'Value object field "GeoPoint.country" is required, and existing objects may have no value for it, at:\n- path "$" in column "location" of "place"\n- path "$[*]" in column "history" of "place"',
    );
  });

  describe('with temporary values', () => {
    it('fills a scalar field with the empty value of its JSON type, and a list with an empty list', () => {
      const result = plan({
        from: { GeoPoint: GEO },
        to: {
          GeoPoint: {
            ...GEO,
            country: 'scalar',
            tags: fieldWith({ many: { elementNullable: false } }),
          },
        },
        unnamed: 'temporaryValue',
      });

      expect(
        fills(result).map(({ path, value, statement }) => ({ path, value, statement })),
      ).toEqual([
        { path: '$.country', value: '', statement: undefined },
        { path: '$.tags', value: [], statement: undefined },
      ]);
    });

    it('fills a list of enum values and a list of value objects with an empty list', () => {
      const result = plan({
        from: { GeoPoint: GEO, Label: GEO },
        to: {
          GeoPoint: {
            ...GEO,
            colors: fieldWith({
              valueSet: { ...valueObjectRef('Color', 'app'), entityKind: 'valueSet' },
              many: { elementNullable: false },
            }),
            labels: { valueObject: 'Label', many: true },
          },
          Label: GEO,
        },
        unnamed: 'temporaryValue',
      });

      expect(fills(result).map(({ path, value, field }) => ({ path, value, field }))).toEqual([
        { path: '$.colors', value: [], field: 'GeoPoint.colors' },
        { path: '$.labels', value: [], field: 'GeoPoint.labels' },
      ]);
    });

    it.each([
      ['holds a value object', { valueObject: 'Label' }],
      [
        'holds an enum value',
        fieldWith({ valueSet: { ...valueObjectRef('Color', 'app'), entityKind: 'valueSet' } }),
      ],
      [
        'has a codec whose data type refuses the empty value of its JSON type',
        fieldWith({ type: { kind: 'scalar', codecId: DATE_CODEC_ID } }),
      ],
      [
        'has a codec with no JSON type',
        fieldWith({ type: { kind: 'scalar', codecId: 'test/other@1' } }),
      ],
    ] as const)('refuses a field that %s, naming migration plan --backfill', (_, spec) => {
      const result = plan({
        from: { GeoPoint: GEO, Label: GEO },
        to: { GeoPoint: { ...GEO, country: spec }, Label: GEO },
        unnamed: 'temporaryValue',
      });

      expect(refusal(result)).toMatchObject({
        kind: 'nullabilityConflict',
        why: 'db update cannot choose a value for a field that holds a value object or an enum value, or whose codec has no temporary value. Plan a migration with prisma migration plan --backfill GeoPoint.country instead, and write the value in its migration.ts.',
      });
    });
  });

  it('refuses a column whose paths to the value object cannot be listed', () => {
    expect(
      refusal(
        plan({
          from: { GeoPoint: GEO },
          to: { GeoPoint: GEO_WITH_COUNTRY },
          columns: [{ ...place, shape: 'union' }],
          statements: [backfill('GeoPoint', 'country')],
        }),
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot fill value object field "GeoPoint.country": column "location" of "place" holds a union of value objects',
      why: 'The plan fills a key at every path from a column to its value object, and it cannot list the paths in such a column. Write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the JSON of column "location" of "place" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
    });
  });
});
