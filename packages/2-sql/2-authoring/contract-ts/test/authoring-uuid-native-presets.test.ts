import type { AuthoringFieldNamespace } from '@internal/framework-components/authoring';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { createComposedAuthoringHelpers } from '../src/composed-authoring-helpers';
import { defineContract } from '../src/contract-builder';
import { unboundTables } from './unbound-tables';

// Factory functions — mergeAuthoringNamespaces mutates its target argument in
// place, so each test must receive fresh objects rather than shared module-level
// constants.

function makeFamilyPack() {
  return {
    kind: 'family',
    id: 'sql',
    familyId: 'sql',
    version: '0.0.1',
    authoring: {
      field: {
        uuidString: {
          kind: 'fieldPreset',
          output: {
            codecId: 'sql/char@1',
            nativeType: 'character',
            typeParams: { length: 36 },
          },
        },
        id: {
          uuidv4String: {
            kind: 'fieldPreset',
            output: {
              codecId: 'sql/char@1',
              nativeType: 'character',
              typeParams: { length: 36 },
              executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv4' } },
              id: true,
            },
          },
          uuidv7String: {
            kind: 'fieldPreset',
            output: {
              codecId: 'sql/char@1',
              nativeType: 'character',
              typeParams: { length: 36 },
              executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv7' } },
              id: true,
            },
          },
        },
      } as const satisfies AuthoringFieldNamespace,
    },
  } as const satisfies FamilyPackRef<'sql'>;
}

function makePostgresPack() {
  return {
    kind: 'target',
    id: 'postgres',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    defaultNamespaceId: 'public',
    authoring: {
      field: {
        uuidNative: {
          kind: 'fieldPreset',
          output: {
            codecId: 'pg/uuid@1',
            nativeType: 'uuid',
          },
        },
        id: {
          uuidv4Native: {
            kind: 'fieldPreset',
            output: {
              codecId: 'pg/uuid@1',
              nativeType: 'uuid',
              executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv4' } },
              id: true,
            },
          },
          uuidv7Native: {
            kind: 'fieldPreset',
            output: {
              codecId: 'pg/uuid@1',
              nativeType: 'uuid',
              executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv7' } },
              id: true,
            },
          },
        },
      } as const satisfies AuthoringFieldNamespace,
    },
  } as const satisfies TargetPackRef<'sql', 'postgres'>;
}

describe('uuid native presets', () => {
  describe('namespace merge', () => {
    it('family id.uuidv4String and target id.uuidv4Native compose without a duplicate error', () => {
      expect(() =>
        createComposedAuthoringHelpers({
          family: makeFamilyPack(),
          target: makePostgresPack(),
          extensions: {},
        }),
      ).not.toThrow();
    });

    it('composed helpers expose both uuidString and uuidNative at the top level', () => {
      const helpers = createComposedAuthoringHelpers({
        family: makeFamilyPack(),
        target: makePostgresPack(),
        extensions: {},
      });

      expect(helpers.field.uuidString).toBeDefined();
      expect(helpers.field.uuidNative).toBeDefined();
    });

    it('composed helpers expose all four id variants', () => {
      const helpers = createComposedAuthoringHelpers({
        family: makeFamilyPack(),
        target: makePostgresPack(),
        extensions: {},
      });

      expect(helpers.field.id.uuidv4String).toBeDefined();
      expect(helpers.field.id.uuidv7String).toBeDefined();
      expect(helpers.field.id.uuidv4Native).toBeDefined();
      expect(helpers.field.id.uuidv7Native).toBeDefined();
    });
  });

  describe('emit-then-consume', () => {
    it('uuidNative emits pg/uuid@1 with nativeType uuid in contract JSON', () => {
      const contract = defineContract(
        {
          family: makeFamilyPack(),
          target: makePostgresPack(),
          createNamespace: createTestSqlNamespace,
        },
        ({ field, model }) => ({
          models: {
            Widget: model('Widget', {
              fields: {
                externalId: field.uuidNative(),
              },
            }).sql({ table: 'widget' }),
          },
        }),
      );

      const json = JSON.parse(JSON.stringify(contract)) as typeof contract;
      const col = unboundTables(json.storage)['widget']!.columns['externalId']!;

      expect(col.codecId).toBe('pg/uuid@1');
      expect(col.nativeType).toBe('uuid');
    });

    it('id.uuidv4Native emits pg/uuid@1 with uuidv4 onCreate generator in contract JSON', () => {
      const contract = defineContract(
        {
          family: makeFamilyPack(),
          target: makePostgresPack(),
          createNamespace: createTestSqlNamespace,
        },
        ({ field, model }) => ({
          models: {
            Widget: model('Widget', {
              fields: {
                id: field.id.uuidv4Native(),
              },
            }).sql({ table: 'widget' }),
          },
        }),
      );

      const json = JSON.parse(JSON.stringify(contract)) as typeof contract;
      const col = unboundTables(json.storage)['widget']!.columns['id']!;

      expect(col.codecId).toBe('pg/uuid@1');
      expect(col.nativeType).toBe('uuid');

      const defaults = json.execution?.mutations.defaults ?? [];
      const idDefault = defaults.find((d) => d.ref.entry === 'widget' && d.ref.field === 'id');
      expect(idDefault?.onCreate).toEqual({ kind: 'generator', id: 'uuidv4' });
    });

    it('id.uuidv7Native emits pg/uuid@1 with uuidv7 onCreate generator in contract JSON', () => {
      const contract = defineContract(
        {
          family: makeFamilyPack(),
          target: makePostgresPack(),
          createNamespace: createTestSqlNamespace,
        },
        ({ field, model }) => ({
          models: {
            Widget: model('Widget', {
              fields: {
                id: field.id.uuidv7Native(),
              },
            }).sql({ table: 'widget' }),
          },
        }),
      );

      const json = JSON.parse(JSON.stringify(contract)) as typeof contract;
      const defaults = json.execution?.mutations.defaults ?? [];
      const idDefault = defaults.find((d) => d.ref.entry === 'widget' && d.ref.field === 'id');
      expect(idDefault?.onCreate).toEqual({ kind: 'generator', id: 'uuidv7' });
    });
  });
});
