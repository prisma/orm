import type { AuthoringEntityTypeFactoryOutput } from '@internal/framework-components/authoring';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import { freezeNode, IRNodeBase } from '@internal/framework-components/ir';
import type {
  EntityHandleLoweringInput,
  LoweredPackEntity,
} from '@internal/sql-contract/entity-handle-lowering-hook';
import type { SqlValueSetDerivingEntityTypeOutput } from '@internal/sql-contract/value-set-derivation-hook';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract } from '../src/contract-builder';

/**
 * TML-2965 (native-enum-ts-authoring): a generic, namespace-scoped pack-entity
 * attachment through `defineContract`'s `entities` channel. `contract-ts`
 * names no specific entity kind, so this test stands up a synthetic pack that
 * mirrors Postgres's real `native_enum` (a value-set-deriving entity
 * registered under `AuthoringContributions.entityTypes`, plus a batch
 * `lowerEntityHandles` hook) without depending on the postgres target package
 * — `contract-ts` (sql/authoring) cannot import from the targets domain (see
 * architecture.config.json).
 */

interface TestNativeEnumInput {
  readonly typeName: string;
  readonly members: readonly string[];
}

/**
 * The synthetic pack's authored handle: its batch hook reads these fields to
 * emit an entry row. `emitKind` (default: `entityKind`) lets a test target a
 * framework-managed slot to exercise the managed-kind guard.
 */
interface TestEntityHandle {
  readonly entityKind: 'native_enum';
  readonly namespaceId?: string;
  readonly emitKind?: string;
  readonly name: string;
  readonly entity: TestNativeEnum;
}

class TestNativeEnum extends IRNodeBase {
  readonly kind = 'test-native-enum' as const;
  readonly typeName: string;
  readonly members: readonly string[];

  constructor(input: TestNativeEnumInput) {
    super();
    this.typeName = input.typeName;
    this.members = Object.freeze([...input.members]);
    freezeNode(this);
  }
}

// Mirrors the real Postgres `nativeEnumEntityTypeOutput` shape
// (packages/3-targets/3-targets/postgres/src/core/authoring.ts): checked
// against the intersection type standalone so the entity-types map's
// `satisfies AuthoringEntityTypeNamespace` check doesn't trip an
// excess-property error over the extra `deriveValueSet` hook.
const nativeEnumEntityTypeOutput = {
  factory: (input: TestNativeEnumInput): TestNativeEnum => new TestNativeEnum(input),
  deriveValueSet: (entity: TestNativeEnum) => ({
    kind: 'valueSet' as const,
    values: [...entity.members],
  }),
} satisfies AuthoringEntityTypeFactoryOutput<TestNativeEnumInput, TestNativeEnum> &
  SqlValueSetDerivingEntityTypeOutput;

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'sql'>;

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

// `lowerEntityHandles` is a SQL-family contributions extension (structurally
// probed via `providesEntityHandleLowering`), not a field on the framework
// `AuthoringContributions` type — spread it in so `satisfies ExtensionPackRef`
// does not excess-property-reject it, mirroring the real target pack.
const nativeEnumLowering = {
  lowerEntityHandles: (input: EntityHandleLoweringInput): readonly LoweredPackEntity[] =>
    input.handles.map(({ handle }) => {
      const h = blindCast<
        TestEntityHandle,
        'the synthetic native-enum pack authors only TestEntityHandle'
      >(handle);
      return {
        namespaceId: h.namespaceId ?? input.defaultNamespaceId,
        entityKind: h.emitKind ?? h.entityKind,
        key: h.name,
        entity: h.entity,
      };
    }),
};

