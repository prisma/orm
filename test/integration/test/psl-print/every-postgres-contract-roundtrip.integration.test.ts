import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalizeContractToObject } from '@internal/contract/hashing';
import type { Contract } from '@internal/contract/types';
import arktypeJsonControl from '@internal/extension-arktype-json/control';
import arktypeJsonPack from '@internal/extension-arktype-json/pack';
import paradedbControl from '@internal/extension-paradedb/control';
import paradedbPack from '@internal/extension-paradedb/pack';
import pgvectorControl from '@internal/extension-pgvector/control';
import pgvectorPack from '@internal/extension-pgvector/pack';
import postgisControl from '@internal/extension-postgis/control';
import postgisPack from '@internal/extension-postgis/pack';
import supabasePack from '@internal/extension-supabase/pack';
import type { ExtensionPackRef } from '@internal/framework-components/components';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { trackedContractCandidateFiles } from '../utils/tracked-contract-files';
import {
  composePostgresStack,
  type PostgresStack,
  printContract,
  readPsl,
} from './print-and-read-back';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

interface ExtensionPack {
  readonly control: ControlExtensionDescriptor<'sql', 'postgres'>;
  readonly packRef: ExtensionPackRef<'sql', string>;
}

const extensionPacks: ReadonlyMap<string, ExtensionPack> = new Map<string, ExtensionPack>([
  ['arktype-json', { control: arktypeJsonControl, packRef: arktypeJsonPack }],
  ['paradedb', { control: paradedbControl, packRef: paradedbPack }],
  ['pgvector', { control: pgvectorControl, packRef: pgvectorPack }],
  ['postgis', { control: postgisControl, packRef: postgisPack }],
  ['supabase', { control: supabasePack, packRef: supabasePack }],
]);

/**
 * Packs that exist only inside one example or test, so this package cannot
 * load them. A contract naming one is printed and read back without it, which
 * is enough while none of them contributes a type, block or generator the
 * contract uses.
 */
const packsOutsideThisPackage = new Set([
  'audit',
  'demo/engagement-stats',
  'feature-flags',
  'slugid-defaults',
]);

/**
 * Every tracked Postgres contract, except migration snapshots: a snapshot is a
 * frozen copy of the contract a migration was planned against, many in formats
 * the serializer no longer reads, and the current contract it was taken from is
 * covered here.
 */
function trackedPostgresContracts(): readonly string[] {
  const files = trackedContractCandidateFiles(repoRoot).filter(
    (file) => !file.includes('/migrations/snapshots/'),
  );
  return files.filter((file) => {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(join(repoRoot, file), 'utf-8'));
    } catch {
      return false;
    }
    return (
      typeof json === 'object' &&
      json !== null &&
      Reflect.get(json, 'targetFamily') === 'sql' &&
      Reflect.get(json, 'target') === 'postgres'
    );
  });
}

interface Composition {
  readonly stack: PostgresStack;
  readonly packRefs: readonly ExtensionPackRef<'sql', string>[];
}

/**
 * The stack a contract needs: every pack it names, and the pack whose own
 * contract space it is, which names no pack.
 */
function compositionFor(contract: Contract<SqlStorage>): Composition {
  const ids = new Set(Object.keys(contract.extensions));
  for (const [id, pack] of extensionPacks) {
    if (
      pack.control.contractSpace?.contractJson.storage.storageHash === contract.storage.storageHash
    ) {
      ids.add(id);
    }
  }
  const packs = [...ids].flatMap((id) => {
    const pack = extensionPacks.get(id);
    if (pack !== undefined) return [pack];
    if (packsOutsideThisPackage.has(id)) return [];
    throw new Error(`the contract names pack "${id}", which this test does not compose; add it`);
  });
  return {
    stack: composePostgresStack(packs.map((pack) => pack.control)),
    packRefs: packs.map((pack) => pack.packRef),
  };
}

const serializer = new PostgresContractSerializer();

/**
 * The contract as `contract emit` writes it, without `capabilities` and
 * `extensions`: both are written from the composed stack, not from the source,
 * so the printed file has no say over them.
 */
function comparable(contract: Contract<SqlStorage>): unknown {
  const {
    capabilities: _capabilities,
    extensions: _extensions,
    ...rest
  } = canonicalizeContractToObject(contract, {
    serializeContract: (value) =>
      serializer.serializeContract(
        blindCast<Contract<SqlStorage>, 'this test canonicalizes Postgres contracts only'>(value),
      ),
    shouldPreserveEmpty: serializer.shouldPreserveEmpty,
    sortStorage: serializer.sortStorage,
  });
  return rest;
}

interface ExpectedRefusal {
  /** Words from the refusal message that name the reason. */
  readonly reason: string;
  readonly meta: Record<string, unknown>;
}

/**
 * The contracts the printer refuses, each with the words of its refusal
 * message that name the reason, and its meta. A contract missing from this
 * list must read back as the same contract.
 */
