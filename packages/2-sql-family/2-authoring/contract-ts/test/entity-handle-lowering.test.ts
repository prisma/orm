import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import type {
  EntityHandleLoweringInput,
  LoweredPackEntity,
} from '@internal/sql-contract/entity-handle-lowering-hook';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract, extensionModel, field, model } from '../src/contract-builder';

/**
 * The generic `entities` handle channel: the kind-agnostic walk groups
 * handles by the pack that registered each `entityKind`, resolves declared
 * model refs to storage table coordinates (identity-first, cross-space
 * annotated with `spaceId`, unresolved marked as such), and calls the
 * owning pack's batch lowering hook once. `contract-ts` names no specific
 * entity kind, so this test stands up a synthetic `gadget` kind.
 */

const intColumn = { codecId: 'pg/int4@1' } as const;

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'sql'>;

const targetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

function makeGadgetPack(options?: { readonly withHook?: boolean }) {
  const calls: EntityHandleLoweringInput[] = [];
  const pack = {
    kind: 'extension',
    id: 'gadget-demo',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    authoring: {
      entityTypes: {
        gadget: {
          kind: 'entity',
          discriminator: 'gadget',
          output: { factory: (input: { readonly name: string }) => ({ ...input }) },
        },
      },
      ...(options?.withHook === false
        ? {}
        : {
            lowerEntityHandles: (input: EntityHandleLoweringInput): LoweredPackEntity[] => {
              calls.push(input);
              return input.handles.map((entry, index) => {
                const h = entry.handle as { readonly key?: string; readonly entity?: unknown };
                return {
                  namespaceId: input.defaultNamespaceId,
                  entityKind: 'gadget',
                  key: h.key ?? `gadget_${index}`,
                  entity: h.entity ?? { kind: 'gadget', refs: entry.refs },
                };
              });
            },
          }),
    },
  } as const satisfies ExtensionPackRef<'sql', 'postgres'>;
  return { pack, calls };
}

describe('generic entities handle channel', () => {
  it('groups claimed handles and calls the owning pack hook once with the whole batch', () => {
    const { pack, calls } = makeGadgetPack();

    const contract = defineContract({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: targetPack,
      createNamespace: createTestSqlNamespace,
      extensions: { gadgetDemo: pack },
      entities: [{ entityKind: 'gadget' }, { entityKind: 'gadget' }],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ defaultNamespaceId: 'public' });
    expect(calls[0]?.handles).toHaveLength(2);

    const publicNamespace = contract.storage.namespaces['public'];
    const entries: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
      ...publicNamespace?.entries,
    };
    expect(Object.keys(entries['gadget'] ?? {}).sort()).toEqual(['gadget_0', 'gadget_1']);
  });

  it('resolves declared model refs to table coordinates: identity match, cross-space, unresolved', () => {
    const { pack, calls } = makeGadgetPack();
    const Widget = model('Widget', {
      namespace: 'auth',
      fields: { id: field.column(intColumn).id() },
    }).sql({ table: 'widgets' });
    const Foreign = extensionModel(
      'ForeignThing',
      { namespace: 'other', fields: { id: field.column(intColumn).id() }, table: 'things' },
      'other-space',
    );
    const Unknown = model('Unknown', { fields: { id: field.column(intColumn).id() } });

    defineContract({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: targetPack,
      createNamespace: createTestSqlNamespace,
      extensions: { gadgetDemo: pack },
      namespaces: ['auth'],
      models: { Widget },
      entities: [{ entityKind: 'gadget', refs: { a: Widget, b: Foreign, c: Unknown } }],
    });

    expect(calls[0]?.handles[0]?.refs).toEqual({
      a: { kind: 'resolved', namespaceId: 'auth', tableName: 'widgets', modelName: 'Widget' },
      b: {
        kind: 'cross-space',
        spaceId: 'other-space',
        namespaceId: 'other',
        tableName: 'things',
        modelName: 'ForeignThing',
      },
      c: { kind: 'unresolved', modelName: 'Unknown' },
    });
  });

  it('rejects a handle whose entityKind no composed pack registers, naming the kind', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: targetPack,
        createNamespace: createTestSqlNamespace,
        entities: [{ entityKind: 'gadget' }],
      }),
    ).toThrow(/entityKind "gadget", which no composed pack registers/);

    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: targetPack,
        createNamespace: createTestSqlNamespace,
        entities: [{ entityKind: 'gadget' }],
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.ENTITY_KIND_UNKNOWN' }));
  });

  it('rejects a claimed kind whose pack implements no lowering hook, naming the kind', () => {
    const { pack } = makeGadgetPack({ withHook: false });
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: targetPack,
        createNamespace: createTestSqlNamespace,
        extensions: { gadgetDemo: pack },
        entities: [{ entityKind: 'gadget' }],
      }),
    ).toThrow(/"gadget".*does not implement entity-handle lowering/);
  });

  it('rejects two handles lowering to the same name+kind in one namespace with different entities', () => {
    const { pack } = makeGadgetPack();
    // Extra pack-handle fields (`key`/`entity`) are read by the pack hook but
    // absent from the minimal `PackEntityHandle` contract; infer the literal
    // and let structural assignability carry it to `entities` without an
    // excess-property check on a freshly-annotated literal.
    const collidingHandles = [
      { entityKind: 'gadget', key: 'g', entity: { id: 1 } },
      { entityKind: 'gadget', key: 'g', entity: { id: 2 } },
    ];
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: targetPack,
        createNamespace: createTestSqlNamespace,
        extensions: { gadgetDemo: pack },
        entities: collidingHandles,
      }),
    ).toThrow(/two different "gadget" entities named "g" in namespace "public"/);
  });
});