const nativeEnumExtensionPack = {
  kind: 'extension',
  id: 'native-enum-demo',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  authoring: {
    entityTypes: {
      native_enum: {
        kind: 'entity',
        discriminator: 'native_enum',
        output: nativeEnumEntityTypeOutput,
      },
    },
    ...nativeEnumLowering,
  },
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;

function nativeEnumHandle(
  name: string,
  entity: TestNativeEnum,
  extra?: { readonly namespaceId?: string; readonly emitKind?: string },
): TestEntityHandle {
  return { entityKind: 'native_enum', name, entity, ...extra };
}

describe('generic pack-entity attachment via the entities channel', () => {
  it('lands an attached entity under entries.<kind> and its derived value-set under entries.valueSet, in the default namespace', () => {
    const aalLevel = new TestNativeEnum({
      typeName: 'aal_level',
      members: ['aal1', 'aal2', 'aal3'],
    });

    const contract = defineContract({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      extensions: { nativeEnumDemo: nativeEnumExtensionPack },
      entities: [nativeEnumHandle('AalLevel', aalLevel)],
    });

    const publicNamespace = contract.storage.namespaces['public'];
    expect(publicNamespace?.entries).toEqual({
      table: {},
      native_enum: { AalLevel: aalLevel },
      valueSet: { AalLevel: { kind: 'valueSet', values: ['aal1', 'aal2', 'aal3'] } },
    });
  });

  it('lands an attached entity under entries.<kind> and its derived value-set under entries.valueSet, in a named namespace', () => {
    const publicAalLevel = new TestNativeEnum({
      typeName: 'aal_level',
      members: ['aal1', 'aal2'],
    });
    const authAalLevel = new TestNativeEnum({
      typeName: 'aal_level',
      members: ['aal1', 'aal2', 'aal3'],
    });

    const contract = defineContract({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      namespaces: ['auth'],
      extensions: { nativeEnumDemo: nativeEnumExtensionPack },
      entities: [
        nativeEnumHandle('AalLevel', publicAalLevel, { namespaceId: 'public' }),
        nativeEnumHandle('AalLevel', authAalLevel, { namespaceId: 'auth' }),
      ],
    });

    const publicNamespace = contract.storage.namespaces['public'];
    const authNamespace = contract.storage.namespaces['auth'];

    expect(publicNamespace?.entries).toEqual({
      table: {},
      native_enum: { AalLevel: publicAalLevel },
      valueSet: { AalLevel: { kind: 'valueSet', values: ['aal1', 'aal2'] } },
    });
    expect(authNamespace?.entries).toEqual({
      table: {},
      native_enum: { AalLevel: authAalLevel },
      valueSet: { AalLevel: { kind: 'valueSet', values: ['aal1', 'aal2', 'aal3'] } },
    });
  });

  it('rejects an attached entity landing under a framework-managed entry kind (table/valueSet)', () => {
    const entity = new TestNativeEnum({ typeName: 'aal_level', members: ['aal1'] });
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        extensions: { nativeEnumDemo: nativeEnumExtensionPack },
        entities: [nativeEnumHandle('AalLevel', entity, { emitKind: 'table' })],
      }),
    ).toThrow(/entry kind "table"/);

    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        extensions: { nativeEnumDemo: nativeEnumExtensionPack },
        entities: [nativeEnumHandle('AalLevel', entity, { emitKind: 'table' })],
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.ENTITY_KIND_INVALID' }));
  });

  it('rejects two attached entities colliding on name+kind in one namespace with different instances', () => {
    // Scaffold and factory each attach `native_enum.AalLevel` in `public`, but
    // with different entity instances. The `entities` lists concatenate; the
    // identity-checked walk rejects the collision (the emitted
    // `entries.valueSet.AalLevel` could only reflect one).
    const scaffoldEntity = new TestNativeEnum({ typeName: 'aal_level', members: ['aal1'] });
    const factoryEntity = new TestNativeEnum({ typeName: 'aal_level', members: ['aal1', 'aal2'] });

    expect(() =>
      defineContract(
        {
          ...testTypeLookups,
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          extensions: { nativeEnumDemo: nativeEnumExtensionPack },
          entities: [nativeEnumHandle('AalLevel', scaffoldEntity)],
        },
        () => ({ entities: [nativeEnumHandle('AalLevel', factoryEntity)] }),
      ),
    ).toThrow(/two different "native_enum" entities named "AalLevel" in namespace "public"/);
  });

  it('allows the identical attached-entity instance from both scaffold and factory', () => {
    const shared = new TestNativeEnum({ typeName: 'aal_level', members: ['aal1', 'aal2'] });

    const contract = defineContract(
      {
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        extensions: { nativeEnumDemo: nativeEnumExtensionPack },
        entities: [nativeEnumHandle('AalLevel', shared)],
      },
      () => ({ entities: [nativeEnumHandle('AalLevel', shared)] }),
    );

    expect(contract.storage.namespaces['public']?.entries).toEqual({
      table: {},
      native_enum: { AalLevel: shared },
      valueSet: { AalLevel: { kind: 'valueSet', values: ['aal1', 'aal2'] } },
    });
  });
});
