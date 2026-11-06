import { asNamespaceId } from '@internal/contract/types';
import { createDataTypeLookup, type TypeLookups } from '@internal/framework-components/codec';
import type {
  OpFactoryCall,
  ResolvedValueObjectFieldRenameStatement,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { planStoredRewrites, type StoredRewrite } from '../src/core/migrations/stored-rewrites';
import { testCodecLookup } from './enum-entity-fixtures';
import { allTables, contractWith, field } from './value-object-contract-fixtures';

const types: TypeLookups = {
  codecLookup: testCodecLookup,
  dataTypeLookup: createDataTypeLookup([]),
};

const place = { model: 'Place', table: 'place', field: 'location', valueObject: 'GeoPoint' };
const GEO = { lat: 'scalar', lng: 'scalar' } as const;

/** A stand-in for a target's call, naming the kind of rewrite it carries out. */
function callOf(kind: string, rewrite: StoredRewrite): OpFactoryCall {
  return { kind, rewrite } as unknown as OpFactoryCall;
}

function plan(
  to: Parameters<typeof contractWith>[0],
  statements: readonly ResolvedValueObjectFieldRenameStatement[],
) {
  return planStoredRewrites({
    statements,
    fromContract: contractWith({ valueObjects: { GeoPoint: GEO }, columns: [place] }),
    contract: contractWith(to),
    tables: allTables(),
    types,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    calls: {
      storedKeyCalls: (rewrites) => new Map(rewrites.map((r) => [callOf('key', r), r])),
      storedKeyFillCalls: (fills) => new Map(fills.map((f) => [callOf('fill', f), f])),
      storedValueCalls: (rewrites) => new Map(rewrites.map((r) => [callOf('value', r), r])),
      variantRowCalls: (rewrites) => new Map(rewrites.map((r) => [callOf('variant', r), r])),
      storedValueClasses: {
        isRemoval: (_call): _call is OpFactoryCall => false,
        replacementOf: (removal) => removal,
      },
    },
  });
}

describe('planStoredRewrites', () => {
  it("builds the target's calls, and finds the operations a statement accounts for and the field each is about", () => {
    const namespaceId = asNamespaceId('app');
    const statement: ResolvedValueObjectFieldRenameStatement = {
      kind: 'rename',
      entity: 'valueObjectField',
      from: { namespaceId, valueObject: 'GeoPoint', field: 'lat' },
      to: { namespaceId, valueObject: 'GeoPoint', field: 'latitude' },
    };
    const result = plan(
      { valueObjects: { GeoPoint: { latitude: 'scalar', lng: 'scalar' } }, columns: [place] },
      [statement],
    ).assertOk();
    const [call] = result.calls;
    const other = { kind: 'other' } as unknown as OpFactoryCall;

    expect([
      result.calls.length,
      result.operationIndexes([other, ...result.calls], statement),
      call === undefined ? undefined : result.storedKeys.get(call),
      result.variantRows.size,
      result.removedVariants,
    ]).toEqual([1, [1], field('GeoPoint', 'lat'), 0, []]);
  });

  it('plans nothing for an unchanged value object, and fails with a refusal for a change it cannot plan', () => {
    expect(
      plan({ valueObjects: { GeoPoint: GEO }, columns: [{ ...place, shape: 'union' }] }, []).ok,
    ).toBe(true);
    expect(
      plan(
        { valueObjects: { GeoPoint: { lat: 'scalar' } }, columns: [{ ...place, shape: 'union' }] },
        [],
      ).assertNotOk(),
    ).toMatchObject({ kind: 'unsupportedOperation' });
  });
});