const expectedRefusals: ReadonlyMap<string, ExpectedRefusal> = new Map<string, ExpectedRefusal>([
  [
    'examples/supabase/src/contract.json',
    {
      reason: 'in contract space "supabase"',
      meta: { model: 'Profile', field: 'user', space: 'supabase' },
    },
  ],
  // Prisma 7 `@ignore` and `@@ignore` keep storage that no field or model maps, which Prisma 8 PSL cannot write until TML-3469.
  [
    'packages/2-sql/2-authoring/contract-prisma7/test/fixtures/ignore/expected-contract.json',
    {
      reason: 'is not stored by any field',
      meta: { namespaceId: 'public', table: 'User', column: 'legacy' },
    },
  ],
  [
    'packages/2-sql/2-authoring/contract-prisma7/test/fixtures/ignored-field-defaults/expected-contract.json',
    {
      reason: 'is not stored by any field',
      meta: { namespaceId: 'public', table: 'Account', column: 'status' },
    },
  ],
  [
    'packages/2-sql/2-authoring/contract-prisma7/test/fixtures/ignored-field-in-index/expected-contract.json',
    {
      reason: 'is not stored by any field',
      meta: { namespaceId: 'public', table: 'Indexed', column: 'b' },
    },
  ],
  [
    'packages/2-sql/2-authoring/contract-prisma7/test/fixtures/ignored-model-many-to-many/expected-contract.json',
    { reason: 'has no model stored in it', meta: { namespaceId: 'public', table: 'tags' } },
  ],
  [
    'packages/2-sql/2-authoring/contract-prisma7/test/fixtures/ignored-models/expected-contract.json',
    {
      reason: 'that no relation of model "User" travels',
      meta: { namespaceId: 'public', table: 'User', columns: ['archiveId'] },
    },
  ],
  [
    'packages/2-sql/2-authoring/contract-prisma7/test/fixtures/ignored-relation-back-relations/expected-contract.json',
    {
      reason: 'that no relation of model "User" travels',
      meta: { namespaceId: 'public', table: 'User', columns: ['managerId'] },
    },
  ],
  [
    'packages/2-sql/2-authoring/contract-prisma7/test/fixtures/ignored-relation-field/expected-contract.json',
    {
      reason: 'that no relation of model "Post" travels',
      meta: { namespaceId: 'public', table: 'Post', columns: ['authorId'] },
    },
  ],
  [
    'packages/2-sql/2-authoring/contract-prisma7/test/fixtures/junction-name-in-other-schema/expected-contract.json',
    {
      reason: 'is declared in more than one namespace',
      meta: { modelName: 'PostToTag', namespaces: ['one', 'two'] },
    },
  ],
  [
    'packages/2-sql/2-authoring/contract-prisma7/test/fixtures/relation-name-in-two-schemas/expected-contract.json',
    {
      reason: 'is declared in more than one namespace',
      meta: { modelName: 'X', namespaces: ['one', 'two'] },
    },
  ],
  [
    'packages/2-sql/2-authoring/contract-prisma7/test/fixtures/relations-ignored/expected-contract.json',
    {
      reason: 'that no relation of model "Post" travels',
      meta: { namespaceId: 'public', table: 'Post', columns: ['legacyOwnerId'] },
    },
  ],
  [
    'packages/2-sql/4-lanes/sql-builder/test/fixtures/generated/contract.json',
    { reason: 'has no foreign key in storage', meta: { model: 'Post', field: 'author' } },
  ],
  [
    'packages/3-extensions/pgvector/src/contract.json',
    {
      reason: 'no PSL type in the configured stack',
      meta: { coordinate: 'types.vector', dataType: 'pgvector/vector', codecId: 'pg/vector@1' },
    },
  ],
  [
    'packages/3-extensions/postgres/test/fixtures/generated/contract.json',
    { reason: 'has no foreign key in storage', meta: { model: 'Post', field: 'author' } },
  ],
  [
    'packages/3-extensions/sql-orm-client/test/fixtures/generated/contract.json',
    { reason: 'has no foreign key in storage', meta: { model: 'Article', field: 'reviewer' } },
  ],
  [
    'packages/3-extensions/sql-orm-client/test/fixtures/junction-namespaces/generated/contract.json',
    { reason: 'many-to-many relation', meta: { model: 'User', field: 'roles' } },
  ],
  [
    'packages/3-extensions/supabase/test/fixtures/example-app/contract.json',
    {
      reason: 'in contract space "supabase"',
      meta: { model: 'Profile', field: 'user', space: 'supabase' },
    },
  ],
  [
    'packages/3-extensions/supabase/test/fixtures/no-policy/contract.json',
    {
      reason: 'in contract space "supabase"',
      meta: { model: 'Profile', field: 'user', space: 'supabase' },
    },
  ],
  [
    'packages/3-extensions/supabase/test/fixtures/renamed-policy/contract.json',
    {
      reason: 'in contract space "supabase"',
      meta: { model: 'Profile', field: 'user', space: 'supabase' },
    },
  ],
  [
    'packages/3-targets/3-targets/postgres/test/fixtures/namespaced-contract.json',
    {
      reason: 'is declared in more than one namespace',
      meta: { modelName: 'User', namespaces: ['auth', 'public'] },
    },
  ],
  [
    'packages/3-targets/3-targets/postgres/test/fixtures/snapshot-read-shapes/codec-instance.json',
    {
      reason: 'has no model stored in it',
      meta: { namespaceId: '__unbound__', table: 'embeddings' },
    },
  ],
  [
    'test/e2e/framework/test/fixtures/generated/contract.json',
    { reason: 'has no foreign key in storage', meta: { model: 'Comment', field: 'post' } },
  ],
  [
    'test/integration/test/authoring/parity/default-pack-slugid/expected.contract.json',
    {
      reason: 'the printer knows no PSL default function',
      meta: { coordinate: '"public"."user"."id"', onCreate: 'slugid', onUpdate: undefined },
    },
  ],
  [
    'test/integration/test/fixtures/contract-format/supabase-before-dbgenerated-removal.contract.json',
    {
      reason: 'has a different codec or type parameters from its column',
      meta: { coordinate: '"auth"."audit_log_entries"."ip_address"' },
    },
  ],
  [
    'test/integration/test/namespaced-accessors/fixtures/generated/contract.json',
    {
      reason: 'is declared in more than one namespace',
      meta: { modelName: 'Note', namespaces: ['auth', 'public'] },
    },
  ],
  [
    'test/integration/test/planner-golden/fixtures/postgres/generated/contract.json',
    {
      reason: 'no PSL type in the configured stack',
      meta: { coordinate: '"public"."list"."bit"', dataType: 'pg/bit', codecId: 'pg/bit@1' },
    },
  ],
  [
    'test/integration/test/ports/engines/queries/data_types/native/postgres/_fixture/string/generated/contract.json',
    {
      reason: 'no PSL type in the configured stack',
      meta: { coordinate: '"public"."Child"."bit"', dataType: 'pg/bit', codecId: 'pg/bit@1' },
    },
  ],
  [
    'test/integration/test/sql-builder/fixtures/generated-no-pgvector/contract.json',
    { reason: 'has no foreign key in storage', meta: { model: 'Post', field: 'author' } },
  ],
  [
    'test/integration/test/sql-builder/fixtures/generated/contract.json',
    { reason: 'has no foreign key in storage', meta: { model: 'Post', field: 'author' } },
  ],
  [
    'test/integration/test/sql-orm-client/fixtures/execution-defaulted-tags/generated/contract.json',
    { reason: 'many-to-many relation', meta: { model: 'User', field: 'tags' } },
  ],
  [
    'test/integration/test/sql-orm-client/fixtures/generated/contract.json',
    { reason: 'has no foreign key in storage', meta: { model: 'Article', field: 'reviewer' } },
  ],
  [
    'test/integration/test/sql-orm-client/fixtures/junction-namespaces/generated/contract.json',
    { reason: 'many-to-many relation', meta: { model: 'User', field: 'roles' } },
  ],
]);

