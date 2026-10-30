import { asNamespaceId, type ContractValueObjectField } from '@internal/contract/types';
import type {
  MigrationOperationPolicy,
  ResolvedValueObjectFieldBackfillStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  ALL_CLASSES,
  conflictsOf,
  type MemberSpec,
  placeContract,
  plan,
  renderedCalls,
  succeeded,
  text,
} from './value-object-planner-fixtures';

const MIGRATION_PLAN: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

const country = {
  namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
  valueObject: 'GeoPoint',
  field: 'country',
};

const backfill: ResolvedValueObjectFieldBackfillStatement = {
  kind: 'backfill',
  entity: 'valueObjectField',
  field: country,
};

function required(overrides: Partial<ContractValueObjectField>): MemberSpec {
  return { field: { nullable: false, type: text, ...overrides } };
}

const GEO = { lat: 'scalar' } as const;
const location = { field: 'location', valueObject: 'GeoPoint' };
const stops = { field: 'stops', valueObject: 'GeoPoint', many: true };
const address = { field: 'address', valueObject: 'Address' };
const ADDRESS = { point: { valueObject: 'GeoPoint' } } as const;

function placeholderFill(column: string, path: string): string {
  return `this.fillStoredKey({ table: "place", column: "${column}", path: "${path}", value: placeholder("GeoPoint.country:value") })`;
}

describe('SQLite planner, value object member fills', () => {
  describe('migration plan --backfill GeoPoint.country', () => {
    it('fills a new required field with a placeholder value, and gives the statement its operation', async () => {
      const result = succeeded(
        plan(
          placeContract({ GeoPoint: GEO }, [location], 'from'),
          placeContract({ GeoPoint: { ...GEO, country: 'scalar' } }, [location], 'to'),
          [backfill],
          MIGRATION_PLAN,
        ),
      );

      expect(renderedCalls(result)).toEqual([placeholderFill('location', '$.country')]);
      const settled = await Promise.allSettled(result.plan.operations);
      const index = settled.findIndex((entry) => entry.status === 'rejected');
      expect(settled[index]).toMatchObject({
        status: 'rejected',
        reason: {
          code: 'MIGRATION.UNFILLED_PLACEHOLDER',
          meta: { slot: 'GeoPoint.country:value' },
        },
      });
      expect(result.appliedStatements).toEqual([
        { statement: backfill, operationIndexes: [index] },
      ]);
      expect(result.temporaryValues).toEqual([]);
    });

    it('fills an optional field made required', () => {
      expect(
        renderedCalls(
          plan(
            placeContract(
              { GeoPoint: { ...GEO, country: required({ nullable: true }) } },
              [location],
              'from',
            ),
            placeContract({ GeoPoint: { ...GEO, country: 'scalar' } }, [location], 'to'),
            [backfill],
            MIGRATION_PLAN,
          ),
        ),
      ).toEqual([placeholderFill('location', '$.country')]);
    });

    it('fills every element of a list, and objects nested in another value object', () => {
      expect(
        renderedCalls(
          plan(
            placeContract({ GeoPoint: GEO, Address: ADDRESS }, [location, stops, address], 'from'),
            placeContract(
              { GeoPoint: { ...GEO, country: 'scalar' }, Address: ADDRESS },
              [location, stops, address],
              'to',
            ),
            [backfill],
            MIGRATION_PLAN,
          ),
        ),
      ).toEqual([
        placeholderFill('location', '$.country'),
        placeholderFill('stops', '$[*].country'),
        placeholderFill('address', '$.point.country'),
      ]);
    });
  });

  it('refuses a new required field without --backfill when it plans a migration', () => {
    expect(
      conflictsOf(
        plan(
          placeContract({ GeoPoint: GEO }, [location], 'from'),
          placeContract({ GeoPoint: { ...GEO, country: 'scalar' } }, [location], 'to'),
          [],
          MIGRATION_PLAN,
        ),
      ),
    ).toEqual([
      {
        kind: 'nullabilityConflict',
        summary:
          'Value object field "GeoPoint.country" is required, and existing objects at path "$" in column "location" of "place" may have no value for it',
        why: 'Add --backfill GeoPoint.country to write the value the plan fills them with.',
        location: {
          namespaceId: UNBOUND_NAMESPACE_ID,
          entityKind: 'table',
          entityName: 'place',
          column: 'location',
        },
        meta: { valueObjectField: country },
      },
    ]);
  });

  describe('db update', () => {
    it('fills a scalar field with a temporary value, and reports it as the value object field', async () => {
      const result = succeeded(
        plan(
          placeContract({ GeoPoint: GEO }, [location, stops], 'from'),
          placeContract({ GeoPoint: { ...GEO, country: 'scalar' } }, [location, stops], 'to'),
          [],
          ALL_CLASSES,
        ),
      );

      expect(renderedCalls(result)).toEqual([
        'this.fillStoredKey({ table: "place", column: "location", path: "$.country", value: "" })',
        'this.fillStoredKey({ table: "place", column: "stops", path: "$[*].country", value: "" })',
      ]);
      const ops = await Promise.all(result.plan.operations);
      const fills = ops.flatMap((op, index) => (op.id.startsWith('fillStoredKey') ? [index] : []));
      expect(result.temporaryValues).toEqual(
        fills.map((operationIndex) => ({
          operationIndex,
          subject: { kind: 'valueObjectField', ...country },
          value: '""',
        })),
      );
    });

    it('refuses a DateTime field, whose data type does not take the empty string', () => {
      expect(
        conflictsOf(
          plan(
            placeContract({ GeoPoint: GEO }, [location], 'from'),
            placeContract(
              {
                GeoPoint: {
                  ...GEO,
                  country: required({ type: { kind: 'scalar', codecId: 'sqlite/datetime@1' } }),
                },
              },
              [location],
              'to',
            ),
            [],
            ALL_CLASSES,
          ),
        ),
      ).toMatchObject([
        {
          kind: 'nullabilityConflict',
          why: expect.stringContaining('prisma migration plan --backfill GeoPoint.country'),
        },
      ]);
    });

    it.each([
      ['holds a value object', { valueObject: 'Label' }],
      [
        'holds an enum value',
        required({
          valueSet: {
            plane: 'storage',
            namespaceId: UNBOUND_NAMESPACE_ID,
            entityKind: 'valueSet',
            entityName: 'Color',
          },
        }),
      ],
      [
        'has a codec with no temporary value',
        required({ type: { kind: 'scalar', codecId: 'sqlite/json@1' } }),
      ],
    ] as const)('refuses a field that %s, naming migration plan --backfill', (_, spec) => {
      const LABEL = { text: 'scalar' } as const;
      expect(
        conflictsOf(
          plan(
            placeContract({ GeoPoint: GEO, Label: LABEL }, [location], 'from'),
            placeContract({ GeoPoint: { ...GEO, country: spec }, Label: LABEL }, [location], 'to'),
            [],
            ALL_CLASSES,
          ),
        ),
      ).toMatchObject([
        {
          kind: 'nullabilityConflict',
          why: expect.stringContaining('prisma migration plan --backfill GeoPoint.country'),
        },
      ]);
    });
  });
});
