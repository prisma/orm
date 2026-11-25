import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  assertNoManagedEntityKinds,
  type CollectedColumnEntities,
  collectEntityFromColumn,
  mergeColumnAndAttachedEntities,
  mergeNamespaceValueSets,
} from '../src/pack-entities';

const valueSet = { kind: 'valueSet', values: ['a'] } as const;

describe.each([
  ['public', ' in namespace "public"', ' per namespace'],
  [UNBOUND_NAMESPACE_ID, '', ''],
])('pack entity refusals in namespace %s', (namespaceId, where, scope) => {
  it('names two different entities of one kind and name collected from columns', () => {
    const collected: CollectedColumnEntities = {};
    collectEntityFromColumn(collected, namespaceId, {
      entityKind: 'gadget',
      entityName: 'g',
      entity: { id: 1 },
    });
    expect(() =>
      collectEntityFromColumn(collected, namespaceId, {
        entityKind: 'gadget',
        entityName: 'g',
        entity: { id: 2 },
      }),
    ).toThrow(
      expect.objectContaining({
        message: `buildSqlContractFromDefinition: two different "gadget" entities named "g"${where} — pack-entity names must be unique${scope}.`,
        meta: { kind: 'gadget', name: 'g', namespaceId },
      }),
    );
  });

  it('names a column-referenced entity that conflicts with an attached one', () => {
    expect(() =>
      mergeColumnAndAttachedEntities(
        namespaceId,
        { gadget: { g: { id: 1 } } },
        { gadget: { g: { id: 2 } } },
      ),
    ).toThrow(
      expect.objectContaining({
        message: `buildSqlContractFromDefinition: two different "gadget" entities named "g"${where} — a column-referenced entity conflicts with an attached one; pack-entity names must be unique${scope}.`,
        meta: { kind: 'gadget', name: 'g', namespaceId },
      }),
    );
  });

  it('names an attached entity of a kind the framework manages', () => {
    expect(() => assertNoManagedEntityKinds(namespaceId, { table: {} })).toThrow(
      expect.objectContaining({
        message: `buildSqlContractFromDefinition: attached entity${where} declares entry kind "table", which is managed by the framework (table/valueSet) and cannot be attached.`,
        meta: { entityKind: 'table', namespaceId },
      }),
    );
  });

  it('names a value set derived from both an enum and a pack entity', () => {
    expect(() =>
      mergeNamespaceValueSets(namespaceId, { Level: valueSet }, { Level: valueSet }),
    ).toThrow(
      expect.objectContaining({
        message: `buildSqlContractFromDefinition: value-set "Level"${where} is derived from both an enum and a pack entity — names must be unique${scope}.`,
        meta: { kind: 'valueSet', name: 'Level', namespaceId },
      }),
    );
  });
});
