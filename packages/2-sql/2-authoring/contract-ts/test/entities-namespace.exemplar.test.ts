import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import { freezeNode, IRNodeBase } from '@internal/framework-components/ir';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract } from '../src/contract-builder';

/**
 * In-tree synthetic pack exemplar for the entities namespace mechanism.
 *
 * Demonstrates end-to-end:
 *
 *   1. type narrowing — a contributed entity surfaces at
 *      `helpers.<name>(input)` (flattened to top level alongside the
 *      built-in `model` / `rel` helpers) with the contributed input
 *      type and the IR-class output type;
 *   2. runtime construction — the helper call dispatches to the
 *      supplied factory, which returns a frozen IR-class instance via
 *      the framework's `freezeNode` affordance;
 *   3. JSON-cleanliness — the constructed instance round-trips through
 *      JSON.stringify / JSON.parse without a custom toJSON, matching
 *      the convention the existing ContractSerializer SPI relies on.
 *
 * The pack is synthetic on purpose. Real contributions (Postgres enum,
 * Postgres namespace) land in dedicated milestones; this file demonstrates
 * the mechanism is wired end-to-end without coupling the demonstration
 * to either of those structural exemplars.
 */

interface DemoEntityInput {
  readonly name: string;
  readonly columns: readonly string[];
}

class DemoEntity extends IRNodeBase {
  readonly kind = 'demo-entity' as const;
  readonly name: string;
  readonly columns: readonly string[];

  constructor(input: DemoEntityInput) {
    super();
    this.name = input.name;
    this.columns = Object.freeze([...input.columns]);
    freezeNode(this);
  }
}

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {
    field: {
      text: {
        kind: 'fieldPreset',
        output: { codecId: 'sql/text@1' },
      },
    },
  },
} as const satisfies FamilyPackRef<'sql'>;

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const demoEntitiesExtensionPack = {
  kind: 'extension',
  id: 'demo-entities',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  authoring: {
    entityTypes: {
      demoEntity: {
        kind: 'entity',
        discriminator: 'demo-entity',
        output: {
          factory: (input: DemoEntityInput): DemoEntity => new DemoEntity(input),
        },
      },
    },
  },
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;

describe('entities namespace — synthetic pack exemplar', () => {
  it('surfaces contributed entity helpers at the top level with type-narrowed input/output', () => {
    defineContract(
      {
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        extensions: { demo: demoEntitiesExtensionPack },
      },
      ({ demoEntity, field, model }) => {
        expectTypeOf(demoEntity).parameters.toEqualTypeOf<[DemoEntityInput]>();
        expectTypeOf(demoEntity).returns.toEqualTypeOf<DemoEntity>();

        const demo = demoEntity({ name: 'audit', columns: ['id', 'message'] });
        expect(demo).toBeInstanceOf(DemoEntity);
        expect(Object.isFrozen(demo)).toBe(true);

        return {
          models: {
            Marker: model('Marker', {
              fields: { id: field.text() },
            }),
          },
        };
      },
    );
  });

  it('factory output is JSON-clean (round-trips via JSON.stringify / JSON.parse without a custom toJSON)', () => {
    let constructed: DemoEntity | undefined;
    defineContract(
      {
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        extensions: { demo: demoEntitiesExtensionPack },
      },
      ({ demoEntity, field, model }) => {
        constructed = demoEntity({ name: 'orders', columns: ['id', 'total'] });
        return {
          models: {
            Marker: model('Marker', { fields: { id: field.text() } }),
          },
        };
      },
    );

    expect(constructed).toBeDefined();
    const json = JSON.stringify(constructed);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed).toEqual({
      kind: 'demo-entity',
      name: 'orders',
      columns: ['id', 'total'],
    });
  });

  it('rejects a contributed entity type that would shadow a built-in helper', () => {
    const collidingPack = {
      ...demoEntitiesExtensionPack,
      authoring: {
        entityTypes: {
          model: {
            kind: 'entity',
            discriminator: 'demo-entity',
            output: { factory: (input: DemoEntityInput): DemoEntity => new DemoEntity(input) },
          },
        },
      },
    } as unknown as ExtensionPackRef<'sql', 'postgres'>;

    expect(() =>
      defineContract(
        {
          ...testTypeLookups,
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          extensions: { demo: collidingPack },
        },
        (helpers) => ({
          models: {
            Marker: helpers.model('Marker', { fields: { id: helpers.field.text() } }),
          },
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message: expect.stringContaining(
          '"model" collide with the reserved built-in helper key(s)',
        ),
      }),
    );
  });

  it('omitting the contributing pack removes the helper from the helpers surface', () => {
    defineContract(
      {
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      (helpers) => {
        // The `demoEntity` helper is contributed by `demoEntitiesExtensionPack`;
        // omitting the pack removes it from the helpers shape entirely.
        // @ts-expect-error helper is gone when the contributing pack is absent
        helpers.demoEntity;
        return {
          models: {
            Marker: helpers.model('Marker', { fields: { id: helpers.field.text() } }),
          },
        };
      },
    );
  });
});