/**
 * Contracts emitted before a date or time default had one canonical form, each with the schema it
 * was emitted from. Such a contract prints each default in canonical form, so it reads back as
 * the contract that schema emits now, not as itself.
 */
const emittedBeforeCanonicalForm: ReadonlyMap<string, string> = new Map([
  [
    'test/integration/test/date-time-defaults/_fixture-before-canonical-form/emitted-before/contract.json',
    'test/integration/test/date-time-defaults/_fixture-before-canonical-form/contract.prisma',
  ],
]);

const contracts = trackedPostgresContracts();

describe('every Postgres contract in the repo prints as PSL that reads back as the same contract', () => {
  it('finds the contracts', () => {
    expect(contracts.length).toBeGreaterThan(200);
  });

  it.each(contracts)('%s', async (file) => {
    const json: unknown = JSON.parse(readFileSync(join(repoRoot, file), 'utf-8'));
    const contract = serializer.deserializeContract(json);
    const composition = compositionFor(contract);
    const refusal = expectedRefusals.get(file);
    if (refusal !== undefined) {
      expect(() => printContract(contract, composition.stack)).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.PRINT_UNSUPPORTED',
          message: expect.stringContaining(refusal.reason),
          meta: refusal.meta,
        }),
      );
      return;
    }
    const { text, sourceSettings } = printContract(contract, composition.stack);
    const printed = await readPsl(text, { ...composition, sourceSettings });
    const source = emittedBeforeCanonicalForm.get(file);
    if (source === undefined) {
      expect(comparable(printed)).toEqual(comparable(contract));
      return;
    }
    const emittedNow = await readPsl(readFileSync(join(repoRoot, source), 'utf-8'), {
      ...composition,
      sourceSettings,
    });
    expect(comparable(emittedNow)).not.toEqual(comparable(contract));
    expect(comparable(printed)).toEqual(comparable(emittedNow));
  });
});
