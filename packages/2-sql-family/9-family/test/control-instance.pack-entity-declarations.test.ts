import { computeStorageHash } from '@internal/contract/hashing';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type {
  AuthoringContributions,
  AuthoringEntityTypeFactoryOutput,
} from '@internal/framework-components/authoring';
import type {
  ContractSpace,
  ControlFamilyDescriptor,
  ControlTargetDescriptor,
} from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import type { SqlNameUniqueAcrossNamespacesOutput } from '@internal/sql-contract/entity-handle-lowering-hook';
import { SqlStorage } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { createSqlFamilyInstance } from '../src/core/control-instance';
import type { SqlControlExtensionDescriptor } from '../src/core/migrations/types';

const uniqueAcrossNamespaces = {
  factory: () => undefined,
  nameUniqueAcrossNamespaces: true,
} as const satisfies AuthoringEntityTypeFactoryOutput<never, undefined> &
  SqlNameUniqueAcrossNamespacesOutput;

const authoring: AuthoringContributions = {
  entityTypes: {
    extension: { kind: 'entity', discriminator: 'extension', output: uniqueAcrossNamespaces },
    role: { kind: 'entity', discriminator: 'role', output: { factory: () => undefined } },
  },
};

type Declared = Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;

function packContract(declared: Declared): Contract<SqlStorage> {
  const entriesOf = (kinds: Readonly<Record<string, readonly string[]>>) => ({
    table: {},
    ...Object.fromEntries(
      Object.entries(kinds).map(([kind, names]) => [
        kind,
        Object.fromEntries(names.map((name) => [name, { kind, name }])),
      ]),
    ),
  });
  const hashBody = {
    namespaces: Object.fromEntries(
      Object.entries(declared).map(([id, kinds]) => [id, { id, entries: entriesOf(kinds) }]),
    ),
  };
  const hash = computeStorageHash({
    target: 'postgres',
    targetFamily: 'sql',
    storage: hashBody,
    ...sqlContractCanonicalizationHooks,
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
    profileHash: profileHash('pack-entity-declarations'),
    storage: new SqlStorage({
      namespaces: Object.fromEntries(
        Object.entries(declared).map(([id, kinds]) => [
          id,
          createTestSqlNamespace({ id, entries: entriesOf(kinds) }),
        ]),
      ),
      storageHash: coreHash(hash),
    }),
  };
}

function pack(id: string, declared: Declared): SqlControlExtensionDescriptor<'postgres'> {
  const contractJson = packContract(declared);
  const space: ContractSpace<Contract<SqlStorage>> = {
    contractJson,
    migrations: [],
    headRef: { hash: contractJson.storage.storageHash, invariants: [] },
  };
  return {
    kind: 'extension',
    id,
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    contractSpace: space,
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
  };
}

function load(extensions: readonly SqlControlExtensionDescriptor<'postgres'>[]) {
  return createSqlFamilyInstance(
    createControlStack({
      family: {
        kind: 'family',
        id: 'sql',
        familyId: 'sql',
        version: '0.0.1',
        create: (() => ({})) as unknown as ControlFamilyDescriptor<'sql'>['create'],
        emission: {
          id: 'sql',
          generateStorageType: () => '{ readonly storageHash: StorageHash }',
          generateModelStorageType: () => 'Record<string, never>',
          getFamilyImports: () => [],
          getFamilyTypeAliases: () => '',
          getTypeMapsExpression: () => 'unknown',
          getContractWrapper: (base: string) => `export type Contract = ${base};`,
        },
      },
      target: {
        kind: 'target',
        id: 'postgres',
        version: '0.0.1',
        familyId: 'sql',
        targetId: 'postgres',
        defaultNamespaceId: 'public',
        authoring,
        create: () => ({ familyId: 'sql', targetId: 'postgres' }),
      } as ControlTargetDescriptor<'sql', 'postgres'>,
      adapter: {
        kind: 'adapter',
        id: 'postgres',
        version: '0.0.1',
        familyId: 'sql',
        targetId: 'postgres',
        create: () => ({ familyId: 'sql', targetId: 'postgres' }),
      },
      extensions,
    }),
  );
}

describe('loading packs that declare entities unique across namespaces', () => {
  it('accepts packs that declare different extensions', () => {
    expect(() =>
      load([
        pack('pgvector', { [UNBOUND_NAMESPACE_ID]: { extension: ['vector'] } }),
        pack('postgis', { [UNBOUND_NAMESPACE_ID]: { extension: ['postgis'] } }),
      ]),
    ).not.toThrow();
  });

  it('refuses a pack that declares an extension in a named namespace', () => {
    expect(() => load([pack('pgvector', { extensions: { extension: ['vector'] } })])).toThrow(
      'Extension pack "pgvector" declares extension "vector" in namespace "extensions". A pack declares each extension in namespace "unbound", so the connection\'s search path finds it.',
    );
  });

  it('names the pack, the entity and the namespace in its meta', () => {
    expect(() => load([pack('pgvector', { extensions: { extension: ['vector'] } })])).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        meta: {
          entityKind: 'extension',
          entityName: 'vector',
          packId: 'pgvector',
          namespaceId: 'extensions',
        },
      }),
    );
    expect(() =>
      load([
        pack('pgvector', { [UNBOUND_NAMESPACE_ID]: { extension: ['vector'] } }),
        pack('vector-copy', { [UNBOUND_NAMESPACE_ID]: { extension: ['vector'] } }),
      ]),
    ).toThrow(
      expect.objectContaining({
        meta: {
          entityKind: 'extension',
          entityName: 'vector',
          packIds: ['pgvector', 'vector-copy'],
        },
      }),
    );
  });

  it('refuses two packs that declare the same extension', () => {
    expect(() =>
      load([
        pack('pgvector', { [UNBOUND_NAMESPACE_ID]: { extension: ['vector'] } }),
        pack('vector-copy', { [UNBOUND_NAMESPACE_ID]: { extension: ['vector'] } }),
      ]),
    ).toThrow(
      'Extension packs "pgvector" and "vector-copy" both declare extension "vector". Each extension can be declared by one contract space only; compose only one of these packs.',
    );
  });

  it('accepts two packs that declare the same entity of a kind unique per namespace only', () => {
    expect(() =>
      load([
        pack('supabase', { [UNBOUND_NAMESPACE_ID]: { role: ['authenticated'] } }),
        pack('supabase-copy', { [UNBOUND_NAMESPACE_ID]: { role: ['authenticated'] } }),
      ]),
    ).not.toThrow();
  });
});
